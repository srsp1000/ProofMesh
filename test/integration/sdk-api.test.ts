import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
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
import type { InboxRepository, OutboxRepository } from '../../packages/db/src/index.js';
import { ProofMeshClient } from '@proofmesh/sdk';

describe('TypeScript SDK API Integration', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let adapterConnectionRepo: InMemoryAdapterConnectionRepository;
  let transport: InMemoryEventTransport;
  let gatewayService: GatewayService;

  const jwtSecret = 'test_secret_for_sdk_api_integration_32chars';
  const webhookSecret = 'test_secret_for_sdk_webhook_32chars';
  const jwtSigner = new JwtSigner(jwtSecret);

  let tenantId: string;
  let userToken: string;
  let client: ProofMeshClient;

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
      name: 'SDK Test Tenant',
      slug: 'sdk-test-tenant'
    });
    tenantId = tenant.id;

    const user = await identityRepo.createPrincipal(tenantId, {
      type: 'human_user',
      identifier: 'developer@proofmesh.com',
      displayName: 'SDK Developer'
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
      adapterConnectionRepo: adapterConnectionRepo as unknown as Parameters<
        typeof buildServer
      >[0]['adapterConnectionRepo'],
      transport,
      gatewayService
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    client = new ProofMeshClient({
      apiKey: userToken,
      baseUrl,
      tenantId
    });
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  it('registers and retrieves a semantic claim via SDK', async () => {
    const claim = await client.claims.register({
      claimConceptKey: 'eligibility_age_verified',
      statement: 'Applicant is confirmed to be over 21 years old based on passport OCR.',
      qualifiers: {
        source_doc_type: 'passport',
        ocr_confidence: 0.99
      },
      captureMethod: 'declared'
    });

    expect(claim.id).toBeDefined();
    expect(claim.conceptKey).toBe('eligibility_age_verified');
    expect(claim.status).toBe('submitted');
    expect(claim.qualifiers.proofmesh_capture_method).toBe('declared');

    // Retrieve via SDK
    const fetched = await client.claims.get(claim.id);
    expect(fetched.id).toBe(claim.id);
    expect(fetched.statement).toBe(claim.statement);
  });

  it('creates and retrieves a context packet via SDK', async () => {
    const packet = await client.contextPackets.create({
      packetType: 'rag_retrieval',
      passages: [
        {
          passageId: crypto.randomUUID(),
          content: 'Verified KYC passport passage text',
          score: 0.98
        }
      ],
      totalTokens: 45
    });

    expect(packet.id).toBeDefined();
    expect(packet.packetType).toBe('rag_retrieval');
    expect(packet.totalTokens).toBe(45);

    const fetched = await client.contextPackets.get(packet.id);
    expect(fetched.id).toBe(packet.id);
    expect(fetched.passages).toHaveLength(1);
  });

  it('declares an explicit evidence dependency via SDK', async () => {
    const prereqClaimId = crypto.randomUUID();
    const dependentClaimId = crypto.randomUUID();

    const dep = await client.dependencies.declare({
      dependentEntityId: dependentClaimId,
      dependentEntityType: 'claim',
      prerequisiteEntityId: prereqClaimId,
      prerequisiteEntityType: 'claim',
      relationshipType: 'supports',
      declarationReason: 'Passport proof supports eligibility decision'
    });

    expect(dep.id).toBeDefined();
    expect(dep.relationshipType).toBe('supports');
    expect(dep.dependentEntityId).toBe(dependentClaimId);
    expect(dep.prerequisiteEntityId).toBe(prereqClaimId);
  });

  it('registers a decision and evaluates admissibility', async () => {
    const claimId = crypto.randomUUID();

    const decision = await client.decisions.register({
      decisionType: 'account_approval',
      outcome: 'approved',
      rationale: 'All prerequisite KYC claims verified and admissible',
      contributingClaimIds: [claimId],
      admissibilityStatus: 'admissible'
    });

    expect(decision.id).toBeDefined();
    expect(decision.outcome).toBe('approved');

    const fetched = await client.decisions.get(decision.id);
    expect(fetched.id).toBe(decision.id);
    expect(fetched.rationale).toBe(decision.rationale);

    // Check admissibility
    const checkResult = await client.admissibility.check({
      claimVersionId: claimId,
      policyName: 'default_kyc_sufficiency'
    });

    expect(checkResult.isAdmissible).toBe(true);
    expect(checkResult.disposition).toBe('admit');
    expect(checkResult.rulesTriggered.length).toBeGreaterThan(0);
  });

  it('requests and retrieves a human review case via SDK', async () => {
    const review = await client.reviews.request({
      title: 'Suspicious Document Alert',
      summary: 'Automated check flagged possible image alteration requiring manual review',
      requiredRole: 'compliance_officer',
      priority: 'high'
    });

    expect(review.id).toBeDefined();
    expect(review.status).toBe('pending');
    expect(review.priority).toBe('high');

    const fetched = await client.reviews.get(review.id);
    expect(fetched.id).toBe(review.id);
    expect(fetched.summary).toBe(review.summary);
  });

  it('queries lineage blast radius impact report via SDK', async () => {
    const entityId = crypto.randomUUID();
    const report = await client.lineage.getImpactReport(entityId, 'claim');

    expect(report.rootEntityId).toBe(entityId);
    expect(report.rootEntityType).toBe('claim');
    expect(typeof report.totalDownstreamAffectedCount).toBe('number');
  });

  it('buffers and flushes OpenTelemetry spans via SDK telemetry buffer', async () => {
    client.telemetry.recordSpan({
      name: 'workflow:integration_run',
      kind: 'INTERNAL',
      startTimeUnixNano: Date.now() * 1_000_000,
      endTimeUnixNano: (Date.now() + 50) * 1_000_000,
      status: 'ok',
      attributes: {
        'test.run': 'sdk_integration'
      }
    });

    // Flush should succeed without error
    await expect(client.flush()).resolves.not.toThrow();
  });
});
