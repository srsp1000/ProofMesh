import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createCanonicalEnvelope } from '../../packages/contracts/src/events/canonical-envelope.schema.js';
import { IdempotentConsumer } from '../../packages/db/src/consumers/idempotent-consumer.js';
import { InMemoryInboxRepository } from '../fixtures/in-memory-repositories.js';

describe('IdempotentConsumer & Durable Inbox (Unit)', () => {
  const tenantId = crypto.randomUUID();
  const actor = { principalId: crypto.randomUUID(), principalType: 'service_account' as const };

  it('processes an event and marks it processed in the inbox', async () => {
    const inboxRepo = new InMemoryInboxRepository();
    let sideEffectCount = 0;

    const consumer = new IdempotentConsumer(inboxRepo, async (evt) => {
      sideEffectCount++;
      return { ok: true, payloadLength: Object.keys(evt.data).length };
    });

    const event = createCanonicalEnvelope({
      id: crypto.randomUUID(),
      source: '/test',
      type: 'io.proofmesh.claim.registered.v1',
      tenantId,
      actor,
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'idemp-001',
      data: { statement: 'Test claim statement' }
    });

    const res = await consumer.process(tenantId, event);

    expect(res.status).toBe('processed');
    expect(res.result).toEqual({ ok: true, payloadLength: 1 });
    expect(sideEffectCount).toBe(1);

    const record = inboxRepo.records.find((r) => r.id === res.inboxId);
    expect(record?.status).toBe('processed');
  });

  it('prevents duplicate external side effects when receiving duplicate events', async () => {
    const inboxRepo = new InMemoryInboxRepository();
    let externalSideEffectCount = 0;

    const consumer = new IdempotentConsumer(inboxRepo, async () => {
      externalSideEffectCount++;
      return 'sent_email';
    });

    const event = createCanonicalEnvelope({
      id: crypto.randomUUID(),
      source: '/test',
      type: 'io.proofmesh.claim.registered.v1',
      tenantId,
      actor,
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'idemp-duplicate-safe',
      data: { statement: 'Test duplicate safety' }
    });

    // 1st delivery
    const firstRes = await consumer.process(tenantId, event);
    expect(firstRes.status).toBe('processed');
    expect(externalSideEffectCount).toBe(1);

    // 2nd delivery (duplicate with same idempotency key)
    const secondRes = await consumer.process(tenantId, event);
    expect(secondRes.status).toBe('duplicate');
    // Critical: side effect must NOT be called a second time
    expect(externalSideEffectCount).toBe(1);
  });

  it('applies exponential backoff and routes to dead letter after retry exhaustion', async () => {
    const inboxRepo = new InMemoryInboxRepository();
    let attemptCount = 0;

    const consumer = new IdempotentConsumer(inboxRepo, async () => {
      attemptCount++;
      throw new Error(`Transient database failure (attempt ${attemptCount})`);
    });

    const event = createCanonicalEnvelope({
      id: crypto.randomUUID(),
      source: '/test',
      type: 'io.proofmesh.claim.registered.v1',
      tenantId,
      actor,
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'idemp-retry-fail',
      data: { statement: 'Test retry fail' }
    });

    // Attempt 1: fail -> retryCount = 1
    const res1 = await consumer.process(tenantId, event);
    expect(res1.status).toBe('failed');
    let record = inboxRepo.records.find((r) => r.id === res1.inboxId);
    expect(record?.retryCount).toBe(1);

    // Attempt 2: fail -> retryCount = 2
    const res2 = await consumer.process(tenantId, event);
    expect(res2.status).toBe('failed');
    record = inboxRepo.records.find((r) => r.id === res2.inboxId);
    expect(record?.retryCount).toBe(2);

    // Attempt 3: fail -> retryCount = 3 (max_retries reached) -> dead_letter
    const res3 = await consumer.process(tenantId, event);
    expect(res3.status).toBe('dead_letter');
    record = inboxRepo.records.find((r) => r.id === res3.inboxId);
    expect(record?.status).toBe('dead_letter');

    // Dead letter queue populated
    expect(inboxRepo.deadLetters.length).toBe(1);
    expect(inboxRepo.deadLetters[0]?.failureReason).toContain('Transient database failure');
  });

  it('allows manual dead letter replay', async () => {
    const inboxRepo = new InMemoryInboxRepository();
    const event = createCanonicalEnvelope({
      id: crypto.randomUUID(),
      source: '/test',
      type: 'io.proofmesh.claim.registered.v1',
      tenantId,
      actor,
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'idemp-dlq-replay',
      data: { statement: 'Test dlq' }
    });

    // Directly insert failing record
    const { record } = await inboxRepo.insertEvent(
      tenantId,
      event,
      'bulk_telemetry',
      'hash',
      'idemp-dlq-replay'
    );
    await inboxRepo.markFailed(tenantId, record.id, 'Failure 1', 100);
    await inboxRepo.markFailed(tenantId, record.id, 'Failure 2', 100);
    const { movedToDeadLetter } = await inboxRepo.markFailed(tenantId, record.id, 'Failure 3', 100);
    expect(movedToDeadLetter).toBe(true);

    const deadLetterId = inboxRepo.deadLetters[0]!.id;

    // Execute manual replay
    const replayed = await inboxRepo.replayDeadLetter(tenantId, deadLetterId, actor.principalId);
    expect(replayed).not.toBeNull();
    expect(replayed?.status).toBe('pending');
    expect(replayed?.retryCount).toBe(0);
    expect(inboxRepo.deadLetters[0]?.replayedAt).not.toBeNull();
  });
});
