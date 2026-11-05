import { z } from 'zod';

export const EvidenceTypeEnum = z.enum([
  'runtime_trace',
  'document_passage',
  'tool_result',
  'human_statement',
  'metric_sample'
]);

export type EvidenceType = z.infer<typeof EvidenceTypeEnum>;

export const EvidenceOutcomeEnum = z.enum(['supports', 'refutes', 'inconclusive', 'contradictory']);

export type EvidenceOutcome = z.infer<typeof EvidenceOutcomeEnum>;

export const EvidenceApplicabilityEnum = z.enum([
  'direct',
  'analogous',
  'contextual',
  'inapplicable'
]);

export type EvidenceApplicability = z.infer<typeof EvidenceApplicabilityEnum>;

export const EvidenceIngestSchema = z.object({
  evidenceType: EvidenceTypeEnum,
  contentPayload: z.union([z.string(), z.record(z.unknown())]),
  sourcePassageId: z.string().uuid().optional(),
  capturedAt: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  idempotencyKey: z.string().min(1).max(128).optional()
});

export type EvidenceIngestInput = z.infer<typeof EvidenceIngestSchema>;

export const EvidenceItemDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  evidenceType: EvidenceTypeEnum,
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sourcePassageId: z.string().uuid().nullable(),
  capturedAt: z.string().datetime(),
  recordedAt: z.string().datetime()
});

export type EvidenceItemDTO = z.infer<typeof EvidenceItemDTOSchema>;
