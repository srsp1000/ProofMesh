import { z } from 'zod';

export const ClaimStatusEnum = z.enum([
  'draft',
  'submitted',
  'evaluating',
  'attested',
  'disputed',
  'rejected',
  'archived'
]);

export type ClaimStatus = z.infer<typeof ClaimStatusEnum>;

export const SubmitClaimSchema = z.object({
  claimConceptKey: z.string().min(1).max(100),
  statement: z.string().min(1).max(10000),
  qualifiers: z.record(z.unknown()).default({}),
  contextPacketId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(128).optional()
});

export type SubmitClaimInput = z.infer<typeof SubmitClaimSchema>;

export const ClaimVersionDTOSchema = z.object({
  id: z.string().uuid(),
  conceptId: z.string().uuid(),
  conceptKey: z.string(),
  versionSequence: z.number().int().positive(),
  statement: z.string(),
  status: ClaimStatusEnum,
  qualifiers: z.record(z.unknown()),
  validFrom: z.string().datetime().nullable(),
  validTo: z.string().datetime().nullable(),
  recordedAt: z.string().datetime()
});

export type ClaimVersionDTO = z.infer<typeof ClaimVersionDTOSchema>;

export const TransitionClaimSchema = z.object({
  targetState: ClaimStatusEnum,
  transitionReason: z.string().min(1).max(1000),
  evidenceAssessmentIds: z.array(z.string().uuid()).default([])
});

export type TransitionClaimInput = z.infer<typeof TransitionClaimSchema>;
