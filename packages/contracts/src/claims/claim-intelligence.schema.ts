import { z } from 'zod';

// 1. Proposition Classification
export const PropositionTypeEnum = z.enum([
  'factual_claim',
  'opinion',
  'forecast',
  'commitment',
  'instruction'
]);
export type PropositionType = z.infer<typeof PropositionTypeEnum>;

export const ConfidenceCategoryEnum = z.enum(['low', 'medium', 'high']);
export type ConfidenceCategory = z.infer<typeof ConfidenceCategoryEnum>;

// 2. Normalized Proposition Schema
export const MaterialPropositionSchema = z.object({
  id: z.string().uuid().optional(),
  propositionType: PropositionTypeEnum,
  rawStatement: z.string().min(1).max(10000),
  normalizedSubject: z.string().min(1).max(255),
  normalizedPredicate: z.string().min(1).max(255),
  normalizedObject: z.string().min(1).max(5000),
  normalizedUnit: z.string().max(50).nullable().optional(),
  qualifiers: z
    .object({
      product: z.string().nullable().optional(),
      version: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      plan: z.string().nullable().optional(),
      temporal: z.string().nullable().optional(),
      custom: z.record(z.unknown()).optional()
    })
    .default({}),
  sourcePassageId: z.string().uuid().nullable().optional(),
  charStart: z.number().int().nonnegative().nullable().optional(),
  charEnd: z.number().int().nonnegative().nullable().optional(),
  confidenceScore: z.number().min(0).max(1),
  confidenceCategory: ConfidenceCategoryEnum
});
export type MaterialProposition = z.infer<typeof MaterialPropositionSchema>;

// 3. Extraction Request & Result Schemas
export const ExtractionModelMetadataSchema = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  version: z.string().min(1).max(50)
});
export type ExtractionModelMetadata = z.infer<typeof ExtractionModelMetadataSchema>;

export const ClaimExtractionInputSchema = z.object({
  sourceVersionId: z.string().uuid(),
  sourcePassageId: z.string().uuid().optional(),
  text: z.string().min(1),
  modelMetadata: ExtractionModelMetadataSchema.default({
    provider: 'proofmesh_internal',
    model: 'heuristic_decomposer',
    version: '1.0.0'
  }),
  promptTemplateVersion: z.string().default('v1.0.0')
});
export type ClaimExtractionInput = z.infer<typeof ClaimExtractionInputSchema>;

export const ClaimExtractionResultSchema = z.object({
  extractionId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  propositions: z.array(MaterialPropositionSchema),
  coverageScore: z.number().min(0).max(1),
  rejectedSegments: z.array(
    z.object({
      text: z.string(),
      reason: z.string()
    })
  ),
  modelMetadata: ExtractionModelMetadataSchema,
  promptTemplateVersion: z.string(),
  extractedAt: z.string().datetime()
});
export type ClaimExtractionResult = z.infer<typeof ClaimExtractionResultSchema>;

// 4. Claim Occurrence Schemas
export const ClaimOccurrenceInputSchema = z.object({
  claimVersionId: z.string().uuid(),
  sourceVersionId: z.string().uuid().nullable().optional(),
  sourcePassageId: z.string().uuid().nullable().optional(),
  agentActivityId: z.string().uuid().nullable().optional(),
  contextPacketId: z.string().uuid().nullable().optional(),
  exactPassageText: z.string().min(1),
  charStart: z.number().int().nonnegative().nullable().optional(),
  charEnd: z.number().int().nonnegative().nullable().optional(),
  occurredAt: z
    .string()
    .datetime()
    .default(() => new Date().toISOString())
});
export type ClaimOccurrenceInput = z.infer<typeof ClaimOccurrenceInputSchema>;

export const ClaimOccurrenceDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  claimVersionId: z.string().uuid(),
  sourceVersionId: z.string().uuid().nullable(),
  sourcePassageId: z.string().uuid().nullable(),
  agentActivityId: z.string().uuid().nullable(),
  contextPacketId: z.string().uuid().nullable(),
  exactPassageText: z.string(),
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime()
});
export type ClaimOccurrenceDTO = z.infer<typeof ClaimOccurrenceDTOSchema>;

// 5. Claim Correction Schemas
export const ClaimCorrectionInputSchema = z.object({
  claimVersionId: z.string().uuid(),
  fieldName: z.string().min(1).max(100),
  originalValue: z.string(),
  correctedValue: z.string(),
  correctionReason: z.string().min(1).max(1000)
});
export type ClaimCorrectionInput = z.infer<typeof ClaimCorrectionInputSchema>;

export const ClaimCorrectionDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  claimVersionId: z.string().uuid(),
  correctedByPrincipalId: z.string().uuid(),
  fieldName: z.string(),
  originalValue: z.string(),
  correctedValue: z.string(),
  correctionReason: z.string(),
  correctedAt: z.string().datetime()
});
export type ClaimCorrectionDTO = z.infer<typeof ClaimCorrectionDTOSchema>;

// 6. Duplicate Concept Detection
export const DuplicateConceptCandidateSchema = z.object({
  conceptId: z.string().uuid(),
  conceptKey: z.string(),
  similarityScore: z.number().min(0).max(1),
  scopeDifferences: z.array(z.string()),
  canMerge: z.boolean()
});
export type DuplicateConceptCandidate = z.infer<typeof DuplicateConceptCandidateSchema>;
