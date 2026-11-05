import type pg from 'pg';
import { TenantScopedRepository } from './tenant-scoped.repository.js';
import { MerkleTree } from '@proofmesh/domain';
import type {
  AuditEventDTO,
  CreateAuditEventInput,
  AuditCheckpointDTO,
  AuditQueryFilter
} from '@proofmesh/contracts';

export class AuditRepository extends TenantScopedRepository {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  /**
   * Appends an immutable audit event to the tenant's append-only audit ledger.
   * Calculates SHA-256 payload hash and links to the preceding event's hash.
   */
  async appendAuditEvent(input: CreateAuditEventInput): Promise<AuditEventDTO> {
    return this.withTenantContext(input.tenantId, async (client) => {
      // 1. Fetch latest preceding event hash in this tenant's chain
      const lastRes = await client.query(
        `SELECT payload_hash FROM audit_events 
         WHERE tenant_id = $1 
         ORDER BY id DESC LIMIT 1`,
        [input.tenantId]
      );
      const prevEventHash =
        lastRes.rows.length > 0 ? (lastRes.rows[0].payload_hash as string) : null;

      // 2. Compute canonical payload hash
      const payloadHash = MerkleTree.hashPayload(input.payload);

      // 3. Insert audit record
      const res = await client.query(
        `INSERT INTO audit_events (
           tenant_id, principal_id, action, entity_type, entity_id, 
           payload_hash, payload_diff, prev_event_hash, correlation_id, policy_decision
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING 
           id, tenant_id AS "tenantId", principal_id AS "principalId", action, 
           entity_type AS "entityType", entity_id AS "entityId", payload_hash AS "payloadHash", 
           payload_diff AS "payloadDiff", prev_event_hash AS "prevEventHash", 
           correlation_id AS "correlationId", policy_decision AS "policyDecision", 
           recorded_at AS "recordedAt"`,
        [
          input.tenantId,
          input.principalId ?? null,
          input.action,
          input.entityType,
          input.entityId,
          payloadHash,
          input.payloadDiff ? JSON.stringify(input.payloadDiff) : null,
          prevEventHash,
          input.correlationId ?? null,
          input.policyDecision ?? null
        ]
      );

      const row = res.rows[0];
      return {
        ...row,
        id: row.id.toString(),
        recordedAt: row.recordedAt.toISOString()
      };
    });
  }

  /**
   * Queries audit events within the tenant boundary using filtering options.
   */
  async queryAuditEvents(filter: AuditQueryFilter): Promise<AuditEventDTO[]> {
    return this.withTenantContext(filter.tenantId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [filter.tenantId];

      if (filter.principalId) {
        params.push(filter.principalId);
        conditions.push(`principal_id = $${params.length}`);
      }
      if (filter.entityType) {
        params.push(filter.entityType);
        conditions.push(`entity_type = $${params.length}`);
      }
      if (filter.entityId) {
        params.push(filter.entityId);
        conditions.push(`entity_id = $${params.length}`);
      }
      if (filter.action) {
        params.push(filter.action);
        conditions.push(`action = $${params.length}`);
      }
      if (filter.fromTime) {
        params.push(new Date(filter.fromTime));
        conditions.push(`recorded_at >= $${params.length}`);
      }
      if (filter.toTime) {
        params.push(new Date(filter.toTime));
        conditions.push(`recorded_at <= $${params.length}`);
      }

      params.push(filter.limit ?? 50);
      const limitParamIndex = params.length;

      const query = `
        SELECT 
          id, tenant_id AS "tenantId", principal_id AS "principalId", action, 
          entity_type AS "entityType", entity_id AS "entityId", payload_hash AS "payloadHash", 
          payload_diff AS "payloadDiff", prev_event_hash AS "prevEventHash", 
          correlation_id AS "correlationId", policy_decision AS "policyDecision", 
          recorded_at AS "recordedAt"
        FROM audit_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY id ASC
        LIMIT $${limitParamIndex}
      `;

      const res = await client.query(query, params);
      return res.rows.map((row) => ({
        ...row,
        id: row.id.toString(),
        recordedAt: row.recordedAt.toISOString()
      }));
    });
  }

  /**
   * Seals a batch of uncheckpointed audit events into a tamper-evident Merkle root checkpoint.
   */
  async createCheckpoint(tenantId: string): Promise<AuditCheckpointDTO | null> {
    return this.withTenantContext(tenantId, async (client) => {
      // 1. Get latest checkpoint to determine starting point
      const lastCpRes = await client.query(
        `SELECT end_event_id, merkle_root FROM audit_checkpoints 
         WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
        [tenantId]
      );

      const startAfterId =
        lastCpRes.rows.length > 0 ? (lastCpRes.rows[0].end_event_id as string) : '0';
      const prevCheckpointRoot =
        lastCpRes.rows.length > 0 ? (lastCpRes.rows[0].merkle_root as string) : null;

      // 2. Fetch uncheckpointed events
      const eventsRes = await client.query(
        `SELECT id, payload_hash, prev_event_hash FROM audit_events
         WHERE tenant_id = $1 AND id > $2
         ORDER BY id ASC`,
        [tenantId, startAfterId]
      );

      if (eventsRes.rows.length === 0) {
        return null; // Nothing to checkpoint
      }

      const rows = eventsRes.rows;
      const leafHashes = rows.map((r) => r.payload_hash as string);

      // 3. Verify linear chain integrity before sealing
      MerkleTree.verifyLinearChain(
        rows.map((r) => ({
          id: r.id.toString(),
          payloadHash: r.payload_hash,
          prevEventHash: r.prev_event_hash
        }))
      );

      // 4. Calculate Merkle root
      const merkleRoot = MerkleTree.computeRoot(leafHashes);
      const startEventId = rows[0].id.toString();
      const endEventId = rows[rows.length - 1].id.toString();
      const eventCount = rows.length;

      // 5. Insert checkpoint
      const res = await client.query(
        `INSERT INTO audit_checkpoints (
           tenant_id, start_event_id, end_event_id, event_count, 
           merkle_root, prev_checkpoint_root
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING 
           id, tenant_id AS "tenantId", start_event_id AS "startEventId", 
           end_event_id AS "endEventId", event_count AS "eventCount", 
           merkle_root AS "merkleRoot", prev_checkpoint_root AS "prevCheckpointRoot", 
           signature, sealed_at AS "sealedAt"`,
        [tenantId, startEventId, endEventId, eventCount, merkleRoot, prevCheckpointRoot]
      );

      const cpRow = res.rows[0];
      return {
        ...cpRow,
        id: cpRow.id.toString(),
        startEventId: cpRow.startEventId.toString(),
        endEventId: cpRow.endEventId.toString(),
        sealedAt: cpRow.sealedAt.toISOString()
      };
    });
  }

  async getCheckpoints(tenantId: string): Promise<AuditCheckpointDTO[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT 
           id, tenant_id AS "tenantId", start_event_id AS "startEventId", 
           end_event_id AS "endEventId", event_count AS "eventCount", 
           merkle_root AS "merkleRoot", prev_checkpoint_root AS "prevCheckpointRoot", 
           signature, sealed_at AS "sealedAt"
         FROM audit_checkpoints
         WHERE tenant_id = $1
         ORDER BY id ASC`,
        [tenantId]
      );

      return res.rows.map((row) => ({
        ...row,
        id: row.id.toString(),
        startEventId: row.startEventId.toString(),
        endEventId: row.endEventId.toString(),
        sealedAt: row.sealedAt.toISOString()
      }));
    });
  }
}
