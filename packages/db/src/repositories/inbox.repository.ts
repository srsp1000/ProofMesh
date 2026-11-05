import type { Pool } from 'pg';
import type { CanonicalEventEnvelope, PriorityLane } from '@proofmesh/contracts';
import { TenantScopedRepository } from './tenant-scoped.repository.js';

export interface InboxEventRecord {
  id: string;
  tenantId: string;
  eventId: string;
  idempotencyKey: string;
  eventType: string;
  priorityLane: PriorityLane;
  status: 'pending' | 'processing' | 'processed' | 'failed' | 'dead_letter';
  payload: CanonicalEventEnvelope;
  contentHash: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string;
  errorDetails: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeadLetterRecord {
  id: string;
  tenantId: string;
  inboxEventId: string;
  eventId: string;
  eventType: string;
  payload: CanonicalEventEnvelope;
  failureReason: string;
  retryCount: number;
  replayedAt: string | null;
  replayedBy: string | null;
  createdAt: string;
}

export interface InboxLagMetrics {
  highPriorityPending: number;
  bulkTelemetryPending: number;
  oldestUnprocessedSec: number;
}

export class InboxRepository extends TenantScopedRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Inserts an event into the inbox, atomically detecting duplicates via (tenant_id, idempotency_key).
   */
  async insertEvent(
    tenantId: string,
    event: CanonicalEventEnvelope,
    lane: PriorityLane,
    contentHash: string,
    idempotencyKey: string
  ): Promise<{ record: InboxEventRecord; isDuplicate: boolean }> {
    return this.withTenantContext(tenantId, async (client) => {
      // Check for existing duplicate by idempotency_key OR event_id
      const existing = await client.query(
        `SELECT * FROM inbox_events 
         WHERE tenant_id = $1 AND (idempotency_key = $2 OR event_id = $3)`,
        [tenantId, idempotencyKey, event.id]
      );

      if (existing.rows.length > 0) {
        return {
          record: this.mapRowToRecord(existing.rows[0]),
          isDuplicate: true
        };
      }

      // Insert new pending event
      const res = await client.query(
        `INSERT INTO inbox_events (
           tenant_id, event_id, idempotency_key, event_type, 
           priority_lane, status, payload, content_hash, 
           retry_count, max_retries, next_retry_at
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, 0, 3, NOW())
         RETURNING *`,
        [tenantId, event.id, idempotencyKey, event.type, lane, JSON.stringify(event), contentHash]
      );

      return {
        record: this.mapRowToRecord(res.rows[0]),
        isDuplicate: false
      };
    });
  }

