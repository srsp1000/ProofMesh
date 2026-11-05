import type { Pool } from 'pg';
import { TenantScopedRepository } from './tenant-scoped.repository.js';

export type AdapterConnectionStatus =
  'connected' | 'disconnected' | 'reconnecting' | 'lapsed' | 'degraded';

export interface AdapterConnectionRecord {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  projectId: string | null;
  adapterType: string;
  instanceId: string;
  connectionId: string;
  cursorPosition: number;
  generation: string | null;
  status: AdapterConnectionStatus;
  stateMetadata: Record<string, unknown>;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAdapterConnectionInput {
  workspaceId?: string;
  projectId?: string;
  adapterType: string;
  instanceId: string;
  connectionId: string;
  cursorPosition?: number;
  generation?: string;
  status?: AdapterConnectionStatus;
  stateMetadata?: Record<string, unknown>;
  lastEventAt?: string;
}

export interface IAdapterConnectionRepository {
  upsertConnection(
    tenantId: string,
    data: UpsertAdapterConnectionInput
  ): Promise<AdapterConnectionRecord>;
  getConnection(
    tenantId: string,
    adapterType: string,
    instanceId: string
  ): Promise<AdapterConnectionRecord | null>;
  getConnectionById(
    tenantId: string,
    connectionId: string
  ): Promise<AdapterConnectionRecord | null>;
  updateCursor(
    tenantId: string,
    connectionId: string,
    cursor: number,
    generation?: string
  ): Promise<void>;
  updateStatus(
    tenantId: string,
    connectionId: string,
    status: AdapterConnectionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void>;
  listConnections(tenantId: string): Promise<AdapterConnectionRecord[]>;
}

export class AdapterConnectionRepository
  extends TenantScopedRepository
  implements IAdapterConnectionRepository
{
  constructor(pool: Pool) {
    super(pool);
  }

  async upsertConnection(
    tenantId: string,
    data: UpsertAdapterConnectionInput
  ): Promise<AdapterConnectionRecord> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO adapter_connections (
           tenant_id, workspace_id, project_id, adapter_type, instance_id,
           connection_id, cursor_position, generation, status, state_metadata,
           last_event_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (tenant_id, adapter_type, instance_id) DO UPDATE SET
           connection_id = EXCLUDED.connection_id,
           cursor_position = COALESCE(EXCLUDED.cursor_position, adapter_connections.cursor_position),
           generation = COALESCE(EXCLUDED.generation, adapter_connections.generation),
           status = COALESCE(EXCLUDED.status, adapter_connections.status),
           state_metadata = adapter_connections.state_metadata || EXCLUDED.state_metadata,
           last_event_at = COALESCE(EXCLUDED.last_event_at, adapter_connections.last_event_at),
           updated_at = NOW()
         RETURNING *`,
        [
          tenantId,
          data.workspaceId ?? null,
          data.projectId ?? null,
          data.adapterType,
          data.instanceId,
          data.connectionId,
          data.cursorPosition ?? 0,
          data.generation ?? null,
          data.status ?? 'disconnected',
          JSON.stringify(data.stateMetadata ?? {}),
          data.lastEventAt ?? null
        ]
      );

      return this.mapRowToRecord(res.rows[0]);
    });
  }

  async getConnection(
    tenantId: string,
    adapterType: string,
    instanceId: string
  ): Promise<AdapterConnectionRecord | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM adapter_connections 
         WHERE tenant_id = $1 AND adapter_type = $2 AND instance_id = $3`,
        [tenantId, adapterType, instanceId]
      );
      if (res.rows.length === 0) return null;
      return this.mapRowToRecord(res.rows[0]);
    });
  }

  async getConnectionById(
    tenantId: string,
    connectionId: string
  ): Promise<AdapterConnectionRecord | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM adapter_connections 
         WHERE tenant_id = $1 AND connection_id = $2`,
        [tenantId, connectionId]
      );
      if (res.rows.length === 0) return null;
      return this.mapRowToRecord(res.rows[0]);
    });
  }

  async updateCursor(
    tenantId: string,
    connectionId: string,
    cursor: number,
    generation?: string
  ): Promise<void> {
    await this.withTenantContext(tenantId, async (client) => {
      if (generation !== undefined) {
        await client.query(
          `UPDATE adapter_connections 
           SET cursor_position = $1, generation = $2, last_event_at = NOW(), updated_at = NOW()
           WHERE tenant_id = $3 AND connection_id = $4`,
          [cursor, generation, tenantId, connectionId]
        );
      } else {
        await client.query(
          `UPDATE adapter_connections 
           SET cursor_position = $1, last_event_at = NOW(), updated_at = NOW()
           WHERE tenant_id = $2 AND connection_id = $3`,
          [cursor, tenantId, connectionId]
        );
      }
    });
  }

  async updateStatus(
    tenantId: string,
    connectionId: string,
    status: AdapterConnectionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.withTenantContext(tenantId, async (client) => {
      if (metadata) {
        await client.query(
          `UPDATE adapter_connections 
           SET status = $1, state_metadata = state_metadata || $2, updated_at = NOW()
           WHERE tenant_id = $3 AND connection_id = $4`,
          [status, JSON.stringify(metadata), tenantId, connectionId]
        );
      } else {
        await client.query(
          `UPDATE adapter_connections 
           SET status = $1, updated_at = NOW()
           WHERE tenant_id = $2 AND connection_id = $3`,
          [status, tenantId, connectionId]
        );
      }
    });
  }

  async listConnections(tenantId: string): Promise<AdapterConnectionRecord[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM adapter_connections WHERE tenant_id = $1 ORDER BY updated_at DESC`,
        [tenantId]
      );
      return res.rows.map((row) => this.mapRowToRecord(row));
    });
  }

  private mapRowToRecord(row: Record<string, unknown>): AdapterConnectionRecord {
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      workspaceId: row.workspace_id ? String(row.workspace_id) : null,
      projectId: row.project_id ? String(row.project_id) : null,
      adapterType: String(row.adapter_type),
      instanceId: String(row.instance_id),
      connectionId: String(row.connection_id),
      cursorPosition: Number(row.cursor_position),
      generation: row.generation ? String(row.generation) : null,
      status: row.status as AdapterConnectionStatus,
      stateMetadata:
        typeof row.state_metadata === 'object' && row.state_metadata !== null
          ? (row.state_metadata as Record<string, unknown>)
          : {},
      lastEventAt: row.last_event_at ? new Date(String(row.last_event_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString()
    };
  }
}
