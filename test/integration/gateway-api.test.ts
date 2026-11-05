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

describe('Gateway API Integration (Integration)', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let transport: InMemoryEventTransport;
  let gatewayService: GatewayService;

  const jwtSecret = 'test_secret_for_gateway_jwt_signing_min_16_chars';
  const jwtSigner = new JwtSigner(jwtSecret);

  let tenantId: string;
  let humanToken: string;
  let agentToken: string;

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

    const tenant = await identityRepo.createTenant({ name: 'Acme Corp', slug: 'acme-gateway' });
    tenantId = tenant.id;

    // Human user
    const human = await identityRepo.createPrincipal(tenantId, {
      type: 'human_user',
      identifier: 'alice@acme.com',
      displayName: 'Alice Officer'
    });
    const adminRole = (await authRepo.getRoleByName(tenantId, 'admin'))!;
    await authRepo.assignRole(tenantId, { principalId: human.id, roleId: adminRole.id });

    humanToken = jwtSigner.sign({
      sub: human.identifier,
      tenant_id: tenantId,
      email: human.identifier,
      name: human.displayName
    });

    // Agent user
    const agent = await identityRepo.createPrincipal(tenantId, {
      type: 'agent_identity',
      identifier: 'kyc-agent@acme.com',
      displayName: 'KYC Agent'
    });
    const agentRole = (await authRepo.getRoleByName(tenantId, 'agent_ingest'))!;
    await authRepo.assignRole(tenantId, { principalId: agent.id, roleId: agentRole.id });

    agentToken = jwtSigner.sign({
      sub: agent.identifier,
      tenant_id: tenantId,
      email: agent.identifier,
      name: agent.displayName
    });

    app = await buildServer({
      jwtSecret,
      identityRepo: identityRepo as unknown as Parameters<typeof buildServer>[0]['identityRepo'],
      authRepo: authRepo as unknown as Parameters<typeof buildServer>[0]['authRepo'],
      auditRepo: auditRepo as unknown as Parameters<typeof buildServer>[0]['auditRepo'],
      inboxRepo: inboxRepo as unknown as Parameters<typeof buildServer>[0]['inboxRepo'],
      outboxRepo: outboxRepo as unknown as Parameters<typeof buildServer>[0]['outboxRepo'],
      transport,
      gatewayService
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('ingests a single canonical event successfully (202 Accepted)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: {
        authorization: `Bearer ${agentToken}`
      },
      payload: {
        type: 'io.proofmesh.claim.registered.v1',
        idempotencyKey: 'idemp-int-01',
        data: {
          claimConceptId: crypto.randomUUID(),
          claimVersionId: crypto.randomUUID(),
          conceptKey: 'income-check',
          statement: 'Income verified at $120k',
          status: 'submitted'
        }
      }
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('accepted');
    expect(body.eventId).toBeDefined();
    expect(body.lane).toBe('high_priority');
  });

  it('detects duplicate events via idempotency key and returns duplicate status', async () => {
    const payload = {
      type: 'io.proofmesh.claim.registered.v1',
      idempotencyKey: 'idemp-int-duplicate',
      data: {
        claimConceptId: crypto.randomUUID(),
        claimVersionId: crypto.randomUUID(),
        conceptKey: 'credit-check',
        statement: 'Credit score is 780',
        status: 'submitted'
      }
    };

    // First attempt
    const firstRes = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${agentToken}` },
      payload
    });
    expect(firstRes.statusCode).toBe(202);
    expect(firstRes.json().status).toBe('accepted');

    // Duplicate attempt
    const secondRes = await app.inject({
      method: 'POST',
      url: '/v1/gateway/events',
      headers: { authorization: `Bearer ${agentToken}` },
      payload
    });
    expect(secondRes.statusCode).toBe(202);
    expect(secondRes.json().status).toBe('duplicate');
  });

  it('ingests a batch of events via /v1/gateway/batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/batch',
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        events: [
          {
            type: 'io.proofmesh.message.observed.v1',
            idempotencyKey: 'idemp-batch-01',
            data: {
              messageId: crypto.randomUUID(),
              conversationId: 'c1',
              role: 'user',
              content: 'Hello bot',
              contentHash: `sha256:${'b'.repeat(64)}`
            }
          },
          {
            type: 'io.proofmesh.message.observed.v1',
            idempotencyKey: 'idemp-batch-02',
            data: {
              messageId: crypto.randomUUID(),
              conversationId: 'c1',
              role: 'assistant',
              content: 'Hello human',
              contentHash: `sha256:${'c'.repeat(64)}`
            }
          }
        ]
      }
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.processedCount).toBe(2);
    expect(body.acceptedCount).toBe(2);
  });

  it('transforms and ingests OpenTelemetry spans via /v1/gateway/adapters/opentelemetry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/opentelemetry',
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace-otel-100',
                    spanId: 'span-otel-200',
                    name: 'tool_execution',
                    kind: 'client',
                    startTimeUnixNano: '1700000000000',
                    endTimeUnixNano: '1700000001000',
                    attributes: [{ key: 'tool.name', value: { stringValue: 'vector_search' } }],
                    status: { code: 'ok' }
                  }
                ]
              }
            ]
          }
        ]
      }
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.processedCount).toBe(1);
    expect(body.acceptedCount).toBe(1);
  });

  it('transforms and ingests Framework / MCP callbacks via /v1/gateway/adapters/callbacks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/callbacks',
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        framework: 'mcp',
        eventType: 'on_tool_start',
        idempotencyKey: 'idemp-mcp-callback-01',
        agentId: 'mcp-worker-01',
        payload: {
          toolName: 'read_document',
          parameters: { docId: 'doc-123' }
        }
      }
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('accepted');
  });

  it('returns health diagnostics via GET /v1/gateway/health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/gateway/health',
      headers: { authorization: `Bearer ${humanToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.queueLag).toBeDefined();
    expect(body.circuitBreaker.status).toBe('closed');
    expect(body.connectors.length).toBeGreaterThan(0);
  });

  it('replays a dead-letter event via POST /v1/gateway/dead-letter/:id/replay', async () => {
    // Manually insert a dead letter record
    const dlId = crypto.randomUUID();
    const inboxId = crypto.randomUUID();
    inboxRepo.records.push({
      id: inboxId,
      tenantId,
      eventId: crypto.randomUUID(),
      idempotencyKey: 'idemp-dl-test',
      eventType: 'io.proofmesh.claim.registered.v1',
      priorityLane: 'high_priority',
      status: 'dead_letter',
      payload: { id: crypto.randomUUID(), type: 'io.proofmesh.claim.registered.v1', data: {} },
      retryCount: 3,
      maxRetries: 3
    });
    inboxRepo.deadLetters.push({
      id: dlId,
      tenantId,
      inboxEventId: inboxId,
      eventId: crypto.randomUUID(),
      eventType: 'io.proofmesh.claim.registered.v1',
      payload: { id: crypto.randomUUID(), type: 'io.proofmesh.claim.registered.v1', data: {} },
      failureReason: 'Fatal parsing failure',
      retryCount: 3
    });

    // Human user triggers replay
    const res = await app.inject({
      method: 'POST',
      url: `/v1/gateway/dead-letter/${dlId}/replay`,
      headers: { authorization: `Bearer ${humanToken}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().replayed).toBe(true);
  });
});
