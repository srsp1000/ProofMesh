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
  AuditQueryFilter,
  CanonicalEventEnvelope,
  PriorityLane
} from '@proofmesh/contracts';
import type {
  InboxEventRecord,
  DeadLetterRecord,
  InboxLagMetrics,
  OutboxEventRecord,
  AdapterConnectionRecord,
  UpsertAdapterConnectionInput,
  AdapterConnectionStatus,
  IAdapterConnectionRepository
} from '../../packages/db/src/index.js';
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

export class InMemoryInboxRepository {
  public records: InboxEventRecord[] = [];
  public deadLetters: DeadLetterRecord[] = [];

  async insertEvent(
    tenantId: string,
    event: CanonicalEventEnvelope,
    lane: PriorityLane,
    contentHash: string,
    idempotencyKey: string
  ): Promise<{ record: InboxEventRecord; isDuplicate: boolean }> {
    const existing = this.records.find(
      (r) =>
        r.tenantId === tenantId && (r.idempotencyKey === idempotencyKey || r.eventId === event.id)
    );

    if (existing) {
      return { record: existing, isDuplicate: true };
    }

    const record: InboxEventRecord = {
      id: crypto.randomUUID(),
      tenantId,
      eventId: event.id,
      idempotencyKey,
      eventType: event.type,
      priorityLane: lane,
      status: 'pending',
      payload: event,
      contentHash,
      retryCount: 0,
      maxRetries: 3,
      nextRetryAt: new Date().toISOString(),
      errorDetails: null,
      processedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.records.push(record);
    return { record, isDuplicate: false };
  }

  async claimPendingBatch(
    tenantId: string,
    lane: PriorityLane,
    batchSize: number = 10
  ): Promise<InboxEventRecord[]> {
    const now = new Date();
    const batch = this.records
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.priorityLane === lane &&
          (r.status === 'pending' || r.status === 'failed') &&
          new Date(r.nextRetryAt) <= now
      )
      .slice(0, batchSize);

    for (const r of batch) {
      r.status = 'processing';
      r.updatedAt = new Date().toISOString();
    }

    return batch;
  }

  async markProcessed(tenantId: string, id: string): Promise<void> {
    const record = this.records.find((r) => r.tenantId === tenantId && r.id === id);
    if (record) {
      record.status = 'processed';
      record.processedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
    }
  }

  async markFailed(
    tenantId: string,
    id: string,
    error: string,
    backoffMs: number
  ): Promise<{ movedToDeadLetter: boolean }> {
    const record = this.records.find((r) => r.tenantId === tenantId && r.id === id);
    if (!record) return { movedToDeadLetter: false };

    record.retryCount += 1;
    record.errorDetails = error;
    record.updatedAt = new Date().toISOString();

    if (record.retryCount >= record.maxRetries) {
      record.status = 'dead_letter';
      const dl: DeadLetterRecord = {
        id: crypto.randomUUID(),
        tenantId,
        inboxEventId: id,
        eventId: record.eventId,
        eventType: record.eventType,
        payload: record.payload,
        failureReason: error,
        retryCount: record.retryCount,
        replayedAt: null,
        replayedBy: null,
        createdAt: new Date().toISOString()
      };
      this.deadLetters.push(dl);
      return { movedToDeadLetter: true };
    }

    record.status = 'failed';
    record.nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
    return { movedToDeadLetter: false };
  }

  async replayDeadLetter(
    tenantId: string,
    deadLetterId: string,
    replayedBy?: string
  ): Promise<InboxEventRecord | null> {
    const dl = this.deadLetters.find((d) => d.tenantId === tenantId && d.id === deadLetterId);
    if (!dl) return null;

    dl.replayedAt = new Date().toISOString();
    dl.replayedBy = replayedBy ?? null;

    const record = this.records.find((r) => r.tenantId === tenantId && r.id === dl.inboxEventId);
    if (record) {
      record.status = 'pending';
      record.retryCount = 0;
      record.nextRetryAt = new Date().toISOString();
      record.errorDetails = 'Manual replay initiated';
      record.updatedAt = new Date().toISOString();
      return record;
    }
    return null;
  }

  async getLag(tenantId?: string): Promise<InboxLagMetrics> {
    const filtered = tenantId ? this.records.filter((r) => r.tenantId === tenantId) : this.records;

    const pending = filtered.filter((r) => r.status === 'pending' || r.status === 'processing');
    const highPending = pending.filter((r) => r.priorityLane === 'high_priority').length;
    const bulkPending = pending.filter((r) => r.priorityLane === 'bulk_telemetry').length;

    let oldestSec = 0;
    if (pending.length > 0) {
      const oldestTime = Math.min(...pending.map((r) => new Date(r.createdAt).getTime()));
      oldestSec = Math.max(0, (Date.now() - oldestTime) / 1000);
    }

    return {
      highPriorityPending: highPending,
      bulkTelemetryPending: bulkPending,
      oldestUnprocessedSec: oldestSec
    };
  }
}

export class InMemoryOutboxRepository {
  public events: OutboxEventRecord[] = [];

