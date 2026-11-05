import crypto from 'node:crypto';
import type {
  ClaimOccurrenceInput,
  ClaimOccurrenceDTO,
  ClaimCorrectionInput,
  ClaimCorrectionDTO
} from '@proofmesh/contracts';

const ALLOWED_CORRECTION_FIELDS = new Set([
  'normalizedSubject',
  'normalizedPredicate',
  'normalizedObject',
  'normalizedUnit',
  'qualifiers',
  'propositionType',
  'claimText'
]);

export class ClaimCorrectionService {
  private readonly occurrences = new Map<string, ClaimOccurrenceDTO>();
  private readonly corrections = new Map<string, ClaimCorrectionDTO>();

  /**
   * Records an immutable occurrence of a claim in a source passage, document, or agent activity.
   */
  public recordOccurrence(tenantId: string, input: ClaimOccurrenceInput): ClaimOccurrenceDTO {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const occurrence: ClaimOccurrenceDTO = {
      id,
      tenantId,
      claimVersionId: input.claimVersionId,
      sourceVersionId: input.sourceVersionId ?? null,
      sourcePassageId: input.sourcePassageId ?? null,
      agentActivityId: input.agentActivityId ?? null,
      contextPacketId: input.contextPacketId ?? null,
      exactPassageText: input.exactPassageText,
      charStart: input.charStart ?? null,
      charEnd: input.charEnd ?? null,
      occurredAt: input.occurredAt ?? now,
      recordedAt: now
    };

    this.occurrences.set(id, occurrence);
    return occurrence;
  }

  /**
   * Retrieves occurrences for a specific claim version with tenant isolation.
   */
  public getOccurrences(tenantId: string, claimVersionId: string): ClaimOccurrenceDTO[] {
    return Array.from(this.occurrences.values()).filter(
      (occ) => occ.tenantId === tenantId && occ.claimVersionId === claimVersionId
    );
  }

  /**
   * Submits a human correction for a claim proposition or field, logging an immutable audit record.
   */
  public submitCorrection(
    tenantId: string,
    principalId: string,
    input: ClaimCorrectionInput
  ): ClaimCorrectionDTO {
    if (!principalId) {
      throw new Error('Principal ID is required to record a human correction');
    }

    if (!ALLOWED_CORRECTION_FIELDS.has(input.fieldName)) {
      throw new Error(
        `Field '${input.fieldName}' is not eligible for manual correction. Allowed fields: ${Array.from(ALLOWED_CORRECTION_FIELDS).join(', ')}`
      );
    }

    if (input.originalValue.trim() === input.correctedValue.trim()) {
      throw new Error('Corrected value must differ from the original value');
    }

    if (!input.correctionReason || input.correctionReason.trim().length === 0) {
      throw new Error('Correction reason is mandatory for governance auditability');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: ClaimCorrectionDTO = {
      id,
      tenantId,
      claimVersionId: input.claimVersionId,
      correctedByPrincipalId: principalId,
      fieldName: input.fieldName,
      originalValue: input.originalValue,
      correctedValue: input.correctedValue,
      correctionReason: input.correctionReason,
      correctedAt: now
    };

    this.corrections.set(id, record);
    return record;
  }

  /**
   * Retrieves all corrections applied to a claim version, ordered chronologically.
   */
  public getCorrections(tenantId: string, claimVersionId: string): ClaimCorrectionDTO[] {
    return Array.from(this.corrections.values())
      .filter((c) => c.tenantId === tenantId && c.claimVersionId === claimVersionId)
      .sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));
  }
}
