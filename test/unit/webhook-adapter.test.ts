import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { WebhookAdapter } from '../../apps/api/src/gateway/adapters/webhook.adapter.js';
import { WebhookSignatureVerifier } from '../../packages/domain/src/security/webhook-signature.js';

describe('WebhookAdapter & WebhookSignatureVerifier (Unit)', () => {
  const secret = 'test_secret_for_webhook_adapter_unit_32b';
  const tenantId = crypto.randomUUID();
  const context = {
    tenantId,
    actor: {
      principalId: crypto.randomUUID(),
      principalType: 'service_account' as const
    }
  };

  const adapter = new WebhookAdapter({
    adapterId: 'wh_github_test',
    source: 'github',
    secret,
    maxSkewSeconds: 300
  });

  it('validates a correct HMAC-SHA256 signature and fresh timestamp', () => {
    const payload = {
      eventType: 'io.proofmesh.source.artifact.registered.v1',
      source: 'github.com/proofmesh/repo',
      occurredAt: new Date().toISOString(),
      idempotencyKey: 'idemp-wh-001',
      data: {
        artifactId: crypto.randomUUID(),
        repository: 'proofmesh/repo',
        commitSha: 'a1b2c3d4e5f6'
      }
    };

    const rawBody = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = WebhookSignatureVerifier.sign(secret, rawBody, timestamp);

    const result = adapter.verifyAndTransform(
      {
        signature: `sha256=${signature}`,
        timestamp,
        source: 'github'
      },
      rawBody,
      payload,
      context
    );

    expect(result.success).toBe(true);
    expect(result.envelopes).toHaveLength(1);
    const env = result.envelopes![0]!;
    expect(env.type).toBe('io.proofmesh.source.artifact.registered.v1');
    expect(env.sourceIntegration).toBe('webhook_github');
    expect(env.idempotencyKey).toBe('idemp-wh-001');
  });

  it('rejects tampered payload with INVALID_SIGNATURE', () => {
    const payload = {
      eventType: 'io.proofmesh.source.artifact.registered.v1',
      source: 'github.com/proofmesh/repo',
      data: { commitSha: 'legitimate_commit' }
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = WebhookSignatureVerifier.sign(secret, rawBody, timestamp);

    // Attacker tampers with body
    const tamperedBody = JSON.stringify({
      ...payload,
      data: { commitSha: 'malicious_commit' }
    });

    const result = adapter.verifyAndTransform(
      {
        signature: `sha256=${signature}`,
        timestamp,
        source: 'github'
      },
      tamperedBody,
      JSON.parse(tamperedBody),
      context
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects expired timestamp (replay attack) with EXPIRED_TIMESTAMP', () => {
    const payload = {
      eventType: 'io.proofmesh.source.artifact.registered.v1',
      source: 'github.com/proofmesh/repo',
      data: { commitSha: 'test_commit' }
    };
    const rawBody = JSON.stringify(payload);
    // Timestamp from 10 minutes ago (> 300s skew limit)
    const expiredTimestamp = String(Date.now() - 600 * 1000);
    const signature = WebhookSignatureVerifier.sign(secret, rawBody, expiredTimestamp);

    const result = adapter.verifyAndTransform(
      {
        signature: `sha256=${signature}`,
        timestamp: expiredTimestamp,
        source: 'github'
      },
      rawBody,
      payload,
      context
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('EXPIRED_TIMESTAMP');
    expect(result.error).toContain('Timestamp skew exceeded');
  });

  it('rejects missing signature header with MISSING_SIGNATURE', () => {
    const payload = { eventType: 'test', source: 'test', data: {} };
    const rawBody = JSON.stringify(payload);

    const result = adapter.verifyAndTransform(
      {
        signature: '',
        timestamp: String(Date.now()),
        source: 'github'
      },
      rawBody,
      payload,
      context
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_SIGNATURE');
  });
});
