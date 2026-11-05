import type pg from 'pg';
import { setTenantContext } from '../client.js';

export abstract class TenantScopedRepository {
  constructor(protected readonly pool: pg.Pool) {}

  /**
   * Executes a database operation within an explicit tenant session context.
   * Calls `SET LOCAL app.current_tenant_id = :tenantId` so PostgreSQL RLS policies apply.
   */
  async withTenantContext<T>(
    tenantId: string,
    operation: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await setTenantContext(client, tenantId);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Executes a transactional operation under tenant context.
   */
  async withTransaction<T>(
    tenantId: string,
    operation: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    return this.withTenantContext(tenantId, operation);
  }
}
