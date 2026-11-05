import { describe, it, expect } from 'vitest';
import {
  CreateTenantSchema,
  CreateWorkspaceSchema,
  CreateProjectSchema,
  CreatePrincipalSchema,
  CreateApiKeyInputSchema,
  AuditEventSchema,
  AuditCheckpointSchema
} from '../../packages/contracts/src/index.js';

describe('Identity & Audit Schemas (Contract)', () => {
  it('validates correct CreateTenantSchema and rejects malformed slugs', () => {
    const valid = CreateTenantSchema.safeParse({
      name: 'Acme Corporation',
      slug: 'acme-corp'
    });
    expect(valid.success).toBe(true);

    const invalid = CreateTenantSchema.safeParse({
      name: 'Acme Corp',
      slug: 'Acme Corp with Spaces and Uppercase!'
    });
    expect(invalid.success).toBe(false);
  });

  it('validates Workspace and Project creation schemas', () => {
    const validWorkspace = CreateWorkspaceSchema.safeParse({ name: 'Compliance Team' });
    expect(validWorkspace.success).toBe(true);

    const validProject = CreateProjectSchema.safeParse({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      key: 'KYC_AGENT_01',
      name: 'KYC Autonomous Reviewer'
    });
    expect(validProject.success).toBe(true);

    const invalidProject = CreateProjectSchema.safeParse({
      workspaceId: 'not-a-uuid',
      key: 'invalid key with spaces',
      name: 'Name'
    });
    expect(invalidProject.success).toBe(false);
  });

  it('validates Principal and ApiKey input schemas', () => {
    const validPrincipal = CreatePrincipalSchema.safeParse({
      type: 'agent_identity',
      identifier: 'agent://langchain/risk-bot',
      displayName: 'Risk Assessment Agent'
    });
    expect(validPrincipal.success).toBe(true);

    const validApiKey = CreateApiKeyInputSchema.safeParse({
      principalId: '22222222-2222-4222-8222-222222222222',
      name: 'CI Ingestion Key',
      scopes: ['claims:submit', 'evidence:ingest'],
      expiresInDays: 30
    });
    expect(validApiKey.success).toBe(true);
  });

  it('validates AuditEventSchema and AuditCheckpointSchema structure', () => {
    const validAuditEvent = AuditEventSchema.safeParse({
      id: '1001',
      tenantId: '33333333-3333-4333-8333-333333333333',
      principalId: '44444444-4444-4444-8444-444444444444',
      action: 'claim.attested',
      entityType: 'claim_version',
      entityId: '55555555-5555-4555-8555-555555555555',
      payloadHash: `sha256:${'a'.repeat(64)}`,
      payloadDiff: { before: 'submitted', after: 'attested' },
      prevEventHash: `sha256:${'0'.repeat(64)}`,
      correlationId: 'req-12345',
      policyDecision: 'admit',
      recordedAt: new Date().toISOString()
    });
    expect(validAuditEvent.success).toBe(true);

    const validCheckpoint = AuditCheckpointSchema.safeParse({
      id: '50',
      tenantId: '33333333-3333-4333-8333-333333333333',
      startEventId: '1',
      endEventId: '1000',
      eventCount: 1000,
      merkleRoot: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      prevCheckpointRoot: null,
      signature: 'sig_mock_ed25519',
      sealedAt: new Date().toISOString()
    });
    expect(validCheckpoint.success).toBe(true);
  });
});
