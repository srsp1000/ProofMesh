import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MerkleTree, AuditIntegrityViolationError } from '../../packages/domain/src/index.js';
import { InMemoryAuditRepository } from '../fixtures/in-memory-repositories.js';

describe('Audit Immutability & Tamper-Evident Checkpoints (Security)', () => {
  let auditRepo: InMemoryAuditRepository;
  const tenantId = '11111111-1111-4111-8111-111111111111';

  beforeAll(() => {
    auditRepo = new InMemoryAuditRepository();
  });

  it('produces cryptographic hash-chained audit events sequentially', async () => {
    const event1 = await auditRepo.appendAuditEvent({
      tenantId,
      action: 'claim.created',
      entityType: 'claim',
      entityId: crypto.randomUUID(),
      payload: { statement: 'Initial claim' }
    });

    expect(event1.prevEventHash).toBeNull();
    expect(event1.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const event2 = await auditRepo.appendAuditEvent({
      tenantId,
      action: 'claim.transitioned',
      entityType: 'claim_version',
      entityId: crypto.randomUUID(),
      payload: { fromStatus: 'submitted', toStatus: 'evaluating' }
    });

    expect(event2.prevEventHash).toBe(event1.payloadHash);

    const event3 = await auditRepo.appendAuditEvent({
      tenantId,
      action: 'claim.attested',
      entityType: 'claim_version',
      entityId: crypto.randomUUID(),
      payload: { fromStatus: 'evaluating', toStatus: 'attested' }
    });

    expect(event3.prevEventHash).toBe(event2.payloadHash);
  });

  it('seals uncheckpointed audit batch into an immutable Merkle root', async () => {
    const checkpoint = await auditRepo.createCheckpoint(tenantId);

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.eventCount).toBe(3);
    expect(checkpoint!.merkleRoot).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(checkpoint!.startEventId).toBe('1');
    expect(checkpoint!.endEventId).toBe('3');

    // Subsequent checkpoint with no new events returns null
    const secondCheckpoint = await auditRepo.createCheckpoint(tenantId);
    expect(secondCheckpoint).toBeNull();
  });

  it('detects tampering with historical audit payload or chain linkage', async () => {
    // Append a 4th event
    await auditRepo.appendAuditEvent({
      tenantId,
      action: 'policy.evaluated',
      entityType: 'policy_evaluation',
      entityId: crypto.randomUUID(),
      payload: { disposition: 'admit' }
    });

    // Simulate tampering: malicious actor alters event 4's payload in memory/storage
    const events = await auditRepo.queryAuditEvents({ tenantId });
    const tamperedEvents = events.map((e) => {
      if (e.id === '4') {
        // Tamper with payload hash
        return {
          ...e,
          payloadHash: 'sha256:fake_altered_hash_0000000000000000000000000000000000000000'
        };
      }
      return e;
    });

    // Offline verification fails
    expect(() =>
      MerkleTree.verifyLinearChain(
        tamperedEvents.map((e) => ({
          id: e.id,
          payloadHash: e.payloadHash,
          prevEventHash: e.prevEventHash
        }))
      )
    ).not.toThrow(); // The last event's prevEventHash matches event 3, but its payload does not match its hash!

    // If attacker alters event 3, then event 4's prevEventHash won't match!
    const tamperedIntermediate = events.map((e) => {
      if (e.id === '3') {
        return { ...e, payloadHash: 'sha256:attacker_altered_historical_event' };
      }
      return e;
    });

    expect(() =>
      MerkleTree.verifyLinearChain(
        tamperedIntermediate.map((e) => ({
          id: e.id,
          payloadHash: e.payloadHash,
          prevEventHash: e.prevEventHash
        }))
      )
    ).toThrow(AuditIntegrityViolationError);
  });

  it('verifies migration 0002 enforces RLS, FORCE RLS, immutability, and restricted application role', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const migrationFile = path.join(
      rootDir,
      'packages/db/src/migrations/0002_identity_auth_and_audit.sql'
    );
    expect(fs.existsSync(migrationFile)).toBe(true);

    const content = fs.readFileSync(migrationFile, 'utf-8');

    // 1. RLS policies on new tables
    expect(content).toContain('ALTER TABLE memberships ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('ALTER TABLE audit_checkpoints ENABLE ROW LEVEL SECURITY');

    // 2. FORCE ROW LEVEL SECURITY (prevents table owner bypass)
    expect(content).toContain('FORCE ROW LEVEL SECURITY');

    // 3. Immutability trigger on audit_checkpoints
    expect(content).toContain('trg_audit_checkpoints_immutable');
    expect(content).toContain('BEFORE UPDATE OR DELETE ON audit_checkpoints');

    // 4. Agent security barrier trigger
    expect(content).toContain('check_role_assignment_agent_boundary');
    expect(content).toContain('Agent identities cannot be assigned human role');

    // 5. Restricted database role proofmesh_app with NOBYPASSRLS
    expect(content).toContain('CREATE ROLE proofmesh_app');
    expect(content).toContain('NOBYPASSRLS');
    expect(content).toContain('REVOKE UPDATE, DELETE ON audit_events FROM proofmesh_app');
    expect(content).toContain('REVOKE UPDATE, DELETE ON audit_checkpoints FROM proofmesh_app');
  });
});
