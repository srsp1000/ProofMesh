import { describe, it, expect } from 'vitest';
import {
  EventEnvelopeSchema,
  createEventEnvelope
} from '../../packages/contracts/src/events/envelope.js';

describe('EventEnvelope (Contract)', () => {
  it('creates and validates a standard CloudEvents v1.0 envelope', () => {
    const envelope = createEventEnvelope({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      source: '/tenants/t-123/projects/kyc-bot',
      type: 'io.proofmesh.claim.submitted.v1',
      tenantId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'idemp-12345',
      data: {
        claimConceptKey: 'credit-score',
        statement: 'Credit score is 750.'
      }
    });

    expect(envelope.specversion).toBe('1.0');
    expect(envelope.datacontenttype).toBe('application/json');
    expect(envelope.type).toBe('io.proofmesh.claim.submitted.v1');
    expect(envelope.data.claimConceptKey).toBe('credit-score');

    const parsed = EventEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });

  it('rejects an envelope with missing tenantId or invalid UUID format', () => {
    const invalidEnvelope = {
      specversion: '1.0',
      id: 'invalid-uuid',
      source: '/test',
      type: 'io.proofmesh.claim.submitted.v1',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      // tenantId missing
      correlationId: '22222222-2222-4222-8222-222222222222',
      data: {}
    };

    const parsed = EventEnvelopeSchema.safeParse(invalidEnvelope);
    expect(parsed.success).toBe(false);
  });
});
