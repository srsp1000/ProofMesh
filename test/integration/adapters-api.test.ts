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
  InMemoryOutboxRepository,
  InMemoryAdapterConnectionRepository
} from '../fixtures/in-memory-repositories.js';
import { InMemoryEventTransport } from '../../packages/db/src/transport/in-memory-transport.js';
import { GatewayService } from '../../apps/api/src/gateway/service.js';
import { WebhookSignatureVerifier } from '../../packages/domain/src/security/webhook-signature.js';
import type { InboxRepository, OutboxRepository } from '../../packages/db/src/index.js';

describe('Adapters API Integration (Integration)', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let adapterConnectionRepo: InMemoryAdapterConnectionRepository;
  let transport: InMemoryEventTransport;
  let gatewayService: GatewayService;

  const jwtSecret = 'test_secret_for_adapters_api_min_32_chars';
  const webhookSecret = 'test_secret_for_adapters_webhook_32chars';
  const jwtSigner = new JwtSigner(jwtSecret);

  let tenantId: string;
  let userToken: string;

  beforeAll(async () => {
    identityRepo = new InMemoryIdentityRepository();
    authRepo = new InMemoryAuthRepository();
    auditRepo = new InMemoryAuditRepository();
    inboxRepo = new InMemoryInboxRepository();
    outboxRepo = new InMemoryOutboxRepository();
    adapterConnectionRepo = new InMemoryAdapterConnectionRepository();
    transport = new InMemoryEventTransport();
    gatewayService = new GatewayService(
      inboxRepo as unknown as InboxRepository,
      outboxRepo as unknown as OutboxRepository,
      transport
    );

    const tenant = await identityRepo.createTenant({
      name: 'Integration Tenant',
      slug: 'integ-tenant'
    });
    tenantId = tenant.id;

    const user = await identityRepo.createPrincipal(tenantId, {
      type: 'human_user',
      identifier: 'operator@integ.com',
      displayName: 'System Operator'
    });
    const adminRole = (await authRepo.getRoleByName(tenantId, 'admin'))!;
    await authRepo.assignRole(tenantId, { principalId: user.id, roleId: adminRole.id });

    userToken = jwtSigner.sign({
      sub: user.identifier,
      tenant_id: tenantId,
      email: user.identifier,
      name: user.displayName
    });

    app = await buildServer({
      jwtSecret,
      webhookSecret,
      identityRepo: identityRepo as unknown as Parameters<typeof buildServer>[0]['identityRepo'],
      authRepo: authRepo as unknown as Parameters<typeof buildServer>[0]['authRepo'],
      auditRepo: auditRepo as unknown as Parameters<typeof buildServer>[0]['auditRepo'],
      inboxRepo: inboxRepo as unknown as Parameters<typeof buildServer>[0]['inboxRepo'],
      outboxRepo: outboxRepo as unknown as Parameters<typeof buildServer>[0]['outboxRepo'],
      adapterConnectionRepo,
      transport,
      gatewayService
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a Switch agent securely without returning plaintext API key to the client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/switch/register',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        name: 'proofmesh-watchdog',
        description: 'Watches Switch rooms for compliance claims',
        connector_type: 'langchain_runtime',
        integration_profile: {
          connection_model: 'always_on',
          message_exchange: true,
          pre_invocation_mediation: [],
          post_invocation_mediation: [],
          event_reporting: []
        }
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('registered');
    expect(body.id).toBeDefined();
    expect(body.name).toBe('proofmesh-watchdog');
    expect(body.storedSecurely).toBe(true);
    // Non-negotiable security invariant: API key must NOT be returned to the client
    expect(body).not.toHaveProperty('api_key');

    // Confirm connection state was persisted
    const saved = await adapterConnectionRepo.getConnection(tenantId, 'switch', body.id);
    expect(saved).toBeDefined();
    expect(saved?.instanceId).toBe(body.id);
  });

  it('ingests Switch inbound event frame and persists canonical message into inbox', async () => {
    const messageId = `msg_${crypto.randomUUID()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/switch/events?agent_id=pm_agent_01',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        event: 'message',
        id: 105,
        data: {
          type: 'message',
          room_id: 'room_finance_audit',
          sequence: 105,
          payload: {
            message_id: messageId,
            sender: '@switch-user-bob:server.local',
            sender_name: 'Bob Banker',
            body: 'Claiming zero balance error on account 1234',
            timestamp: Date.now(),
            addressed: true,
            attachments: []
          }
        }
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.eventsIngested).toBe(1);

    // Verify event landed in the inbox
    const inboxRecord = inboxRepo.records.find(
      (r) => r.eventType === 'io.proofmesh.message.observed.v1'
    );
    expect(inboxRecord).toBeDefined();
    expect(inboxRecord?.payload.actor.principalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('formats review case and remediation outbound messages for Switch rooms', async () => {
    const reviewCaseId = crypto.randomUUID();
    const reviewRes = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/switch/messages',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        kind: 'review_case',
        room_id: 'room_compliance',
        review_case_id: reviewCaseId,
        title: 'High Velocity Transaction Review',
        summary: 'Transactions exceeded $1M in under 60 seconds',
        claim_statement: 'High velocity transfer verified by KYC agent',
        decision_policy: 'policy_fin_crime_v1',
        required_role: 'compliance_officer'
      }
    });

    expect(reviewRes.statusCode).toBe(200);
    const reviewBody = reviewRes.json();
    expect(reviewBody.formatted.room_id).toBe('room_compliance');
    expect(reviewBody.formatted.content).toContain('High Velocity Transaction Review');
    expect(reviewBody.formatted.content).toContain(reviewCaseId);
  });

  it('accepts valid HMAC webhook request and ingests into inbox', async () => {
    const payload = {
      eventType: 'io.proofmesh.source.artifact.registered.v1',
      source: 'github_webhook',
      occurredAt: new Date().toISOString(),
      idempotencyKey: 'idemp-wh-api-01',
      data: {
        artifactId: crypto.randomUUID(),
        artifactVersion: 1,
        uri: 'github://proofmesh/repo/commits/c0ffee123456',
        mimeType: 'application/json',
        contentHash: `sha256:${crypto.createHash('sha256').update('commit').digest('hex')}`,
        byteSize: 1024,
        action: 'registered'
      }
    };

    const rawBody = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = WebhookSignatureVerifier.sign(webhookSecret, rawBody, timestamp);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/webhooks/github',
      headers: {
        'x-tenant-id': tenantId,
        'x-proofmesh-signature': `sha256=${signature}`,
        'x-proofmesh-timestamp': timestamp,
        'content-type': 'application/json'
      },
      payload: rawBody
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.source).toBe('github');
    expect(body.envelopesProcessed).toBe(1);

    const inboxRecord = inboxRepo.records.find((r) => r.idempotencyKey === 'idemp-wh-api-01');
    expect(inboxRecord).toBeDefined();
  });

  it('rejects tampered webhook signature with 401', async () => {
    const payload = { eventType: 'test', source: 'test', data: {} };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Date.now());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/webhooks/github',
      headers: {
        'x-tenant-id': tenantId,
        'x-proofmesh-signature':
          'sha256=invalid_signature_hex_digest_that_does_not_match_payload_32_bytes',
        'x-proofmesh-timestamp': timestamp,
        'content-type': 'application/json'
      },
      payload: rawBody
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_SIGNATURE');
  });

  it('accepts standard OTLP JSON traces and ingests into inbox', async () => {
    const traceId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const spanId = '0123456789abcdef';

    const otlpPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'gateway-api' } }]
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId,
                  spanId,
                  name: 'POST /v1/claims',
                  kind: 2,
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000100000000',
                  attributes: [
                    { key: 'http.status_code', value: { intValue: 201 } },
                    { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
                    { key: 'gen_ai.request.model', value: { stringValue: 'claude-3-5-sonnet' } },
                    { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/opentelemetry/v1/traces',
      headers: { authorization: `Bearer ${userToken}` },
      payload: otlpPayload
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty('partialSuccess');

    const spanRecord = inboxRepo.records.find(
      (r) => r.idempotencyKey === `otel_${traceId}_${spanId}`
    );
    expect(spanRecord).toBeDefined();
    expect(spanRecord?.payload.type).toBe('io.proofmesh.telemetry.span.received.v1');
  });

  it('exposes aggregated and single-adapter health diagnostics', async () => {
    const summaryRes = await app.inject({
      method: 'GET',
      url: '/v1/gateway/adapters/health'
    });

    expect(summaryRes.statusCode).toBe(200);
    const summaryBody = summaryRes.json();
    expect(summaryBody.status).toBeDefined();
    expect(summaryBody.adapters).toBeInstanceOf(Array);
    expect(summaryBody.adapters.length).toBeGreaterThan(0);

    const singleRes = await app.inject({
      method: 'GET',
      url: '/v1/gateway/adapters/otel_standard_receiver/health'
    });

    expect(singleRes.statusCode).toBe(200);
    const singleBody = singleRes.json();
    expect(singleBody.adapterId).toBe('otel_standard_receiver');
    expect(singleBody.protocol).toBe('opentelemetry');
  });
});
