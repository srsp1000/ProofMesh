import { z } from 'zod';

export const PolicyDispositionEnum = z.enum([
  'admit',
  'deny',
  'require_human_review',
  'warn',
  'remediate'
]);

export type PolicyDisposition = z.infer<typeof PolicyDispositionEnum>;

export const PolicyEvaluateRequestSchema = z.object({
  action: z.string().min(1),
  claimVersionId: z.string().uuid().optional(),
  parameters: z.record(z.unknown()).default({}),
  enforcementMode: z.enum(['synchronous', 'asynchronous']).default('synchronous'),
  failPolicy: z.enum(['fail_open', 'fail_closed']).default('fail_closed')
});

export type PolicyEvaluateRequest = z.infer<typeof PolicyEvaluateRequestSchema>;

export const PolicyEvaluationDTOSchema = z.object({
  evaluationId: z.string().uuid(),
  policyVersionId: z.string().uuid(),
  actionType: z.string(),
  disposition: PolicyDispositionEnum,
  rulesTriggered: z.array(z.string()),
  remediationNotes: z.string().nullable(),
  evaluationLatencyMs: z.number().int().nonnegative(),
  evaluatedAt: z.string().datetime()
});

export type PolicyEvaluationDTO = z.infer<typeof PolicyEvaluationDTOSchema>;