  async appendEvent(
    tenantId: string,
    event: CanonicalEventEnvelope,
    lane: PriorityLane = 'bulk_telemetry'
  ): Promise<OutboxEventRecord> {
    const record: OutboxEventRecord = {
      id: crypto.randomUUID(),
      tenantId,
      eventId: event.id,
      eventType: event.type,
      priorityLane: lane,
      status: 'pending',
      payload: event,
      retryCount: 0,
      maxRetries: 5,
      publishedAt: null,
      errorDetails: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.events.push(record);
    return record;
  }

  async claimPendingBatch(
    lane: PriorityLane,
    batchSize: number = 20
  ): Promise<OutboxEventRecord[]> {
    const batch = this.events
      .filter((e) => e.priorityLane === lane && e.status === 'pending')
      .slice(0, batchSize);
    return batch;
  }

  async markPublished(id: string): Promise<void> {
    const record = this.events.find((e) => e.id === id);
    if (record) {
      record.status = 'published';
      record.publishedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();
    }
  }

  async markFailed(id: string, error: string): Promise<void> {
    const record = this.events.find((e) => e.id === id);
    if (record) {
      record.retryCount += 1;
      record.errorDetails = error;
      if (record.retryCount >= record.maxRetries) {
        record.status = 'failed';
      }
      record.updatedAt = new Date().toISOString();
    }
  }

  async getPendingCount(): Promise<{ highPriority: number; bulkTelemetry: number }> {
    const high = this.events.filter(
      (e) => e.priorityLane === 'high_priority' && e.status === 'pending'
    ).length;
    const bulk = this.events.filter(
      (e) => e.priorityLane === 'bulk_telemetry' && e.status === 'pending'
    ).length;
    return { highPriority: high, bulkTelemetry: bulk };
  }
}

export class InMemoryAdapterConnectionRepository implements IAdapterConnectionRepository {
  public connections: AdapterConnectionRecord[] = [];

  async upsertConnection(
    tenantId: string,
    data: UpsertAdapterConnectionInput
  ): Promise<AdapterConnectionRecord> {
    const existingIndex = this.connections.findIndex(
      (c) =>
        c.tenantId === tenantId &&
        c.adapterType === data.adapterType &&
        c.instanceId === data.instanceId
    );

    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      const existing = this.connections[existingIndex]!;
      existing.connectionId = data.connectionId;
      if (data.cursorPosition !== undefined) existing.cursorPosition = data.cursorPosition;
      if (data.generation !== undefined) existing.generation = data.generation;
      if (data.status !== undefined) existing.status = data.status;
      existing.stateMetadata = { ...existing.stateMetadata, ...data.stateMetadata };
      if (data.lastEventAt !== undefined) existing.lastEventAt = data.lastEventAt;
      existing.updatedAt = now;
      return existing;
    }

    const record: AdapterConnectionRecord = {
      id: crypto.randomUUID(),
      tenantId,
      workspaceId: data.workspaceId ?? null,
      projectId: data.projectId ?? null,
      adapterType: data.adapterType,
      instanceId: data.instanceId,
      connectionId: data.connectionId,
      cursorPosition: data.cursorPosition ?? 0,
      generation: data.generation ?? null,
      status: data.status ?? 'disconnected',
      stateMetadata: data.stateMetadata ?? {},
      lastEventAt: data.lastEventAt ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.connections.push(record);
    return record;
  }

  async getConnection(
    tenantId: string,
    adapterType: string,
    instanceId: string
  ): Promise<AdapterConnectionRecord | null> {
    const found = this.connections.find(
      (c) => c.tenantId === tenantId && c.adapterType === adapterType && c.instanceId === instanceId
    );
    return found ?? null;
  }

  async getConnectionById(
    tenantId: string,
    connectionId: string
  ): Promise<AdapterConnectionRecord | null> {
    const found = this.connections.find(
      (c) => c.tenantId === tenantId && c.connectionId === connectionId
    );
    return found ?? null;
  }

  async updateCursor(
    tenantId: string,
    connectionId: string,
    cursor: number,
    generation?: string
  ): Promise<void> {
    const found = this.connections.find(
      (c) => c.tenantId === tenantId && c.connectionId === connectionId
    );
    if (found) {
      found.cursorPosition = cursor;
      if (generation !== undefined) found.generation = generation;
      found.lastEventAt = new Date().toISOString();
      found.updatedAt = new Date().toISOString();
    }
  }

  async updateStatus(
    tenantId: string,
    connectionId: string,
    status: AdapterConnectionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const found = this.connections.find(
      (c) => c.tenantId === tenantId && c.connectionId === connectionId
    );
    if (found) {
      found.status = status;
      if (metadata) {
        found.stateMetadata = { ...found.stateMetadata, ...metadata };
      }
      found.updatedAt = new Date().toISOString();
    }
  }

  async listConnections(tenantId: string): Promise<AdapterConnectionRecord[]> {
    return this.connections.filter((c) => c.tenantId === tenantId);
  }
}
