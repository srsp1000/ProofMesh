import type {
  TenantDTO,
  CreateTenantInput,
  UpdateTenantInput,
  WorkspaceDTO,
  ProjectDTO,
  PrincipalDTO,
  CreatePrincipalInput,
  MembershipDTO,
  CreateMembershipInput,
  RoleDTO,
  RoleAssignmentDTO,
  AssignRoleInput,
  Permission,
  ApiKeyResponse,
  AuditEventDTO,
  CreateAuditEventInput,
  AuditCheckpointDTO,
  AuditQueryFilter
} from '@proofmesh/contracts';
import { MerkleTree } from '@proofmesh/domain';

export class InMemoryIdentityRepository {
  public tenants: TenantDTO[] = [];
  public workspaces: WorkspaceDTO[] = [];
  public projects: ProjectDTO[] = [];
  public principals: PrincipalDTO[] = [];
  public memberships: MembershipDTO[] = [];

  async createTenant(data: CreateTenantInput): Promise<TenantDTO> {
    const tenant: TenantDTO = {
      id: crypto.randomUUID(),
      name: data.name,
      slug: data.slug,
      status: 'active',
      settings: data.settings ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.tenants.push(tenant);
    return tenant;
  }

  async getTenantById(id: string): Promise<TenantDTO | null> {
    return this.tenants.find((t) => t.id === id) ?? null;
  }

  async getTenantBySlug(slug: string): Promise<TenantDTO | null> {
    return this.tenants.find((t) => t.slug === slug) ?? null;
  }

  async updateTenant(id: string, data: UpdateTenantInput): Promise<TenantDTO> {
    const tenant = this.tenants.find((t) => t.id === id);
    if (!tenant) throw new Error(`Tenant '${id}' not found.`);
    if (data.name) tenant.name = data.name;
    if (data.status) tenant.status = data.status;
    if (data.settings) tenant.settings = data.settings;
    tenant.updatedAt = new Date().toISOString();
    return tenant;
  }

  async createWorkspace(tenantId: string, name: string): Promise<WorkspaceDTO> {
    const ws: WorkspaceDTO = {
      id: crypto.randomUUID(),
      tenantId,
      name,
      createdAt: new Date().toISOString()
    };
    this.workspaces.push(ws);
    return ws;
  }

  async getWorkspaces(tenantId: string): Promise<WorkspaceDTO[]> {
    return this.workspaces.filter((w) => w.tenantId === tenantId);
  }

  async createProject(
    tenantId: string,
    workspaceId: string,
    key: string,
    name: string
  ): Promise<ProjectDTO> {
    const proj: ProjectDTO = {
      id: crypto.randomUUID(),
      tenantId,
      workspaceId,
      key,
      name,
      createdAt: new Date().toISOString()
    };
    this.projects.push(proj);
    return proj;
  }

  async getProjects(tenantId: string, workspaceId?: string): Promise<ProjectDTO[]> {
    return this.projects.filter(
      (p) => p.tenantId === tenantId && (!workspaceId || p.workspaceId === workspaceId)
    );
  }

  async createPrincipal(tenantId: string, data: CreatePrincipalInput): Promise<PrincipalDTO> {
    const principal: PrincipalDTO = {
      id: crypto.randomUUID(),
      tenantId,
      type: data.type,
      identifier: data.identifier,
      displayName: data.displayName,
      isActive: true,
      createdAt: new Date().toISOString()
    };
    this.principals.push(principal);
    return principal;
  }

  async getPrincipalById(tenantId: string, id: string): Promise<PrincipalDTO | null> {
    return this.principals.find((p) => p.tenantId === tenantId && p.id === id) ?? null;
  }

  async getPrincipalByIdentifier(
    tenantId: string,
    identifier: string
  ): Promise<PrincipalDTO | null> {
    return (
      this.principals.find((p) => p.tenantId === tenantId && p.identifier === identifier) ?? null
    );
  }

  async createMembership(tenantId: string, data: CreateMembershipInput): Promise<MembershipDTO> {
    const m: MembershipDTO = {
      id: crypto.randomUUID(),
      tenantId,
      userPrincipalId: data.userPrincipalId,
      status: data.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.memberships.push(m);
    return m;
  }

  async getMemberships(tenantId: string): Promise<MembershipDTO[]> {
    return this.memberships.filter((m) => m.tenantId === tenantId);
  }
}

export class InMemoryAuthRepository {
  public roles: RoleDTO[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: null,
      name: 'admin',
      description: 'Tenant Administrator',
      permissions: [
        'tenants:manage',
        'workspaces:manage',
        'projects:manage',
        'principals:manage',
        'roles:assign',
        'credentials:manage',
        'claims:read',
        'claims:submit',
        'claims:evaluate',
        'claims:review',
        'claims:attest',
        'evidence:read',
        'evidence:ingest',
        'policy:read',
        'policy:manage',
        'audit:read',
        'audit:checkpoint'
      ],
      isSystem: true,
      allowsAgents: false,
      createdAt: new Date().toISOString()
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      tenantId: null,
      name: 'compliance_officer',
      description: 'Compliance Officer for Review & Attestation',
      permissions: [
        'claims:read',
        'claims:review',
        'claims:attest',
        'evidence:read',
        'policy:read',
        'policy:manage',
        'audit:read'
      ],
      isSystem: true,
      allowsAgents: false,
      createdAt: new Date().toISOString()
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      tenantId: null,
      name: 'auditor',
      description: 'Read-Only Auditor',
      permissions: ['claims:read', 'evidence:read', 'policy:read', 'audit:read'],
      isSystem: true,
      allowsAgents: false,
      createdAt: new Date().toISOString()
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      tenantId: null,
      name: 'developer',
      description: 'Engineer for Integration & Claim Submission',
      permissions: [
        'claims:read',
        'claims:submit',
        'evidence:read',
        'evidence:ingest',
        'policy:read'
      ],
      isSystem: true,
      allowsAgents: true,
      createdAt: new Date().toISOString()
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      tenantId: null,
      name: 'agent_ingest',
      description: 'Least-Privilege Agent Telemetry Ingestion',
      permissions: ['claims:submit', 'evidence:ingest'],
      isSystem: true,
      allowsAgents: true,
      createdAt: new Date().toISOString()
    }
  ];

  public roleAssignments: RoleAssignmentDTO[] = [];
  public apiKeys: {
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
  }[] = [];

  async getRoleByName(tenantId: string, roleName: string): Promise<RoleDTO | null> {
    return (
      this.roles.find(
        (r) => (r.tenantId === null || r.tenantId === tenantId) && r.name === roleName
      ) ?? null
    );
  }

  async getRoleById(tenantId: string, roleId: string): Promise<RoleDTO | null> {
    return (
      this.roles.find((r) => (r.tenantId === null || r.tenantId === tenantId) && r.id === roleId) ??
      null
    );
  }

  async assignRole(
    tenantId: string,
    input: AssignRoleInput,
    assignedBy?: string
  ): Promise<RoleAssignmentDTO> {
    const assignment: RoleAssignmentDTO = {
      id: crypto.randomUUID(),
      tenantId,
      principalId: input.principalId,
      roleId: input.roleId,
      scopeType: input.scopeType ?? 'tenant',
      scopeId: input.scopeId ?? null,
      assignedBy: assignedBy ?? null,
      createdAt: new Date().toISOString()
    };
    this.roleAssignments.push(assignment);
    return assignment;
  }

  async getPrincipalRoles(
    tenantId: string,
    principalId: string
  ): Promise<{ role: RoleDTO; assignment: RoleAssignmentDTO }[]> {
    const assignments = this.roleAssignments.filter(
      (ra) => ra.tenantId === tenantId && ra.principalId === principalId
    );
    const result: { role: RoleDTO; assignment: RoleAssignmentDTO }[] = [];
    for (const a of assignments) {
      const role = this.roles.find((r) => r.id === a.roleId);
      if (role) {
        result.push({ role, assignment: a });
      }
    }
    return result;
  }

  async getPrincipalPermissions(tenantId: string, principalId: string): Promise<Permission[]> {
    const roles = await this.getPrincipalRoles(tenantId, principalId);
    const set = new Set<Permission>();
    for (const item of roles) {
      for (const p of item.role.permissions) {
        set.add(p);
      }
    }
    return Array.from(set);
  }

  async createApiKey(
    tenantId: string,
    principalId: string,
    name: string,
    keyPrefix: string,
    keyHash: string,
    scopes: Permission[],
    expiresAt: Date | null
  ): Promise<ApiKeyResponse> {
    const key = {
      id: crypto.randomUUID(),
      tenantId,
      principalId,
      name,
      keyPrefix,
      keyHash,
      scopes,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    };
    this.apiKeys.push(key);
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt
    };
  }

