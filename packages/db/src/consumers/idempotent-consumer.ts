import { createHash } from 'node:crypto';
import type { CanonicalEventEnvelope, PriorityLane } from '@proofmesh/contracts';
import { TrafficLaneClassifier } from '@proofmesh/domain';
import type { InboxRepository } from '../repositories/inbox.repository.js';

export type InboxRepositoryClient = Pick<
  InboxRepository,
  'insertEvent' | 'markProcessed' | 'markFailed'
>;

export interface ConsumerExecutionResult<T> {
  status: 'processed' | 'duplicate' | 'failed' | 'dead_letter';
  result?: T;
  error?: string;
  inboxId?: string;
}

export type EventProcessor<T> = (event: CanonicalEventEnvelope) => Promise<T>;

export class IdempotentConsumer<T = unknown> {
  constructor(
    private readonly inboxRepo: InboxRepositoryClient,
    private readonly processor: EventProcessor<T>
  ) {}

  /**
   * Processes an incoming event with strict idempotency, at-least-once delivery guarantees,
   * exponential backoff, and dead-letter routing after retry exhaustion.
   */
  async process(
    tenantId: string,
    event: CanonicalEventEnvelope,
    options?: { lane?: PriorityLane; maxRetries?: number }
  ): Promise<ConsumerExecutionResult<T>> {
    const lane: PriorityLane = options?.lane ?? TrafficLaneClassifier.classify(event.type);
    const contentHash = `sha256:${createHash('sha256')
      .update(JSON.stringify(event.data))
      .digest('hex')}`;
    const idempotencyKey = event.idempotencyKey;

    // 1. Atomically insert or retrieve existing inbox record
    const { record, isDuplicate } = await this.inboxRepo.insertEvent(
      tenantId,
      event,
      lane,
      contentHash,
      idempotencyKey
    );

    // 2. If already processed, skip execution safely without repeating side effects
    if (isDuplicate) {
      if (record.status === 'processed') {
        return {
          status: 'duplicate',
          inboxId: record.id
        };
      }
      if (record.status === 'dead_letter') {
        return {
          status: 'dead_letter',
          error: record.errorDetails ?? 'Event previously moved to dead letter queue',
          inboxId: record.id
        };
      }
    }

    // 3. Execute business processor
    try {
      const result = await this.processor(event);
      await this.inboxRepo.markProcessed(tenantId, record.id);
      return {
        status: 'processed',
        result,
        inboxId: record.id
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const backoffMs = Math.min(1000 * Math.pow(2, record.retryCount), 30000);

      const { movedToDeadLetter } = await this.inboxRepo.markFailed(
        tenantId,
        record.id,
        errorMessage,
        backoffMs
      );

      return {
        status: movedToDeadLetter ? 'dead_letter' : 'failed',
        error: errorMessage,
        inboxId: record.id
      };
    }
  }
}
