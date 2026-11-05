import { z } from 'zod';
import { PrincipalTypeEnum, type PrincipalType } from '../identity/identity.schema.js';

export const CaptureMethodEnum = z.enum([
  'captured',
  'declared',
  'attested',
  'inferred',
  'unknown'
]);
export type CaptureMethod = z.infer<typeof CaptureMethodEnum>;

export const ContentModeEnum = z.enum([
  'metadata_only',
  'redacted',
  'full_content',
  'reference_only'
]);
export type ContentMode = z.infer<typeof ContentModeEnum>;

export const ActorIdentitySchema = z.object({
  principalId: z.string().uuid(),
  principalType: PrincipalTypeEnum
});
export type ActorIdentity = z.infer<typeof ActorIdentitySchema>;

export const CanonicalEventEnvelopeSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.string().uuid(),
  source: z.string().min(1),
  type: z.string().regex(/^io\.proofmesh\.[a-z0-9_.-]+\.v[1-9][0-9]*$/),
  time: z.string().datetime(),
  datacontenttype: z.literal('application/json'),
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  schemaVersion: z.string().regex(/^[0-9]+\.[0-9]+(\.[0-9]+)?$/),
  sourceIntegration: z.string().min(1),
  instanceIdentity: z.string().min(1),
  actor: ActorIdentitySchema,
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  workflowId: z.string().optional(),
  captureMethod: CaptureMethodEnum,
  contentMode: ContentModeEnum,
  idempotencyKey: z.string().min(1),
  payloadRef: z.string().optional(),
  data: z.record(z.unknown())
});

export type CanonicalEventEnvelope<T = Record<string, unknown>> = Omit<
  z.infer<typeof CanonicalEventEnvelopeSchema>,
  'data'
> & {
  data: T;
};

export function createCanonicalEnvelope<T extends Record<string, unknown>>(params: {
  id: string;
  source: string;
  type: string;
  tenantId: string;
  workspaceId?: string;
  projectId?: string;
  schemaVersion?: string;
  sourceIntegration?: string;
  instanceIdentity?: string;
  actor: {
    principalId: string;
    principalType: PrincipalType;
  };
  occurredAt?: string;
  receivedAt?: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  spanId?: string;
  workflowId?: string;
  captureMethod?: CaptureMethod;
  contentMode?: ContentMode;
  idempotencyKey: string;
  payloadRef?: string;
  data: T;
}): CanonicalEventEnvelope<T> {
  const now = new Date().toISOString();
  const envelope: CanonicalEventEnvelope<T> = {
    specversion: '1.0',
    id: params.id,
    source: params.source,
    type: params.type,
    time: params.occurredAt ?? now,
    datacontenttype: 'application/json',
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    schemaVersion: params.schemaVersion ?? '1.0.0',
    sourceIntegration: params.sourceIntegration ?? 'proofmesh_gateway',
    instanceIdentity: params.instanceIdentity ?? 'default_instance',
    actor: params.actor,
    occurredAt: params.occurredAt ?? now,
    receivedAt: params.receivedAt ?? now,
    correlationId: params.correlationId,
    causationId: params.causationId,
    traceId: params.traceId,
    spanId: params.spanId,
    workflowId: params.workflowId,
    captureMethod: params.captureMethod ?? 'captured',
    contentMode: params.contentMode ?? 'metadata_only',
    idempotencyKey: params.idempotencyKey,
    payloadRef: params.payloadRef,
    data: params.data
  };

  CanonicalEventEnvelopeSchema.parse(envelope);
  return envelope;
}
