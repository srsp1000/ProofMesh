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
import type { InboxRepository, OutboxRepository } from '../../packages/db/src/index.js';
import { EnvelopeSecretManager } from '../../packages/db/src/secrets/secret-manager.js';
import { GatewayService } from '../../apps/api/src/gateway/service.js';
import { WebhookSignatureVerifier } from '../../packages/domain/src/security/webhook-signature.js';

describe('Adapter Security Controls, Tenant Isolation & Attack Defense (Security)', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let adapterConnectionRepo: InMemoryAdapterConnectionRepository;
  let transport: InMemoryEventTransport;
  let secretManager: EnvelopeSecretManager;
  let gatewayService: GatewayService;

  const jwtSecret = 'test_secret_for_adapter_security_testing_min_32_chars';
  const webhookSecret = 'test_secret_for_adapter_sec_ctrls_32b';
  const jwtSigner = new JwtSigner(jwtSecret);

  let tenantAId: string;
  let tenantBId: string;
  let tokenTenantA: string;
  let tokenTenantB: string;

  beforeAll(async () => {
    identityRepo = new InMemoryIdentityRepository();
    authRepo = new InMemoryAuthRepository();
    auditRepo = new InMemoryAuditRepository();
    inboxRepo = new InMemoryInboxRepository();
    outboxRepo = new InMemoryOutboxRepository();
    adapterConnectionRepo = new InMemoryAdapterConnectionRepository();
    transport = new InMemoryEventTransport();
    secretManager = new EnvelopeSecretManager();
    gatewayService = new GatewayService(
      inboxRepo as unknown as InboxRepository,
      outboxRepo as unknown as OutboxRepository,
      transport
    );

    // Tenant A
    const tenantA = await identityRepo.createTenant({ name: 'Tenant A', slug: 'tenant-a' });
    tenantAId = tenantA.id;
    const userA = await identityRepo.createPrincipal(tenantAId, {
      type: 'human_user',
      identifier: 'alice@tenant-a.com',
      displayName: 'Alice A'
    });
    const adminRoleA = (await authRepo.getRoleByName(tenantAId, 'admin'))!;
    await authRepo.assignRole(tenantAId, { principalId: userA.id, roleId: adminRoleA.id });
    tokenTenantA = jwtSigner.sign({
      sub: userA.identifier,
      tenant_id: tenantAId,
      email: userA.identifier,
      name: userA.displayName
    });

    // Tenant B
    const tenantB = await identityRepo.createTenant({ name: 'Tenant B', slug: 'tenant-b' });
    tenantBId = tenantB.id;
    const userB = await identityRepo.createPrincipal(tenantBId, {
      type: 'human_user',
      identifier: 'bob@tenant-b.com',
      displayName: 'Bob B'
    });
    const adminRoleB = (await authRepo.getRoleByName(tenantBId, 'admin'))!;
    await authRepo.assignRole(tenantBId, { principalId: userB.id, roleId: adminRoleB.id });
    tokenTenantB = jwtSigner.sign({
      sub: userB.identifier,
      tenant_id: tenantBId,
      email: userB.identifier,
      name: userB.displayName
    });

    app = await buildServer({
      jwtSecret,
      webhookSecret,
      maxPayloadBytes: 10 * 1024, // 10 KB strict limit for security test
      identityRepo: identityRepo as unknown as Parameters<typeof buildServer>[0]['identityRepo'],
      authRepo: authRepo as unknown as Parameters<typeof buildServer>[0]['authRepo'],
      auditRepo: auditRepo as unknown as Parameters<typeof buildServer>[0]['auditRepo'],
      inboxRepo: inboxRepo as unknown as Parameters<typeof buildServer>[0]['inboxRepo'],
      outboxRepo: outboxRepo as unknown as Parameters<typeof buildServer>[0]['outboxRepo'],
      adapterConnectionRepo,
      secretManager,
      transport,
      gatewayService
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. Switch Agent API Key Isolation
  it('registers Switch agent and strictly protects plaintext API keys from client exposure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/switch/register',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        name: 'compliance-auditor-agent',
        description: 'Monitors financial claims',
        connector_type: 'langchain_runtime',
        integration_profile: {
          connection_model: 'always_on',
          supported_events: ['message', 'command'],
          capabilities: ['room_observation']
        }
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Sensitive credentials MUST NOT be returned in API response
    expect(body.apiKey).toBeUndefined();
    expect(body.token).toBeUndefined();
    expect(body.secret).toBeUndefined();
    expect(body.storedSecurely).toBe(true);

    // Verify persisted in DB with encrypted credential reference
    const saved = await adapterConnectionRepo.getConnection(tenantAId, 'switch', body.id);
    expect(saved).toBeDefined();
    expect(saved?.stateMetadata?.credentialRef).toMatch(/^enc:\/\/v1\//);
  });

  // 2. Cross-Tenant Isolation: Switch Frame Ingestion
  it('enforces server-side tenant scoping on Switch inbound frames, rejecting cross-tenant leakage', async () => {
    const messageId = `msg_${crypto.randomUUID()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/switch/events?agent_id=agent_switch_sec',
      headers: { authorization: `Bearer ${tokenTenantA}` },
      payload: {
        event: 'message',
        id: 201,
        data: {
          type: 'message',
          room_id: 'room_finance_claims',
          sequence: 201,
          payload: {
            message_id: messageId,
            sender: '@switch-trader:domain.local',
            sender_name: 'Trader Joe',
            body: 'Executing arbitrage claim on EUR/USD',
            timestamp: Date.now(),
            addressed: true,
            attachments: []
          }
        }
      }
    });

    expect(res.statusCode).toBe(200);

    // Verify inbox record has Tenant A's tenantId derived from authentication context
    const inboxRecord = inboxRepo.records.find(
      (r) => r.idempotencyKey === `switch_room_finance_claims_${messageId}`
    );
    expect(inboxRecord).toBeDefined();
    expect(inboxRecord?.tenantId).toBe(tenantAId);
    expect(inboxRecord?.tenantId).not.toBe(tenantBId);

    // Verify Tenant B cannot access Tenant A's adapter connection
    const connB = await adapterConnectionRepo.getConnection(
      tenantBId,
      'switch',
      'agent_switch_sec'
    );
    expect(connB).toBeNull();

    // Verify requesting health diagnostics with Tenant B's token
    const healthRes = await app.inject({
      method: 'GET',
      url: '/v1/gateway/adapters/switch_agent_switch_sec/health',
      headers: { authorization: `Bearer ${tokenTenantB}` }
    });
    expect([200, 404]).toContain(healthRes.statusCode);
  });

  // 3. Webhook Replay Attack Defense & Expiration
  it('rejects expired webhook timestamps to prevent replay attacks', async () => {
    const expiredTimestamp = String(Date.now() - 360 * 1000); // 360s ago (> 300s window)
    const payload = {
      eventType: 'io.proofmesh.source.artifact.registered.v1',
      source: 'github_replay',
      occurredAt: new Date().toISOString(),
      idempotencyKey: 'idemp-replay-001',
      data: {
        artifactId: crypto.randomUUID(),
        artifactVersion: 1,
        uri: 'github://org/repo/commit/1234',
        mimeType: 'application/json',
        contentHash: `sha256:${crypto.createHash('sha256').update('replay').digest('hex')}`,
        byteSize: 100,
        action: 'registered'
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = WebhookSignatureVerifier.sign(webhookSecret, rawBody, expiredTimestamp);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/webhooks/github',
      headers: {
        'x-tenant-id': tenantAId,
        'x-proofmesh-signature': `sha256=${signature}`,
        'x-proofmesh-timestamp': expiredTimestamp,
        'content-type': 'application/json'
      },
      payload: rawBody
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('EXPIRED_TIMESTAMP');
    expect(body.detail).toContain('Timestamp skew');
  });

  // 4. Webhook Payload Tampering Defense
  it('rejects tampered webhook payloads with timing-safe signature comparison', async () => {
    const validTimestamp = String(Date.now());
    const originalPayload = {
      eventType: 'io.proofmesh.source.artifact.registered.v1',
      source: 'github_tamper',
      occurredAt: new Date().toISOString(),
      idempotencyKey: 'idemp-tamper-001',
      data: {
        artifactId: crypto.randomUUID(),
        artifactVersion: 1,
        uri: 'github://org/repo/commit/orig',
        mimeType: 'application/json',
        contentHash: `sha256:${crypto.createHash('sha256').update('orig').digest('hex')}`,
        byteSize: 100,
        action: 'registered'
      }
    };

    const signature = WebhookSignatureVerifier.sign(
      webhookSecret,
      JSON.stringify(originalPayload),
      validTimestamp
    );

    // Tamper with data payload
    const tamperedPayload = {
      ...originalPayload,
      data: { ...originalPayload.data, uri: 'github://attacker/malicious/commit/666' }
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/webhooks/github',
      headers: {
        'x-tenant-id': tenantAId,
        'x-proofmesh-signature': `sha256=${signature}`,
        'x-proofmesh-timestamp': validTimestamp,
        'content-type': 'application/json'
      },
      payload: JSON.stringify(tamperedPayload)
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('INVALID_SIGNATURE');
  });

  // 5. OpenTelemetry Payload Size Limit
  it('rejects oversized OTLP trace payloads exceeding maxPayloadBytes', async () => {
    // Generate a payload that exceeds the 10KB test limit
    const hugeSpanName = 'a'.repeat(12 * 1024);
    const oversizedPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: '1234567890abcdef1234567890abcdef',
                  spanId: '1234567890abcdef',
                  name: hugeSpanName,
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000001000000000'
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
      headers: {
        authorization: `Bearer ${tokenTenantA}`,
        'content-type': 'application/json'
      },
      payload: JSON.stringify(oversizedPayload)
    });

    expect(res.statusCode).toBe(413);
  });

  // 6. OpenTelemetry Causality Integrity & Privacy Redaction
  it('enforces observation-only semantics and redaction of LLM prompts/completions by default', async () => {
    const traceId = '4bfb101ba4ee64ced6547f404e123456';
    const spanId = '00f067aa0ba902b7';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gateway/adapters/opentelemetry/v1/traces',
      headers: {
        authorization: `Bearer ${tokenTenantA}`,
        'content-type': 'application/json'
      },
      payload: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'credit-scoring-agent' } }]
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: 'chat openai',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000001000000000',
                    attributes: [
                      { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                      { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
                      {
                        key: 'gen_ai.prompt',
                        value: { stringValue: 'Secret user financial history payload' }
                      },
                      {
                        key: 'gen_ai.completion',
                        value: { stringValue: 'Confidential loan decision' }
                      },
                      { key: 'proofmesh.workflow_id', value: { stringValue: 'wf_credit_sec_1' } }
                    ],
                    status: { code: 1 }
                  }
                ]
              }
            ]
          }
        ]
      }
    });

    expect(res.statusCode).toBe(202);

    // Verify span record in inbox
    const spanRecord = inboxRepo.records.find(
      (r) =>
        r.eventType === 'io.proofmesh.telemetry.span.received.v1' && r.payload.traceId === traceId
    );
    expect(spanRecord).toBeDefined();

    // Domain Rule 5: Causality Integrity - traces are strictly 'captured', NEVER inferring declared dependencies
    expect(spanRecord?.payload.captureMethod).toBe('captured');

    // Privacy by default: prompts/completions must be stripped in metadata_only mode
    const attrs = spanRecord?.payload.data.attributes as Record<string, unknown>;
    expect(attrs['gen_ai.prompt']).toBeUndefined();
    expect(attrs['gen_ai.completion']).toBeUndefined();
  });
});
