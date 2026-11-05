import { describe, it, expect } from 'vitest';
import {
  TenantLifecycle,
  InvalidTenantTransitionError,
  DeprovisionedTenantAccessError,
  RBACPolicy,
  AgentPrivilegeEscalationError,
  AgentHumanImpersonationError,
  SYSTEM_ROLES,
  HUMAN_ONLY_PERMISSIONS,
  MerkleTree,
  AuditIntegrityViolationError,
  RedactionFilter
} from '../../packages/domain/src/index.js';

describe('Identity & RBAC Domain Logic (Unit)', () => {
  describe('TenantLifecycle', () => {
    it('allows valid transitions (active -> suspended -> deprovisioned)', () => {
      expect(TenantLifecycle.transition('active', 'suspended')).toBe('suspended');
      expect(TenantLifecycle.transition('suspended', 'active')).toBe('active');
      expect(TenantLifecycle.transition('active', 'deprovisioned')).toBe('deprovisioned');
      expect(TenantLifecycle.transition('suspended', 'deprovisioned')).toBe('deprovisioned');
    });

    it('rejects invalid transitions from terminal deprovisioned state', () => {
      expect(() => TenantLifecycle.transition('deprovisioned', 'active')).toThrow(
        InvalidTenantTransitionError
      );
      expect(() => TenantLifecycle.transition('deprovisioned', 'suspended')).toThrow(
        InvalidTenantTransitionError
      );
    });

    it('assertAccessible blocks suspended and deprovisioned tenants', () => {
      expect(() => TenantLifecycle.assertAccessible('active', 't-1')).not.toThrow();
      expect(() => TenantLifecycle.assertAccessible('suspended', 't-1')).toThrow(
        /Tenant 't-1' is suspended/
      );
      expect(() => TenantLifecycle.assertAccessible('deprovisioned', 't-1')).toThrow(
        DeprovisionedTenantAccessError
      );
    });
  });

  describe('RBACPolicy & Agent Impersonation Defense', () => {
    it('prevents agent identities from being assigned human-only roles', () => {
      expect(() =>
        RBACPolicy.assertRoleAssignable('agent_identity', 'admin', SYSTEM_ROLES.admin.allowsAgents)
      ).toThrow(AgentPrivilegeEscalationError);

      expect(() =>
        RBACPolicy.assertRoleAssignable(
          'agent_identity',
          'compliance_officer',
          SYSTEM_ROLES.compliance_officer.allowsAgents
        )
      ).toThrow(AgentPrivilegeEscalationError);

      // Allows assigning agent_ingest to agents
      expect(() =>
        RBACPolicy.assertRoleAssignable(
          'agent_identity',
          'agent_ingest',
          SYSTEM_ROLES.agent_ingest.allowsAgents
        )
      ).not.toThrow();

      // Human can be assigned any role
      expect(() =>
        RBACPolicy.assertRoleAssignable('human_user', 'admin', SYSTEM_ROLES.admin.allowsAgents)
      ).not.toThrow();
    });

    it('enforces human-only action guard even if agent has permission in token', () => {
      for (const humanPerm of HUMAN_ONLY_PERMISSIONS) {
        // Agent with granted permission must still be blocked by domain policy
        expect(RBACPolicy.hasPermission('agent_identity', [humanPerm], humanPerm)).toBe(false);

        expect(() => RBACPolicy.assertPermission('agent_identity', [humanPerm], humanPerm)).toThrow(
          AgentHumanImpersonationError
        );

        // Human user with permission is permitted
        expect(RBACPolicy.hasPermission('human_user', [humanPerm], humanPerm)).toBe(true);
      }
    });

    it('allows agents to execute automated least-privilege permissions', () => {
      expect(RBACPolicy.hasPermission('agent_identity', ['claims:submit'], 'claims:submit')).toBe(
        true
      );
      expect(
        RBACPolicy.hasPermission('agent_identity', ['evidence:ingest'], 'evidence:ingest')
      ).toBe(true);
    });
  });

  describe('MerkleTree & Linear Audit Hash Chain', () => {
    it('computes deterministic canonical payload hash regardless of object key order', () => {
      const payload1 = { a: 1, b: 'test', nested: { z: 9, y: 8 } };
      const payload2 = { nested: { y: 8, z: 9 }, b: 'test', a: 1 };

      const hash1 = MerkleTree.hashPayload(payload1);
      const hash2 = MerkleTree.hashPayload(payload2);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('computes Merkle root and detects tampering in linear hash chain', () => {
      const events = [
        {
          id: '1',
          payloadHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          prevEventHash: null
        },
        {
          id: '2',
          payloadHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
          prevEventHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
        },
        {
          id: '3',
          payloadHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
          prevEventHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
        }
      ];

      expect(() => MerkleTree.verifyLinearChain(events)).not.toThrow();

      const root = MerkleTree.computeRoot(events.map((e) => e.payloadHash));
      expect(root).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Simulate tampering: altered prevEventHash on event 3
      const tamperedEvents = [
        events[0]!,
        events[1]!,
        { ...events[2]!, prevEventHash: 'sha256:tampered_prev_hash' }
      ];

      expect(() => MerkleTree.verifyLinearChain(tamperedEvents)).toThrow(
        AuditIntegrityViolationError
      );
    });
  });

  describe('RedactionFilter', () => {
    it('redacts sensitive keys and credential patterns from objects and logs', () => {
      const sensitiveInput = {
        username: 'alice',
        password: 'dummy_plaintext_password_123',
        apiKey: 'dummy_pm_live_1234567890abcdef',
        nested: {
          clientSecret: 'secret_12345',
          token: 'Bearer eyJhbGciOiJIUzI1NiJ9.test',
          normalData: 'visible'
        }
      };

      const sanitized = RedactionFilter.redact(sensitiveInput);

      expect(sanitized.username).toBe('alice');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.nested.clientSecret).toBe('[REDACTED]');
      expect(sanitized.nested.token).toBe('[REDACTED]');
      expect(sanitized.nested.normalData).toBe('visible');
    });
  });
});
