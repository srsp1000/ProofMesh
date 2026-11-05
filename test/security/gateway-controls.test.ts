import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { buildServer } from '../../apps/api/src/server.js';
import { JwtSigner } from '../../apps/api/src/auth/jwt.js';
import {
  InMemoryIdentityRepository,
  InMemoryAuthRepository,
  InMemoryAuditRepository,
  InMemoryInboxRepository,
  InMemoryOutboxRepository
} from '../fixtures/in-memory-repositories.js';
import { InMemoryEventTransport } from '../../packages/db/src/transport/in-memory-transport.js';
import type { InboxRepository, OutboxRepository } from '../../packages/db/src/index.js';
import { GatewayService } from '../../apps/api/src/gateway/service.js';

describe('Gateway Security Controls & Failure Handling (Security)', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let transport: InMemoryEventTransport;
  let gatewayService: GatewayService;

  const jwtSecret = 'test_secret_for_gateway_security_testing_min_16_chars';
  const jwtSigner = new JwtSigner(jwtSecret);

  let tenantAId: string;
  let tenantBId: string;
  let tokenTenantA: string;
  let agentTokenA: string;

  beforeAll(async () => {
    identityRepo = new InMemoryIdentityRepository();
    authRepo = new InMemoryAuthRepository();
    auditRepo = new InMemoryAuditRepository();
    inboxRepo = new InMemoryInboxRepository();
    outboxRepo = new InMemoryOutboxRepository();
    transport = new InMemoryEventTransport();
    gatewayService = new GatewayService(
      inboxRepo as unknown as InboxRepository,
      outboxRepo as unknown as OutboxRepository,
      transport
    );

    const tenantA = await identityRepo.createTenant({ name: 'Tenant A', slug: 'tenant-a' });
    tenantAId = tenantA.id;

    const tenantB = await identityRepo.createTenant({ name: 'Tenant B', slug: 'tenant-b' });
    tenantBId = tenantB.id;

    // Human A
    const humanA = await identityRepo.createPrincipal(tenantAId, {
      type: 'human_user',
      identifier: 'alice@tenant-a.com',
      displayName: 'Alice A'
    });
    const adminRoleA = (await authRepo.getRoleByName(tenantAId, 'admin'))!;
    await authRepo.assignRole(tenantAId, { principalId: humanA.id, roleId: adminRoleA.id });

    tokenTenantA = jwtSigner.sign({
      sub: humanA.identifier,
      tenant_id: tenantAId,
      email: humanA.identifier,
      name: humanA.displayName
    });

    // Agent A
    const agentA = await identityRepo.createPrincipal(tenantAId, {
      type: 'agent_identity',
      identifier: 'agent@tenant-a.com',
      displayName: 'Agent A'
    });
    const agentRoleA = (await authRepo.getRoleByName(tenantAId, 'agent_ingest'))!;
    await authRepo.assignRole(tenantAId, { principalId: agentA.id, roleId: agentRoleA.id });

    agentTokenA = jwtSigner.sign({
      sub: agentA.identifier,
      tenant_id: tenantAId,
      email: agentA.identifier,
      name: agentA.displayName
    });

    app = await buildServer({
      jwtSecret,
      identityRepo: identityRepo as unknown as Parameters<typeof buildServer>[0]['identityRepo'],
      authRepo: authRepo as unknown as Parameters<typeof buildServer>[0]['authRepo'],
      auditRepo: auditRepo as unknown as Parameters<typeof buildServer>[0]['auditRepo'],
      inboxRepo: inboxRepo as unknown as Parameters<typeof buildServer>[0]['inboxRepo'],
      outboxRepo: outboxRepo as unknown as Parameters<typeof buildServer>[0]['outboxRepo'],
      transport,
      gatewayService,
      maxPayloadBytes: 2048 // Set small 2KB limit to test payload size limits
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects caller-supplied tenant ID mismatch with 403 Forbidden', async () => {
    // Tenant A tries to ingest event into Tenant B's scope
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        tenantId: tenantBId, // Mismatch! Caller is Tenant A
        type: 'io.proofmesh.claim.registered.v1',
        idempotencyKey: 'idemp-cross-tenant',
        data: {
          claimConceptId: crypto.randomUUID(),
          claimVersionId: crypto.randomUUID(),
          conceptKey: 'spoof',
          statement: 'Cross-tenant spoof attempt',
          status: 'submitted'
        }
      }
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('FORBIDDEN_TENANT_MISMATCH');
    expect(body.detail).toContain('Cross-tenant event ingestion');
  });

  it('rejects expired tokens with 401 Unauthorized', async () => {
    const expiredToken = jwtSigner.sign({
      sub: 'alice@tenant-a.com',
      tenant_id: tenantAId,
      expiresInSeconds: -3600 // Expired 1 hour ago
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: {
        type: 'io.proofmesh.claim.registered.v1',
        idempotencyKey: 'idemp-expired',
        data: { statement: 'Expired token test' }
      }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHENTICATION_FAILED');
  });

  it('rejects oversized payloads with 413 Payload Too Large', async () => {
    // Large payload exceeding 2KB configured limit
    const largeData = 'X'.repeat(4096);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: {
        authorization: `Bearer ${tokenTenantA}`
      },
      payload: {
        type: 'io.proofmesh.claim.registered.v1',
        idempotencyKey: 'idemp-large',
        data: { statement: largeData }
      }
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects invalid schema with 400 Bad Request and RFC 7807 problem details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        type: 'io.proofmesh.claim.registered.v1',
        idempotencyKey: 'idemp-invalid-schema',
        data: {
          // Missing required fields: claimConceptId, claimVersionId, conceptKey, statement, status
          randomUnrecognizedField: 'invalid'
        }
      }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(body.detail).toContain('Schema validation failed');
  });

  it('rejects unsupported schema versions with 400 Bad Request listing supported versions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        type: 'io.proofmesh.claim.registered.v1',
        schemaVersion: '99.0.0', // Unsupported version
        idempotencyKey: 'idemp-unsupported-version',
        data: {
          claimConceptId: crypto.randomUUID(),
          claimVersionId: crypto.randomUUID(),
          conceptKey: 'income',
          statement: 'Valid statement',
          status: 'submitted'
        }
      }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    expect(body.detail).toContain("Unsupported schema version '99.0.0'");
    expect(body.detail).toContain('Supported versions');
  });

  it('prohibits agent identities from triggering dead-letter replay with 403', async () => {
    const dlId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/gateway/dead-letter/${dlId}/replay`,
      headers: { authorization: `Bearer ${agentTokenA}` } // Agent principal attempting human action!
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('HUMAN_PRINCIPAL_REQUIRED');
  });

  it('handles out-of-order events with correlation and causation links', async () => {
    const correlationId = crypto.randomUUID();
    const event1Id = crypto.randomUUID();
    const event2Id = crypto.randomUUID();

    // Event 2 arrives before Event 1 (out of order in transport)
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        id: event2Id,
        type: 'io.proofmesh.decision.registered.v1',
        correlationId,
        causationId: event1Id, // Explicitly references prior event 1
        idempotencyKey: 'idemp-causation-2',
        data: {
          decisionId: crypto.randomUUID(),
          decisionType: 'policy_disposition',
          disposition: 'admit',
          targetEntityId: crypto.randomUUID(),
          targetEntityType: 'claim',
          rationale: 'Passed check'
        }
      }
    });
    expect(res2.statusCode).toBe(202);

    // Event 1 arrives later
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        id: event1Id,
        type: 'io.proofmesh.claim.registered.v1',
        correlationId,
        idempotencyKey: 'idemp-causation-1',
        data: {
          claimConceptId: crypto.randomUUID(),
          claimVersionId: crypto.randomUUID(),
          conceptKey: 'income',
          statement: 'Income verified',
          status: 'submitted'
        }
      }
    });
    expect(res1.statusCode).toBe(202);

    // Verify both events in inbox preserve correlationId and causationId
    const rec1 = inboxRepo.records.find((r) => r.eventId === event1Id);
    const rec2 = inboxRepo.records.find((r) => r.eventId === event2Id);
    expect(rec1?.payload.correlationId).toBe(correlationId);
    expect(rec2?.payload.correlationId).toBe(correlationId);
    expect(rec2?.payload.causationId).toBe(event1Id);
  });
});
