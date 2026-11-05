import pg from 'pg';

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
}

export function createDatabasePool(config: DatabaseConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 20
  });
}

export async function setTenantContext(client: pg.PoolClient, tenantId: string): Promise<void> {
  // Validate UUID to prevent SQL injection in session setting
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new Error(`Invalid tenant ID format: ${tenantId}`);
  }

  await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}';`);
}
