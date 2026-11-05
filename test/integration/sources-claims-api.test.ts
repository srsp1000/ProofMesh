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

describe('Sources & Claim Intelligence API Integration', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let adapterConnectionRepo: InMemoryAdapterConnectionRepository;
  let transport: InMemoryEventTransport;
  let gatewayService: GatewayService;

  const jwtSecret = 'test_secret_for_sources_claims_api_32chars';
  const webhookSecret = 'test_secret_for_webhook_32chars';
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
      name: 'Sources Test Tenant',
      slug: 'sources-test-tenant'
    });
    tenantId = tenant.id;

    const user = await identityRepo.createPrincipal(tenantId, {
      type: 'human_user',
      displayName: 'Auditor User',
      email: 'auditor@proofmesh.test'
    });

    const _apiKey = await authRepo.createApiKey(tenantId, user.id, {
      keyHash: 'hash_test_source_claims',
      keyPrefix: 'pm_live_src',
      scopes: ['*'],
      name: 'Integration Test Key'
    });

    userToken = jwtSigner.sign({
      sub: user.id,
      tenant_id: tenantId,
      principal_type: 'human_user',
      roles: ['compliance_officer', 'security_engineer'],
      permissions: ['*'],
      scope: 'read write admin',
      token_id: crypto.randomUUID()
    });

    app = await buildServer({
      jwtSecret,
      jwtSigner,
      identityRepo,
      authRepo,
      auditRepo,
      inboxRepo: inboxRepo as unknown as InboxRepository,
      outboxRepo: outboxRepo as unknown as OutboxRepository,
      adapterConnectionRepo,
      transport,
      gatewayService,
      webhookSecret
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    client = new ProofMeshClient({
      baseUrl,
      apiKey: userToken
    });
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  it('registers and retrieves a source artifact via SDK', async () => {
    const artifact = await client.sources.registerArtifact({
      originalUri: 'https://docs.proofmesh.io/security.pdf',
      sourceType: 'pdf',
      title: 'Security Architecture',
      issuer: 'ProofMesh Lead Architect',
      mimeType: 'application/pdf',
      permissionContext: 'internal',
      retentionState: 'active',
      metadata: { release: 'v1.0' }
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.title).toBe('Security Architecture');

    const fetched = await client.sources.getArtifact(artifact.id);
    expect(fetched.id).toBe(artifact.id);
  });

  it('updates artifact retention state and respects legal hold', async () => {
    const artifact = await client.sources.registerArtifact({
      originalUri: 'https://docs.proofmesh.io/legal.pdf',
      sourceType: 'pdf',
      title: 'Legal Hold Document',
      mimeType: 'application/pdf',
      permissionContext: 'restricted',
      retentionState: 'active',
      metadata: {}
    });

    // Place on legal hold
    const onHold = await client.sources.updateRetention(
      artifact.id,
      'legal_hold',
      'Compliance Audit'
    );
    expect(onHold.retentionState).toBe('legal_hold');

    // Attempting to soft-delete must throw error
    await expect(
      client.sources.updateRetention(artifact.id, 'soft_deleted', 'Purge request')
    ).rejects.toThrow();
  });

  it('safely ingests a text document file and extracts passages', async () => {
    const rawText =
      '# Architecture Overview\nProofMesh provides immutable evidence lineage.\n\n# Policy Enforcement\nClaims are attested only when evidence meets threshold.';
    const contentBase64 = Buffer.from(rawText).toString('base64');

    const res = await client.sources.ingestFile({
      filename: 'architecture.md',
      contentBase64,
      permissionContext: 'internal'
    });

    expect(res.artifact.id).toBeDefined();
    expect(res.version.id).toBeDefined();
    expect(res.passages.length).toBeGreaterThanOrEqual(2);
    expect(res.warnings).toHaveLength(0);

    const passages = await client.sources.getPassages(res.version.id);
    expect(passages.count).toBeGreaterThanOrEqual(2);
  });

  it('creates an immutable source snapshot manifest', async () => {
    const rawA = Buffer.from('Document Alpha').toString('base64');
    const resA = await client.sources.ingestFile({ filename: 'docA.txt', contentBase64: rawA });

    const rawB = Buffer.from('Document Beta').toString('base64');
    const resB = await client.sources.ingestFile({ filename: 'docB.txt', contentBase64: rawB });

    const snapshot = await client.sources.createSnapshot([resA.version.id, resB.version.id]);
    expect(snapshot.id).toBeDefined();
    expect(snapshot.sourceVersionIds).toEqual([resA.version.id, resB.version.id]);
    expect(snapshot.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('extracts atomic material propositions via claim intelligence', async () => {
    const text =
      'ProofMesh is an AI governance platform. The system operates on PostgreSQL 16. We guarantee 99.99% uptime.';
    const extraction = await client.claimIntelligence.extract({
      sourceVersionId: crypto.randomUUID(),
      text,
      modelMetadata: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        version: '20241022'
      },
      promptTemplateVersion: 'v1.0.0'
    });

    expect(extraction.propositions.length).toBeGreaterThanOrEqual(2);
    expect(extraction.coverageScore).toBeGreaterThan(0);

    // Verify presence of commitment and factual_claim
    const types = extraction.propositions.map((p) => p.propositionType);
    expect(types).toContain('commitment');
    expect(types).toContain('factual_claim');
  });

  it('records claim occurrences and supports human corrections with audit trail', async () => {
    const claimVersionId = crypto.randomUUID();

    // 1. Record occurrence
    const occurrence = await client.claimIntelligence.recordOccurrence({
      claimVersionId,
      exactPassageText: 'The subscription costs $500 monthly.',
      charStart: 0,
      charEnd: 36
    });

    expect(occurrence.id).toBeDefined();
    expect(occurrence.claimVersionId).toBe(claimVersionId);

    const occurrences = await client.claimIntelligence.getOccurrences(claimVersionId);
    expect(occurrences.count).toBe(1);

    // 2. Submit human correction
    const correction = await client.claimIntelligence.submitCorrection(claimVersionId, {
      fieldName: 'normalizedUnit',
      originalValue: 'USD',
      correctedValue: 'EUR',
      correctionReason: 'Original document was in EUR, not USD.'
    });

    expect(correction.id).toBeDefined();
    expect(correction.originalValue).toBe('USD');
    expect(correction.correctedValue).toBe('EUR');

    const auditTrail = await client.claimIntelligence.getCorrections(claimVersionId);
    expect(auditTrail.count).toBe(1);
    expect(auditTrail.corrections[0]?.fieldName).toBe('normalizedUnit');
  });

  it('detects duplicate concept candidates and prevents merging differing scopes', async () => {
    const prop = {
      id: crypto.randomUUID(),
      propositionType: 'factual_claim' as const,
      rawStatement: 'ProofMesh costs $100 monthly in US',
      normalizedSubject: 'proofmesh',
      normalizedPredicate: 'costs',
      normalizedObject: '$100 monthly in US',
      normalizedUnit: 'USD',
      qualifiers: { region: 'US' },
      sourcePassageId: null,
      confidenceScore: 0.95,
      confidenceCategory: 'high' as const
    };

    const existing = [
      {
        id: crypto.randomUUID(),
        conceptKey: 'proofmesh_costs_$100 monthly in US',
        qualifiers: { region: 'EU' } // Different region!
      }
    ];

    const result = await client.claimIntelligence.detectDuplicates(prop, existing);
    expect(result.count).toBe(1);
    expect(result.candidates[0]?.canMerge).toBe(false);
    expect(result.candidates[0]?.scopeDifferences).toContain('region:US!=EU');
  });
});
