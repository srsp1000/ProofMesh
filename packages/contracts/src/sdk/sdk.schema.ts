import { z } from 'zod';
import { ClaimStatusEnum } from '../claims/claim.schema.js';
import { PolicyDispositionEnum } from '../policy/policy.schema.js';

// 1. Context Packet Schemas
export const ContextPassageInputSchema = z.object({
  passageId: z.string().uuid().optional(),
  uri: z.string().optional(),
  content: z.string().min(1),
  contentHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  score: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional()
});
export type ContextPassageInput = z.infer<typeof ContextPassageInputSchema>;

export const ContextPacketCreateInputSchema = z.object({
  packetType: z.enum(['rag_retrieval', 'agent_memory', 'prompt_context', 'tool_output']),
  passages: z.array(ContextPassageInputSchema).min(1),
  totalTokens: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(128).optional()
});
export type ContextPacketCreateInput = z.infer<typeof ContextPacketCreateInputSchema>;

export const ContextPacketDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  packetType: z.enum(['rag_retrieval', 'agent_memory', 'prompt_context', 'tool_output']),
  passages: z.array(
    z.object({
      passageId: z.string().uuid(),
      uri: z.string().optional(),
      content: z.string(),
      contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      score: z.number().optional()
    })
  ),
  totalTokens: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime()
});
export type ContextPacketDTO = z.infer<typeof ContextPacketDTOSchema>;

// 2. Dependency Declaration Schemas
export const DependencyRelationshipEnum = z.enum([
  'supports',
  'presupposes',
  'refutes',
  'qualifies'
]);
export type DependencyRelationship = z.infer<typeof DependencyRelationshipEnum>;

export const DependencyDeclareInputSchema = z.object({
  dependentEntityId: z.string().uuid(),
  dependentEntityType: z.enum(['claim', 'decision', 'artifact']),
  prerequisiteEntityId: z.string().uuid(),
  prerequisiteEntityType: z.enum(['claim', 'passage', 'artifact', 'decision']),
  relationshipType: DependencyRelationshipEnum,
  declarationReason: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(1).max(128).optional()
});
export type DependencyDeclareInput = z.infer<typeof DependencyDeclareInputSchema>;

export const DependencyDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  dependentEntityId: z.string().uuid(),
  dependentEntityType: z.enum(['claim', 'decision', 'artifact']),
  prerequisiteEntityId: z.string().uuid(),
  prerequisiteEntityType: z.enum(['claim', 'passage', 'artifact', 'decision']),
  relationshipType: DependencyRelationshipEnum,
  declarationReason: z.string().nullable().optional(),
  declaredAt: z.string().datetime()
});
export type DependencyDTO = z.infer<typeof DependencyDTOSchema>;

// 3. Decision Registration Schemas
export const DecisionOutcomeEnum = z.enum([
  'approved',
  'rejected',
  'referred',
  'escalated',
  'overridden'
]);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeEnum>;

export const AdmissibilityStatusEnum = z.enum(['admissible', 'inadmissible', 'conditional']);
export type AdmissibilityStatus = z.infer<typeof AdmissibilityStatusEnum>;

export const DecisionRegisterInputSchema = z.object({
  decisionType: z.string().min(1).max(100),
  outcome: DecisionOutcomeEnum,
  rationale: z.string().min(1).max(5000),
  contributingClaimIds: z.array(z.string().uuid()).default([]),
  policyVersionId: z.string().uuid().optional(),
  admissibilityStatus: AdmissibilityStatusEnum.default('admissible'),
  idempotencyKey: z.string().min(1).max(128).optional()
});
export type DecisionRegisterInput = z.infer<typeof DecisionRegisterInputSchema>;

export const DecisionDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  decisionType: z.string(),
  outcome: DecisionOutcomeEnum,
  rationale: z.string(),
  contributingClaimIds: z.array(z.string().uuid()),
  policyVersionId: z.string().uuid().nullable().optional(),
  admissibilityStatus: AdmissibilityStatusEnum,
  registeredAt: z.string().datetime()
});
export type DecisionDTO = z.infer<typeof DecisionDTOSchema>;

// 4. Admissibility Check Schemas
export const AdmissibilityCheckInputSchema = z.object({
  claimVersionId: z.string().uuid(),
  policyName: z.string().optional(),
  contextParameters: z.record(z.unknown()).default({})
});
export type AdmissibilityCheckInput = z.infer<typeof AdmissibilityCheckInputSchema>;

export const AdmissibilityCheckResultSchema = z.object({
  evaluationId: z.string().uuid(),
  claimVersionId: z.string().uuid(),
  disposition: PolicyDispositionEnum,
  isAdmissible: z.boolean(),
  rulesTriggered: z.array(z.string()),
  reasons: z.array(z.string()),
  evaluatedAt: z.string().datetime()
});
export type AdmissibilityCheckResult = z.infer<typeof AdmissibilityCheckResultSchema>;

// 5. Human Review Request Schemas
export const HumanReviewStatusEnum = z.enum([
  'pending',
  'in_review',
  'approved',
  'rejected',
  'reassigned'
]);
export type HumanReviewStatus = z.infer<typeof HumanReviewStatusEnum>;

export const HumanReviewRequestInputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(5000),
  requiredRole: z.string().min(1).max(100).default('compliance_officer'),
  claimId: z.string().uuid().optional(),
  decisionId: z.string().uuid().optional(),
  decisionPolicy: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  idempotencyKey: z.string().min(1).max(128).optional()
});
export type HumanReviewRequestInput = z.infer<typeof HumanReviewRequestInputSchema>;

export const HumanReviewDTOSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string(),
  summary: z.string(),
  requiredRole: z.string(),
  claimId: z.string().uuid().nullable().optional(),
  decisionId: z.string().uuid().nullable().optional(),
  decisionPolicy: z.string().nullable().optional(),
  status: HumanReviewStatusEnum,
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  reviewerId: z.string().uuid().nullable().optional(),
  reviewNotes: z.string().nullable().optional(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional()
});
export type HumanReviewDTO = z.infer<typeof HumanReviewDTOSchema>;

// 6. Lineage Impact Query & Report Schemas
export const LineageImpactQuerySchema = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['claim', 'artifact', 'decision']),
  maxDepth: z.number().int().min(1).max(10).default(5)
});
export type LineageImpactQuery = z.infer<typeof LineageImpactQuerySchema>;

export const LineageImpactReportSchema = z.object({
  rootEntityId: z.string().uuid(),
  rootEntityType: z.enum(['claim', 'artifact', 'decision']),
  directDependentsCount: z.number().int().nonnegative(),
  totalDownstreamAffectedCount: z.number().int().nonnegative(),
  affectedDecisions: z.array(
    z.object({
      decisionId: z.string().uuid(),
      decisionType: z.string(),
      outcome: DecisionOutcomeEnum
    })
  ),
  affectedClaims: z.array(
    z.object({
      claimId: z.string().uuid(),
      conceptKey: z.string(),
      status: ClaimStatusEnum
    })
  ),
  generatedAt: z.string().datetime()
});
export type LineageImpactReport = z.infer<typeof LineageImpactReportSchema>;
