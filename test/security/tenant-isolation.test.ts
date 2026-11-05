import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { buildServer } from '../../apps/api/src/server.js';
import { JwtSigner } from '../../apps/api/src/auth/jwt.js';
import {
  InMemoryIdentityRepository,
  InMemoryAuthRepository,
  InMemoryAuditRepository
} from '../fixtures/in-memory-repositories.js';
import type { FastifyInstance } from 'fastify';

describe('Tenant Isolation, Authorization & Anti-Impersonation (Security)', () => {
  let app: FastifyInstance;
  let identityRepo: InMemoryIdentityRepository;
  let authRepo: InMemoryAuthRepository;
  let auditRepo: InMemoryAuditRepository;
  let jwtSigner: JwtSigner;

  const jwtSecret = 'test_secret_jwt_with_sufficient_length_32_chars';

  let tenantAId: string;
  let tenantBId: string;
  let userAToken: string;
  let userBToken: string;
  let agentAKeyToken: string;

  beforeAll(async () => {
    identityRepo = new InMemoryIdentityRepository();
    authRepo = new InMemoryAuthRepository();
    auditRepo = new InMemoryAuditRepository();
    jwtSigner = new JwtSigner(jwtSecret);

    // Bootstrap Tenant A
    const tenantA = await identityRepo.createTenant({ name: 'Alpha Corp', slug: 'alpha-corp' });
    tenantAId = tenantA.id;
    const userA = await identityRepo.createPrincipal(tenantAId, {
      type: 'human_user',
      identifier: 'alice@alpha.com',
      displayName: 'Alice Admin'
    });
    // Assign admin role to userA
    const adminRole = (await authRepo.getRoleByName(tenantAId, 'admin'))!;
    await authRepo.assignRole(tenantAId, { principalId: userA.id, roleId: adminRole.id });

    userAToken = jwtSigner.sign({
      sub: userA.identifier,
      tenant_id: tenantAId,
      name: userA.displayName,
      email: userA.identifier
    });

    // Bootstrap Tenant B
    const tenantB = await identityRepo.createTenant({ name: 'Beta Ltd', slug: 'beta-ltd' });
    tenantBId = tenantB.id;
    const userB = await identityRepo.createPrincipal(tenantBId, {
      type: 'human_user',
      identifier: 'bob@beta.com',
      displayName: 'Bob User'
    });
    userBToken = jwtSigner.sign({
      sub: userB.identifier,
      tenant_id: tenantBId,
      name: userB.displayName,
      email: userB.identifier
    });

    // Create Agent Principal in Tenant A
    const agentA = await identityRepo.createPrincipal(tenantAId, {
      type: 'agent_identity',
      identifier: 'agent://langchain/ingest-worker',
      displayName: 'Ingestion Agent'
    });
    const agentRole = (await authRepo.getRoleByName(tenantAId, 'agent_ingest'))!;
    await authRepo.assignRole(tenantAId, { principalId: agentA.id, roleId: agentRole.id });

    // Create API Key for Agent A directly in repo
    const keyPrefix = 'pm_live_1234';
    const secretToken = 'pm_live_1234567890abcdef12345678';
    const keyHash = createHash('sha256').update(secretToken, 'utf8').digest('hex');
    agentAKeyToken = secretToken;

    await authRepo.createApiKey(
      tenantAId,
      agentA.id,
      'Ingest Key',
      keyPrefix,
      keyHash,
      ['claims:submit', 'evidence:ingest'],
      new Date(Date.now() + 86400000)
    );

    app = await buildServer({
      jwtSigner,
      identityRepo: identityRepo as unknown as Parameters<typeof buildServer>[0]['identityRepo'],
      authRepo: authRepo as unknown as Parameters<typeof buildServer>[0]['authRepo'],
      auditRepo: auditRepo as unknown as Parameters<typeof buildServer>[0]['auditRepo'],
      logger: false
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('unauthenticated request to protected endpoint returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('cross-tenant IDOR defense: Tenant B cannot read Tenant A records (returns 404, zero existence leak)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantAId}`,
      headers: {
        authorization: `Bearer ${userBToken}`
      }
    });

    // Must return 404 (not 403) so tenant existence is not confirmed to adversary
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('Tenant A can access its own tenant record', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantAId}`,
      headers: {
        authorization: `Bearer ${userAToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(tenantAId);
    expect(body.slug).toBe('alpha-corp');
  });

  it('expired token is rejected with 401', async () => {
    const expiredToken = jwtSigner.sign({
      sub: 'alice@alpha.com',
      tenant_id: tenantAId,
      expiresInSeconds: -10 // expired in the past
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantAId}`,
      headers: {
        authorization: `Bearer ${expiredToken}`
      }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().detail).toContain('expired');
  });

  it('revoked API key is rejected with 401', async () => {
    const agentKeyRecord = authRepo.apiKeys[0]!;
    await authRepo.revokeApiKey(tenantAId, agentKeyRecord.id);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: {
        authorization: `ApiKey ${agentAKeyToken}`
      },
      payload: {
        claimConceptKey: 'test-concept',
        statement: 'Testing claim submission with revoked key.',
        qualifiers: {}
      }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('CREDENTIAL_REVOKED');
  });

  it('agent identities cannot assume human roles or execute human attestation', async () => {
    // Un-revoke key for testing
    authRepo.apiKeys[0]!.revokedAt = null;

    // 1. Agent can submit a claim
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      headers: {
        authorization: `ApiKey ${agentAKeyToken}`
      },
      payload: {
        claimConceptKey: 'ai-summary',
        statement: 'Agent generated summary of quarterly reports.',
        qualifiers: {}
      }
    });

    expect(submitRes.statusCode).toBe(201);
    const claim = submitRes.json();

    // 2. Agent attempts to attest the claim -> MUST BE FORBIDDEN
    const attestRes = await app.inject({
      method: 'POST',
      url: `/v1/claims/${claim.id}/transition`,
      headers: {
        authorization: `ApiKey ${agentAKeyToken}`
      },
      payload: {
        targetState: 'attested',
        transitionReason: 'Agent approving its own claim without human oversight.'
      }
    });

    expect(attestRes.statusCode).toBe(403);
    const body = attestRes.json();
    expect(
      body.code === 'AGENT_HUMAN_IMPERSONATION_PROHIBITED' ||
        body.code === 'HUMAN_PRINCIPAL_REQUIRED' ||
        body.code === 'INSUFFICIENT_PERMISSIONS'
    ).toBe(true);

    // 3. Admin attempting to assign human role (compliance_officer) to agent identity -> BLOCKED
    const officerRole = (await authRepo.getRoleByName(tenantAId, 'compliance_officer'))!;
    const assignRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantAId}/roles/assign`,
      headers: {
        authorization: `Bearer ${userAToken}`
      },
      payload: {
        principalId: authRepo.apiKeys[0]!.principalId, // Agent principal
        roleId: officerRole.id
      }
    });

    expect(assignRes.statusCode).toBe(403);
    expect(assignRes.json().code).toBe('AGENT_PRIVILEGE_ESCALATION_PROHIBITED');
  });

  it('audit record is produced when agent attempts human attestation violation', async () => {
    const auditEvents = await auditRepo.queryAuditEvents({
      tenantId: tenantAId,
      action: 'security.permission_denied'
    });

    expect(auditEvents.length).toBeGreaterThan(0);
    const denial = auditEvents[0]!;
    expect(denial.policyDecision).toBe('deny');
  });

  it('rate limits sensitive token issuance operations', async () => {
    // Fire 25 requests rapidly
    const responses = await Promise.all(
      Array.from({ length: 25 }).map(() =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/tokens/issue',
          payload: { sub: 'rate-limit-test' }
        })
      )
    );

    const rateLimited = responses.filter((r) => r.statusCode === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(rateLimited[0]!.json().code).toBe('RATE_LIMIT_EXCEEDED');
    expect(rateLimited[0]!.headers['retry-after']).toBeDefined();
  });
});