  async getApiKeyByHash(keyHash: string) {
    return this.apiKeys.find((k) => k.keyHash === keyHash) ?? null;
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<boolean> {
    const key = this.apiKeys.find((k) => k.tenantId === tenantId && k.id === keyId);
    if (!key || key.revokedAt) return false;
    key.revokedAt = new Date().toISOString();
    return true;
  }
}

export class InMemoryAuditRepository {
  public events: AuditEventDTO[] = [];
  public checkpoints: AuditCheckpointDTO[] = [];

  async appendAuditEvent(input: CreateAuditEventInput): Promise<AuditEventDTO> {
    const tenantEvents = this.events.filter((e) => e.tenantId === input.tenantId);
    const lastEvent = tenantEvents.length > 0 ? tenantEvents[tenantEvents.length - 1] : null;

    const payloadHash = MerkleTree.hashPayload(input.payload);
    const nextId = (this.events.length + 1).toString();

    const event: AuditEventDTO = {
      id: nextId,
      tenantId: input.tenantId,
      principalId: input.principalId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payloadHash,
      payloadDiff: input.payloadDiff ?? null,
      prevEventHash: lastEvent ? lastEvent.payloadHash : null,
      correlationId: input.correlationId ?? null,
      policyDecision: input.policyDecision ?? null,
      recordedAt: new Date().toISOString()
    };

    this.events.push(event);
    return event;
  }

