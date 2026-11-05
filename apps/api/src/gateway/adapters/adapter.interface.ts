import crypto from 'node:crypto';
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toDeterministicUuid(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    '8' + hash.substring(17, 20),
    hash.substring(20, 32)
  ].join('-');
}

export function ensureUuid(value: string | undefined, fallbackSeed: string): string {
  if (value && UUID_REGEX.test(value)) {
    return value;
  }
  return toDeterministicUuid(fallbackSeed);
}