  /**
   * Claims a batch of pending events for processing using FOR UPDATE SKIP LOCKED.
   */
  async claimPendingBatch(
    tenantId: string,
    lane: PriorityLane,
    batchSize: number = 10
  ): Promise<InboxEventRecord[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE inbox_events
         SET status = 'processing', updated_at = NOW()
         WHERE id IN (
           SELECT id FROM inbox_events
           WHERE tenant_id = $1 
             AND priority_lane = $2 
             AND status IN ('pending', 'failed')
             AND next_retry_at <= NOW()
           ORDER BY created_at ASC
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [tenantId, lane, batchSize]
      );

      return res.rows.map((row) => this.mapRowToRecord(row));
    });
  }

  /**
   * Marks an event as successfully processed.
   */
  async markProcessed(tenantId: string, id: string): Promise<void> {
    await this.withTenantContext(tenantId, async (client) => {
      await client.query(
        `UPDATE inbox_events 
         SET status = 'processed', processed_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );
    });
  }

  /**
   * Marks an event as failed, applying exponential backoff or routing to dead-letter queue.
   */
  async markFailed(
    tenantId: string,
    id: string,
    error: string,
    backoffMs: number
  ): Promise<{ movedToDeadLetter: boolean }> {
    return this.withTenantContext(tenantId, async (client) => {
      const checkRes = await client.query(
        `SELECT retry_count, max_retries, event_id, event_type, payload 
         FROM inbox_events WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );

      if (checkRes.rows.length === 0) {
        return { movedToDeadLetter: false };
      }

      const row = checkRes.rows[0];
      const newRetryCount = row.retry_count + 1;

      if (newRetryCount >= row.max_retries) {
        // Move to dead letter queue
        await client.query(
          `UPDATE inbox_events 
           SET status = 'dead_letter', retry_count = $1, error_details = $2, updated_at = NOW()
           WHERE tenant_id = $3 AND id = $4`,
          [newRetryCount, error, tenantId, id]
        );

        await client.query(
          `INSERT INTO dead_letter_events (
             tenant_id, inbox_event_id, event_id, event_type, payload, failure_reason, retry_count
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, id, row.event_id, row.event_type, row.payload, error, newRetryCount]
        );

        return { movedToDeadLetter: true };
      }

      // Schedule next retry with exponential backoff
      await client.query(
        `UPDATE inbox_events 
         SET status = 'failed', retry_count = $1, error_details = $2, 
             next_retry_at = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW()
         WHERE tenant_id = $4 AND id = $5`,
        [newRetryCount, error, backoffMs, tenantId, id]
      );

      return { movedToDeadLetter: false };
    });
  }

  /**
   * Replays a dead letter event, re-enqueuing it into pending status.
   */
  async replayDeadLetter(
    tenantId: string,
    deadLetterId: string,
    replayedBy?: string
  ): Promise<InboxEventRecord | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const dlRes = await client.query(
        `SELECT * FROM dead_letter_events WHERE tenant_id = $1 AND id = $2`,
        [tenantId, deadLetterId]
      );

      if (dlRes.rows.length === 0) {
        return null;
      }

      const dlRow = dlRes.rows[0];

      // Mark dead letter as replayed
      await client.query(
        `UPDATE dead_letter_events 
         SET replayed_at = NOW(), replayed_by = $1, updated_at = NOW()
         WHERE id = $2`,
        [replayedBy ?? null, deadLetterId]
      );

      // Reset inbox event to pending with 0 retries
      const updatedInbox = await client.query(
        `UPDATE inbox_events 
         SET status = 'pending', retry_count = 0, next_retry_at = NOW(), 
             error_details = 'Manual replay initiated', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, dlRow.inbox_event_id]
      );

      return updatedInbox.rows[0] ? this.mapRowToRecord(updatedInbox.rows[0]) : null;
    });
  }

  /**
   * Retrieves queue lag metrics.
   */
  async getLag(tenantId?: string): Promise<InboxLagMetrics> {
    const whereTenant = tenantId ? `WHERE tenant_id = '${tenantId}'` : '';
    const res = await this.pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE priority_lane = 'high_priority' AND status IN ('pending', 'processing')) AS high_pending,
         COUNT(*) FILTER (WHERE priority_lane = 'bulk_telemetry' AND status IN ('pending', 'processing')) AS bulk_pending,
         COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) FILTER (WHERE status IN ('pending', 'processing')), 0) AS oldest_unprocessed
       FROM inbox_events ${whereTenant}`
    );

    const row = res.rows[0];
    return {
      highPriorityPending: parseInt(row?.high_pending ?? '0', 10),
      bulkTelemetryPending: parseInt(row?.bulk_pending ?? '0', 10),
      oldestUnprocessedSec: parseFloat(row?.oldest_unprocessed ?? '0')
    };
  }

  private mapRowToRecord(row: Record<string, unknown>): InboxEventRecord {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      eventId: row.event_id as string,
      idempotencyKey: row.idempotency_key as string,
      eventType: row.event_type as string,
      priorityLane: row.priority_lane as PriorityLane,
      status: row.status as 'pending' | 'processing' | 'processed' | 'failed' | 'dead_letter',
      payload: (typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : row.payload) as CanonicalEventEnvelope,
      contentHash: row.content_hash as string,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      nextRetryAt: (row.next_retry_at as Date)?.toISOString?.() ?? (row.next_retry_at as string),
      errorDetails: (row.error_details as string) ?? null,
      processedAt:
        (row.processed_at as Date)?.toISOString?.() ?? (row.processed_at as string) ?? null,
      createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
      updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string)
    };
  }
}