  async queryAuditEvents(filter: AuditQueryFilter): Promise<AuditEventDTO[]> {
    return this.events.filter((e) => {
      if (e.tenantId !== filter.tenantId) return false;
      if (filter.principalId && e.principalId !== filter.principalId) return false;
      if (filter.entityType && e.entityType !== filter.entityType) return false;
      if (filter.entityId && e.entityId !== filter.entityId) return false;
      if (filter.action && e.action !== filter.action) return false;
      return true;
    });
  }

  async createCheckpoint(tenantId: string): Promise<AuditCheckpointDTO | null> {
    const lastCp = this.checkpoints.filter((c) => c.tenantId === tenantId).pop();
    const startAfterId = lastCp ? parseInt(lastCp.endEventId, 10) : 0;

    const uncheckpointed = this.events.filter(
      (e) => e.tenantId === tenantId && parseInt(e.id, 10) > startAfterId
    );
    if (uncheckpointed.length === 0) return null;

    MerkleTree.verifyLinearChain(
      uncheckpointed.map((e) => ({
        id: e.id,
        payloadHash: e.payloadHash,
        prevEventHash: e.prevEventHash
      }))
    );

    const leafHashes = uncheckpointed.map((e) => e.payloadHash);
    const merkleRoot = MerkleTree.computeRoot(leafHashes);

    const cp: AuditCheckpointDTO = {
      id: (this.checkpoints.length + 1).toString(),
      tenantId,
      startEventId: uncheckpointed[0]!.id,
      endEventId: uncheckpointed[uncheckpointed.length - 1]!.id,
      eventCount: uncheckpointed.length,
      merkleRoot,
      prevCheckpointRoot: lastCp ? lastCp.merkleRoot : null,
      signature: 'ed25519_sig_checkpoint',
      sealedAt: new Date().toISOString()
    };

    this.checkpoints.push(cp);
    return cp;
  }

  async getCheckpoints(tenantId: string): Promise<AuditCheckpointDTO[]> {
    return this.checkpoints.filter((c) => c.tenantId === tenantId);
  }
}
