import type { Pool } from 'pg';
import type { CanonicalEventEnvelope, PriorityLane } from '@proofmesh/contracts';
import { TenantScopedRepository } from './tenant-scoped.repository.js';

export interface OutboxEventRecord {
  id: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  priorityLane: PriorityLane;
  status: 'pending' | 'published' | 'failed';
  payload: CanonicalEventEnvelope;
  retryCount: number;
  maxRetries: number;
  publishedAt: string | null;
  errorDetails: string | null;
  createdAt: string;
  updatedAt: string;
}

export class OutboxRepository extends TenantScopedRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Appends an event to the outbox inside a transactional unit of work.
   */
  async appendEvent(
    tenantId: string,
    event: CanonicalEventEnvelope,
    lane: PriorityLane = 'bulk_telemetry'
  ): Promise<OutboxEventRecord> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO outbox_events (
           tenant_id, event_id, event_type, priority_lane, 
           status, payload, retry_count, max_retries
         ) VALUES ($1, $2, $3, $4, 'pending', $5, 0, 5)
         RETURNING *`,
        [tenantId, event.id, event.type, lane, JSON.stringify(event)]
      );

      return this.mapRowToRecord(res.rows[0]);
    });
  }

  /**
   * Claims a batch of pending outbox events for publishing across tenants.
   */
  async claimPendingBatch(
    lane: PriorityLane,
    batchSize: number = 20
  ): Promise<OutboxEventRecord[]> {
    const res = await this.pool.query(
      `UPDATE outbox_events
       SET updated_at = NOW()
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE priority_lane = $1 AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [lane, batchSize]
    );

    return res.rows.map((row) => this.mapRowToRecord(row));
  }

  /**
   * Marks an outbox event as published.
   */
  async markPublished(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events 
       SET status = 'published', published_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Marks an outbox event as failed.
   */
  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events 
       SET status = CASE WHEN retry_count + 1 >= max_retries THEN 'failed' ELSE 'pending' END,
           retry_count = retry_count + 1,
           error_details = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [error, id]
    );
  }

  /**
   * Retrieves pending counts across lanes.
   */
  async getPendingCount(): Promise<{ highPriority: number; bulkTelemetry: number }> {
    const res = await this.pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE priority_lane = 'high_priority' AND status = 'pending') AS high_pending,
         COUNT(*) FILTER (WHERE priority_lane = 'bulk_telemetry' AND status = 'pending') AS bulk_pending
       FROM outbox_events`
    );

    const row = res.rows[0];
    return {
      highPriority: parseInt(row?.high_pending ?? '0', 10),
      bulkTelemetry: parseInt(row?.bulk_pending ?? '0', 10)
    };
  }

  private mapRowToRecord(row: Record<string, unknown>): OutboxEventRecord {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      eventId: row.event_id as string,
      eventType: row.event_type as string,
      priorityLane: row.priority_lane as PriorityLane,
      status: row.status as 'pending' | 'published' | 'failed',
      payload: (typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : row.payload) as CanonicalEventEnvelope,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      publishedAt:
        (row.published_at as Date)?.toISOString?.() ?? (row.published_at as string) ?? null,
      errorDetails: (row.error_details as string) ?? null,
      createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
      updatedAt: (row.updated_at as Date)?.toISOString?.() ?? (row.updated_at as string)
    };
  }
}
