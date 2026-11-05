import type pg from 'pg';
import { TenantScopedRepository } from './tenant-scoped.repository.js';
import type {
  RoleDTO,
  RoleAssignmentDTO,
  AssignRoleInput,
  Permission,
  ApiKeyResponse,
  ConnectorCredentialDTO,
  StoreConnectorCredentialInput
} from '@proofmesh/contracts';

export class AuthRepository extends TenantScopedRepository {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  // --- Roles & Role Assignments ---
  async getRoleByName(tenantId: string, roleName: string): Promise<RoleDTO | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", name, description, permissions, is_system AS "isSystem", allows_agents AS "allowsAgents", created_at AS "createdAt"
         FROM roles
         WHERE (tenant_id IS NULL OR tenant_id = $1) AND name = $2
         LIMIT 1`,
        [tenantId, roleName]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        ...row,
        permissions: row.permissions as Permission[],
        createdAt: row.createdAt.toISOString()
      };
    });
  }

  async getRoleById(tenantId: string, roleId: string): Promise<RoleDTO | null> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", name, description, permissions, is_system AS "isSystem", allows_agents AS "allowsAgents", created_at AS "createdAt"
         FROM roles
         WHERE (tenant_id IS NULL OR tenant_id = $1) AND id = $2
         LIMIT 1`,
        [tenantId, roleId]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        ...row,
        permissions: row.permissions as Permission[],
        createdAt: row.createdAt.toISOString()
      };
    });
  }

  async assignRole(
    tenantId: string,
    input: AssignRoleInput,
    assignedBy?: string
  ): Promise<RoleAssignmentDTO> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO role_assignments (tenant_id, principal_id, role_id, scope_type, scope_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tenant_id AS "tenantId", principal_id AS "principalId", role_id AS "roleId", scope_type AS "scopeType", scope_id AS "scopeId", assigned_by AS "assignedBy", created_at AS "createdAt"`,
        [
          tenantId,
          input.principalId,
          input.roleId,
          input.scopeType ?? 'tenant',
          input.scopeId ?? null,
          assignedBy ?? null
        ]
      );
      const row = res.rows[0];
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }

  async getPrincipalRoles(
    tenantId: string,
    principalId: string
  ): Promise<{ role: RoleDTO; assignment: RoleAssignmentDTO }[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT 
           r.id AS "roleId", r.tenant_id AS "roleTenantId", r.name, r.description, r.permissions, r.is_system AS "isSystem", r.allows_agents AS "allowsAgents", r.created_at AS "roleCreatedAt",
           ra.id AS "assignmentId", ra.tenant_id AS "tenantId", ra.principal_id AS "principalId", ra.scope_type AS "scopeType", ra.scope_id AS "scopeId", ra.assigned_by AS "assignedBy", ra.created_at AS "assignmentCreatedAt"
         FROM role_assignments ra
         JOIN roles r ON ra.role_id = r.id
         WHERE ra.tenant_id = $1 AND ra.principal_id = $2`,
        [tenantId, principalId]
      );

      return res.rows.map((row) => ({
        role: {
          id: row.roleId,
          tenantId: row.roleTenantId,
          name: row.name,
          description: row.description,
          permissions: row.permissions as Permission[],
          isSystem: row.isSystem,
          allowsAgents: row.allowsAgents,
          createdAt: row.roleCreatedAt.toISOString()
        },
        assignment: {
          id: row.assignmentId,
          tenantId: row.tenantId,
          principalId: row.principalId,
          roleId: row.roleId,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          assignedBy: row.assignedBy,
          createdAt: row.assignmentCreatedAt.toISOString()
        }
      }));
    });
  }

  async getPrincipalPermissions(tenantId: string, principalId: string): Promise<Permission[]> {
    const rolesWithAssignments = await this.getPrincipalRoles(tenantId, principalId);
    const permissionSet = new Set<Permission>();
    for (const item of rolesWithAssignments) {
      for (const p of item.role.permissions) {
        permissionSet.add(p);
      }
    }
    return Array.from(permissionSet);
  }

  // --- API Keys ---
  async createApiKey(
    tenantId: string,
    principalId: string,
    name: string,
    keyPrefix: string,
    keyHash: string,
    scopes: Permission[],
    expiresAt: Date | null
  ): Promise<ApiKeyResponse> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO api_keys (tenant_id, principal_id, name, key_prefix, key_hash, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, key_prefix AS "keyPrefix", scopes, expires_at AS "expiresAt", created_at AS "createdAt"`,
        [tenantId, principalId, name, keyPrefix, keyHash, JSON.stringify(scopes), expiresAt]
      );
      const row = res.rows[0];
      return {
        ...row,
        scopes: row.scopes as Permission[],
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString()
      };
    });
  }

  /**
   * Looks up an API key by its SHA-256 hash.
   * NOTE: This query executes on pool without pre-set tenant context because authentication
   * must discover the tenant associated with the provided credential.
   */
  async getApiKeyByHash(keyHash: string): Promise<{
    id: string;
    tenantId: string;
    principalId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    scopes: Permission[];
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  } | null> {
    const res = await this.pool.query(
      `SELECT id, tenant_id AS "tenantId", principal_id AS "principalId", name, key_prefix AS "keyPrefix", key_hash AS "keyHash", scopes, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM api_keys
       WHERE key_hash = $1`,
      [keyHash]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      ...row,
      scopes: row.scopes as Permission[],
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString()
    };
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<boolean> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE api_keys
         SET revoked_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [tenantId, keyId]
      );
      return (res.rowCount ?? 0) > 0;
    });
  }

  // --- Connector Credentials (Encrypted References) ---
  async storeConnectorCredential(
    tenantId: string,
    input: StoreConnectorCredentialInput,
    credentialRef: string
  ): Promise<ConnectorCredentialDTO> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO connector_credentials (tenant_id, project_id, name, connector_type, credential_ref, masked_identity, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id AS "tenantId", project_id AS "projectId", name, connector_type AS "connectorType", credential_ref AS "credentialRef", masked_identity AS "maskedIdentity", status, expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          tenantId,
          input.projectId,
          input.name,
          input.connectorType,
          credentialRef,
          input.maskedIdentity,
          input.expiresAt ? new Date(input.expiresAt) : null
        ]
      );
      const row = res.rows[0];
      return {
        ...row,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  async getConnectorCredentials(
    tenantId: string,
    projectId: string
  ): Promise<ConnectorCredentialDTO[]> {
    return this.withTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id AS "tenantId", project_id AS "projectId", name, connector_type AS "connectorType", credential_ref AS "credentialRef", masked_identity AS "maskedIdentity", status, expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM connector_credentials
         WHERE tenant_id = $1 AND project_id = $2
         ORDER BY created_at ASC`,
        [tenantId, projectId]
      );
      return res.rows.map((row) => ({
        ...row,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }));
    });
  }
}
