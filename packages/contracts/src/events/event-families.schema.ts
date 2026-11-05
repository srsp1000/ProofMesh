import { z } from 'zod';

// 1. Telemetry Span Received
export const TelemetrySpanReceivedV1Schema = z.object({
  spanId: z.string().min(1),
  traceId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().min(1),
  kind: z.enum(['client', 'server', 'producer', 'consumer', 'internal']),
  startTimeUnixNano: z.union([z.string(), z.number()]),
  endTimeUnixNano: z.union([z.string(), z.number()]),
  attributes: z.record(z.unknown()).default({}),
  events: z
    .array(
      z.object({
        name: z.string().min(1),
        timeUnixNano: z.union([z.string(), z.number()]),
        attributes: z.record(z.unknown()).optional()
      })
    )
    .default([]),
  status: z.object({
    code: z.enum(['unset', 'ok', 'error']),
    message: z.string().optional()
  })
});
export type TelemetrySpanReceivedV1 = z.infer<typeof TelemetrySpanReceivedV1Schema>;

// 2. Agent / Workflow Activity
export const AgentActivityV1Schema = z.object({
  activityId: z.string().uuid(),
  agentId: z.string().min(1),
  agentRole: z.string().min(1),
  activityType: z.enum([
    'tool_call',
    'prompt_invocation',
    'planning',
    'subagent_spawn',
    'state_transition'
  ]),
  toolName: z.string().optional(),
  toolParameters: z.record(z.unknown()).optional(),
  executionStatus: z.enum(['started', 'running', 'completed', 'failed']),
  durationMs: z.number().nonnegative().optional(),
  errorDetails: z.string().optional()
});
export type AgentActivityV1 = z.infer<typeof AgentActivityV1Schema>;

// 3. Message Observed
export const MessageObservedV1Schema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().min(1),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  tokenCount: z.number().int().nonnegative().optional(),
  model: z.string().optional()
});
export type MessageObservedV1 = z.infer<typeof MessageObservedV1Schema>;

// 4. Source Artifact Registered / Updated
export const SourceArtifactRegisteredV1Schema = z.object({
  artifactId: z.string().uuid(),
  artifactVersion: z.number().int().positive(),
  uri: z.string().min(1),
  mimeType: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  action: z.enum(['registered', 'updated', 'archived'])
});
export type SourceArtifactRegisteredV1 = z.infer<typeof SourceArtifactRegisteredV1Schema>;

// 5. Claim Observed / Registered
export const ClaimRegisteredV1Schema = z.object({
  claimConceptId: z.string().uuid(),
  claimVersionId: z.string().uuid(),
  conceptKey: z.string().min(1),
  statement: z.string().min(1),
  status: z.enum(['draft', 'submitted', 'evaluating', 'attested', 'disputed', 'rejected']),
  qualifiers: z.record(z.unknown()).default({})
});
export type ClaimRegisteredV1 = z.infer<typeof ClaimRegisteredV1Schema>;

// 6. Context Packet Created
export const ContextPacketCreatedV1Schema = z.object({
  contextPacketId: z.string().uuid(),
  packetType: z.enum(['rag_retrieval', 'agent_memory', 'prompt_context', 'tool_output']),
  passages: z.array(
    z.object({
      passageId: z.string().uuid(),
      contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      score: z.number().optional()
    })
  ),
  totalTokens: z.number().int().nonnegative().optional()
});
export type ContextPacketCreatedV1 = z.infer<typeof ContextPacketCreatedV1Schema>;

// 7. Dependency Declared
export const DependencyDeclaredV1Schema = z.object({
  edgeId: z.string().uuid(),
  sourceType: z.enum(['claim', 'evidence', 'artifact', 'activity']),
  sourceId: z.string().uuid(),
  targetType: z.enum(['claim', 'evidence', 'artifact', 'activity']),
  targetId: z.string().uuid(),
  dependencyType: z.enum(['requires', 'derives_from', 'corroborates', 'contradicts', 'supersedes']),
  captureMethod: z.enum(['captured', 'declared', 'attested', 'inferred', 'unknown'])
});
export type DependencyDeclaredV1 = z.infer<typeof DependencyDeclaredV1Schema>;

// 8. Artifact / Decision Registered
export const DecisionRegisteredV1Schema = z.object({
  decisionId: z.string().uuid(),
  decisionType: z.enum([
    'policy_disposition',
    'human_verdict',
    'automated_admission',
    'remediation_trigger'
  ]),
  disposition: z.enum(['admit', 'deny', 'require_human_review', 'warn', 'remediate']),
  targetEntityId: z.string().uuid(),
  targetEntityType: z.string().min(1),
  rationale: z.string().min(1)
});
export type DecisionRegisteredV1 = z.infer<typeof DecisionRegisteredV1Schema>;

// 9. Review / Approval Event
export const ReviewApprovalV1Schema = z.object({
  approvalId: z.string().uuid(),
  reviewCaseId: z.string().uuid(),
  reviewerPrincipalId: z.string().uuid(),
  verdict: z.enum(['approved', 'rejected', 'amended']),
  statement: z.string().min(1),
  digitalSignature: z.string().optional()
});
export type ReviewApprovalV1 = z.infer<typeof ReviewApprovalV1Schema>;

// 10. Remediation Event
export const RemediationEventV1Schema = z.object({
  remediationId: z.string().uuid(),
  caseId: z.string().uuid(),
  remediationType: z.enum([
    'prompt_adjustment',
    'model_fallback',
    'context_filter',
    'token_revoke',
    'manual_intervention'
  ]),
  status: z.enum(['initiated', 'in_progress', 'completed', 'failed']),
  actionsTaken: z.array(z.string()).default([])
});
export type RemediationEventV1 = z.infer<typeof RemediationEventV1Schema>;

// 11. Connector Health Event
export const ConnectorHealthV1Schema = z.object({
  connectorId: z.string().min(1),
  connectorType: z.enum(['otel', 'langchain', 'mcp', 'webhook', 'slack']),
  status: z.enum(['healthy', 'degraded', 'failing', 'offline']),
  latencyMs: z.number().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  lastHeartbeat: z.string().datetime()
});
export type ConnectorHealthV1 = z.infer<typeof ConnectorHealthV1Schema>;

export const EVENT_TYPE_MAP = {
  'io.proofmesh.telemetry.span.received.v1': TelemetrySpanReceivedV1Schema,
  'io.proofmesh.agent.activity.v1': AgentActivityV1Schema,
  'io.proofmesh.message.observed.v1': MessageObservedV1Schema,
  'io.proofmesh.source.artifact.registered.v1': SourceArtifactRegisteredV1Schema,
  'io.proofmesh.claim.registered.v1': ClaimRegisteredV1Schema,
  'io.proofmesh.context.packet.created.v1': ContextPacketCreatedV1Schema,
  'io.proofmesh.dependency.declared.v1': DependencyDeclaredV1Schema,
  'io.proofmesh.decision.registered.v1': DecisionRegisteredV1Schema,
  'io.proofmesh.review.approval.v1': ReviewApprovalV1Schema,
  'io.proofmesh.remediation.event.v1': RemediationEventV1Schema,
  'io.proofmesh.connector.health.v1': ConnectorHealthV1Schema
} as const;

export type SupportedEventType = keyof typeof EVENT_TYPE_MAP;
