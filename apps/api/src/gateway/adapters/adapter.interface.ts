import type { CanonicalEventEnvelope, ActorIdentity } from '@proofmesh/contracts';

export interface AdapterContext {
  tenantId: string;
  workspaceId?: string;
  projectId?: string;
  actor: ActorIdentity;
}

export interface ProtocolAdapter<TInput, TPayload = Record<string, unknown>> {
  readonly protocolName: string;
  transform(input: TInput, context: AdapterContext): CanonicalEventEnvelope<TPayload>[];
}
