import { createHash } from 'node:crypto';
import type { ContentMode } from '@proofmesh/contracts';
import { RedactionFilter } from '../security/redaction.js';

export interface PrivacyFilterOptions {
  contentMode?: ContentMode;
  allowedFields?: string[];
  redactPii?: boolean;
  maxContentLength?: number;
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface SanitizedResult<T = Record<string, unknown>> {
  sanitizedData: T;
  contentMode: ContentMode;
  dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  wasTruncated: boolean;
  wasRedacted: boolean;
}

export class PrivacyFilterService {
  private static readonly CONTENT_FIELD_NAMES = new Set([
    'content',
    'prompt',
    'completion',
    'statement',
    'toolParameters',
    'rawOutput',
    'documentText'
  ]);

  /**
   * Applies privacy filtering according to content mode, allowlists, redaction, and truncation.
   */
  public static filter<T extends Record<string, unknown>>(
    data: T,
    options?: PrivacyFilterOptions
  ): SanitizedResult<T> {
    const mode: ContentMode = options?.contentMode ?? 'metadata_only';
    const classification = options?.dataClassification ?? 'internal';
    const maxLength = options?.maxContentLength ?? 4096;
    const allowedFields = options?.allowedFields;

    let wasTruncated = false;
    let wasRedacted = false;

    // 1. Field allowlist filtering (if configured)
    let processedData: Record<string, unknown> = { ...data };
    if (allowedFields && allowedFields.length > 0) {
      const allowedSet = new Set(allowedFields);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(processedData)) {
        if (allowedSet.has(k)) {
          filtered[k] = v;
        }
      }
      processedData = filtered;
    }

    // 2. Mode-specific handling
    if (mode === 'metadata_only') {
      const metadataOnlyObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(processedData)) {
        if (this.CONTENT_FIELD_NAMES.has(k) && typeof v === 'string') {
          const hash = `sha256:${createHash('sha256').update(v).digest('hex')}`;
          metadataOnlyObj[k] =
            `[METADATA_ONLY: byteSize=${Buffer.byteLength(v, 'utf8')}, hash=${hash}]`;
          wasRedacted = true;
        } else if (this.CONTENT_FIELD_NAMES.has(k) && typeof v === 'object' && v !== null) {
          const jsonStr = JSON.stringify(v);
          const hash = `sha256:${createHash('sha256').update(jsonStr).digest('hex')}`;
          metadataOnlyObj[k] = {
            _mode: 'metadata_only',
            byteSize: Buffer.byteLength(jsonStr, 'utf8'),
            hash
          };
          wasRedacted = true;
        } else {
          metadataOnlyObj[k] = v;
        }
      }
      processedData = metadataOnlyObj;
    } else if (mode === 'redacted') {
      // In-flight PII and secret redaction
      processedData = RedactionFilter.redact(processedData) as Record<string, unknown>;
      wasRedacted = true;
    } else if (mode === 'full_content') {
      // Full content still scrubs hard credentials/secrets to prevent secret leaks into logs
      processedData = RedactionFilter.redact(processedData) as Record<string, unknown>;
    } else if (mode === 'reference_only') {
      // Content replaced by reference only
      const referenceObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(processedData)) {
        if (this.CONTENT_FIELD_NAMES.has(k)) {
          referenceObj[k] = '[REFERENCE_ONLY]';
          wasRedacted = true;
        } else {
          referenceObj[k] = v;
        }
      }
      processedData = referenceObj;
    }

    // 3. Truncation check on long strings
    const applyTruncation = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        if (obj.length > maxLength) {
          wasTruncated = true;
          return obj.substring(0, maxLength) + '... [TRUNCATED]';
        }
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(applyTruncation);
      }
      if (typeof obj === 'object' && obj !== null) {
        const res: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          res[k] = applyTruncation(v);
        }
        return res;
      }
      return obj;
    };

    processedData = applyTruncation(processedData) as Record<string, unknown>;

    return {
      sanitizedData: processedData as T,
      contentMode: mode,
      dataClassification: classification,
      wasTruncated,
      wasRedacted
    };
  }
}
