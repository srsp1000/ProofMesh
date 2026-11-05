import type pg from 'pg';
import { TenantScopedRepository } from './tenant-scoped.repository.js';
import type {
  TenantDTO,
  CreateTenantInput,
  UpdateTenantInput,
  WorkspaceDTO,
  ProjectDTO,
  PrincipalDTO,
  CreatePrincipalInput,
  MembershipDTO,
  CreateMembershipInput
} from '@proofmesh/contracts';

export class IdentityRepository extends TenantScopedRepository {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  // --- Tenant Lifecycle (Administrative, outside RLS) ---
  async createTenant(data: CreateTenantInput): Promise<TenantDTO> {
    const res = await this.pool.query(
      `INSERT INTO tenants (name, slug, settings)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, status, settings, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [data.name, data.slug, JSON.stringify(data.settings ?? {})]
    );
    const row = res.rows[0];
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async getTenantById(id: string): Promise<TenantDTO | null> {
    const res = await this.pool.query(
      `SELECT id, name, slug, status, settings, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tenants WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async getTenantBySlug(slug: string): Promise<TenantDTO | null> {
    const res = await this.pool.query(
      `SELECT id, name, slug, status, settings, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tenants WHERE slug = $1`,
      [slug]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async updateTenant(id: string, data: UpdateTenantInput): Promise<TenantDTO> {
    const existing = await this.getTenantById(id);
    if (!existing) {
      throw new Error(`Tenant '${id}' not found.`);
    }

    const name = data.name ?? existing.name;
    const status = data.status ?? existing.status;
    const settings = data.settings
      ? JSON.stringify(data.settings)
      : JSON.stringify(existing.settings);

    const res = await this.pool.query(
      `UPDATE tenants
       SET name = $1, status = $2, settings = $3, updated_at = clock_timestamp()
       WHERE id = $4
       RETURNING id, name, slug, status, settings, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [name, status, settings, id]
    );
    const row = res.rows[0];
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  // --- Workspaces (Tenant-Scoped) ---
  async createWorkspace(tenantId: string, name: string): Promise<WorkspaceDTO> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO workspaces (tenant_id, name)
         VALUES ($1, $2)
         RETURNING id, tenant_id AS "tenantId", name, created_at AS "createdAt"`,
        [tenantId, name]
      );
      const row = res.rows[0];
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }

  async getWorkspaces(tenantId: string): Promise<WorkspaceDTO[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", name, created_at AS "createdAt"
         FROM workspaces ORDER BY created_at ASC`
      );
      return res.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    });
  }

  // --- Projects (Tenant-Scoped) ---
  async createProject(
    tenantId: string,
    workspaceId: string,
    key: string,
    name: string
  ): Promise<ProjectDTO> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO projects (tenant_id, workspace_id, key, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tenant_id AS "tenantId", workspace_id AS "workspaceId", key, name, created_at AS "createdAt"`,
        [tenantId, workspaceId, key, name]
      );
      const row = res.rows[0];
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }

  async getProjects(tenantId: string, workspaceId?: string): Promise<ProjectDTO[]> {
    return this.withTenantContext(tenantId, async (client) => {
      let query = `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", key, name, created_at AS "createdAt"
                   FROM projects`;
      const params: unknown[] = [];
      if (workspaceId) {
        query += ' WHERE workspace_id = $1';
        params.push(workspaceId);
      }
      query += ' ORDER BY created_at ASC';

      const res = await client.query(query, params);
      return res.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    });
  }

  // --- Principals (Tenant-Scoped) ---
  async createPrincipal(tenantId: string, data: CreatePrincipalInput): Promise<PrincipalDTO> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO principals (tenant_id, type, identifier, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tenant_id AS "tenantId", type, identifier, display_name AS "displayName", is_active AS "isActive", created_at AS "createdAt"`,
        [tenantId, data.type, data.identifier, data.displayName]
      );
      const row = res.rows[0];
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }

  async getPrincipalById(tenantId: string, id: string): Promise<PrincipalDTO | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", type, identifier, display_name AS "displayName", is_active AS "isActive", created_at AS "createdAt"
         FROM principals WHERE id = $1`,
        [id]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }

  async getPrincipalByIdentifier(
    tenantId: string,
    identifier: string
  ): Promise<PrincipalDTO | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", type, identifier, display_name AS "displayName", is_active AS "isActive", created_at AS "createdAt"
         FROM principals WHERE identifier = $1`,
        [identifier]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }

  // --- Memberships (Tenant-Scoped) ---
  async createMembership(tenantId: string, data: CreateMembershipInput): Promise<MembershipDTO> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO memberships (tenant_id, user_principal_id, status)
         VALUES ($1, $2, $3)
         RETURNING id, tenant_id AS "tenantId", user_principal_id AS "userPrincipalId", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [tenantId, data.userPrincipalId, data.status]
      );
      const row = res.rows[0];
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  async getMemberships(tenantId: string): Promise<MembershipDTO[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", user_principal_id AS "userPrincipalId", status, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM memberships ORDER BY created_at ASC`
      );
      return res.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }));
    });
  }
}
