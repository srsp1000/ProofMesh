import { z } from 'zod';

// 1. Source Types & Classification
export const SourceTypeEnum = z.enum([
  'web_page',
  'pdf',
  'docx',
  'markdown',
  'plain_text',
  'code_repository',
  'api_response',
  'structured_record'
]);
export type SourceType = z.infer<typeof SourceTypeEnum>;

export const SourcePermissionContextEnum = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted'
]);
export type SourcePermissionContext = z.infer<typeof SourcePermissionContextEnum>;

export const SourceRetentionStateEnum = z.enum(['active', 'soft_deleted', 'purged', 'legal_hold']);
export type SourceRetentionState = z.infer<typeof SourceRetentionStateEnum>;

export const SourceExtractionStatusEnum = z.enum(['pending', 'completed', 'failed']);
export type SourceExtractionStatus = z.infer<typeof SourceExtractionStatusEnum>;

export const PassageExtractionMethodEnum = z.enum(['native_text', 'ocr', 'hybrid']);
export type PassageExtractionMethod = z.infer<typeof PassageExtractionMethodEnum>;

export const PassageLocatorSchema = z.object({
  type: z.enum(['page', 'section', 'line', 'json_path', 'byte_range']),
  value: z.union([z.string(), z.number()]),
  endValue: z.union([z.string(), z.number()]).optional()
});
export type PassageLocator = z.infer<typeof PassageLocatorSchema>;

// 2. Source Artifact Schemas
export const RegisterSourceArtifactInputSchema = z.object({
  originalUri: z.string().min(1).max(2048),
  sourceType: SourceTypeEnum,
  title: z.string().min(1).max(255),
  issuer: z.string().max(255).optional(),
  mimeType: z.string().min(1).max(100),
  permissionContext: SourcePermissionContextEnum.default('internal'),
  retentionState: SourceRetentionStateEnum.default('active'),
  metadata: z.record(z.unknown()).default({})
});
export type RegisterSourceArtifactInput = z.infer<typeof RegisterSourceArtifactInputSchema>;

export const SourceArtifactDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  originalUri: z.string(),
  resolvedUri: z.string(),
  sourceType: SourceTypeEnum,
  title: z.string(),
  issuer: z.string().nullable(),
  mimeType: z.string(),
  permissionContext: SourcePermissionContextEnum,
  retentionState: SourceRetentionStateEnum,
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type SourceArtifactDTO = z.infer<typeof SourceArtifactDTOSchema>;

// 3. Source Version Schemas
export const IngestSourceVersionInputSchema = z.object({
  sourceArtifactId: z.string().uuid(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  storageLocation: z.string().min(1),
  versionIdentifiers: z.record(z.unknown()).default({}),
  publicationDate: z.string().datetime().nullable().optional(),
  retrievalTimestamp: z.string().datetime(),
  httpValidators: z
    .object({
      etag: z.string().optional(),
      lastModified: z.string().optional(),
      cacheControl: z.string().optional()
    })
    .optional(),
  rawText: z.string().optional(),
  parserMetadata: z.record(z.unknown()).default({})
});
export type IngestSourceVersionInput = z.infer<typeof IngestSourceVersionInputSchema>;

export const SourceVersionDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sourceArtifactId: z.string().uuid(),
  versionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  storageLocation: z.string(),
  versionIdentifiers: z.record(z.unknown()),
  publicationDate: z.string().datetime().nullable(),
  retrievalTimestamp: z.string().datetime(),
  httpValidators: z.record(z.unknown()).nullable().optional(),
  extractionStatus: SourceExtractionStatusEnum,
  parserMetadata: z.record(z.unknown()),
  capturedAt: z.string().datetime(),
  recordedAt: z.string().datetime()
});
export type SourceVersionDTO = z.infer<typeof SourceVersionDTOSchema>;

// 4. Source Passage Schemas
export const SourcePassageInputSchema = z.object({
  passageIndex: z.number().int().nonnegative(),
  contentText: z.string().min(1),
  contentHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
  locator: PassageLocatorSchema,
  extractionMethod: PassageExtractionMethodEnum.default('native_text'),
  ocrConfidence: z.number().min(0).max(1).nullable().optional()
});
export type SourcePassageInput = z.infer<typeof SourcePassageInputSchema>;

export const SourcePassageDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  passageIndex: z.number().int().nonnegative(),
  contentText: z.string(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  locator: PassageLocatorSchema,
  extractionMethod: PassageExtractionMethodEnum,
  ocrConfidence: z.number().nullable(),
  createdAt: z.string().datetime()
});
export type SourcePassageDTO = z.infer<typeof SourcePassageDTOSchema>;

// 5. Source Snapshot Schema
export const SourceSnapshotDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  snapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sourceVersionIds: z.array(z.string().uuid()),
  totalByteSize: z.number().int().nonnegative(),
  manifest: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime()
});
export type SourceSnapshotDTO = z.infer<typeof SourceSnapshotDTOSchema>;

// 6. Web Ingestion Request & Result
export const WebSourceIngestInputSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(255).optional(),
  permissionContext: SourcePermissionContextEnum.default('internal'),
  maxRedirects: z.number().int().min(0).max(5).default(3),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000)
});
export type WebSourceIngestInput = z.infer<typeof WebSourceIngestInputSchema>;

// 7. File Ingestion Options
export const DocumentIngestOptionsSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  permissionContext: SourcePermissionContextEnum.default('internal'),
  maxByteSize: z
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024), // 25MB default
  enableOcrFallback: z.boolean().default(false),
  preserveUntrustedInstructions: z.boolean().default(true)
});
export type DocumentIngestOptions = z.infer<typeof DocumentIngestOptionsSchema>;
