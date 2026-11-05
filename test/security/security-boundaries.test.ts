import { describe, it, expect } from 'vitest';
import { loadAndValidateEnv } from '../../apps/api/src/config/env.js';
import { setTenantContext } from '../../packages/db/src/client.js';

describe('Security Boundaries & Guard Tests (Security)', () => {
  it('loadAndValidateEnv throws error when invalid environment config is supplied', () => {
    expect(() =>
      loadAndValidateEnv({
        NODE_ENV: 'invalid_environment' as unknown as 'production',
        PORT: 'not_a_number' as unknown as string
      })
    ).toThrow('[ProofMesh Configuration Failure]');
  });

  it('loadAndValidateEnv accepts valid configurations', () => {
    const config = loadAndValidateEnv({
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'test_secret_with_more_than_16_characters',
      FAIL_POLICY: 'fail_closed',
      LOG_LEVEL: 'info'
    });

    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(4000);
    expect(config.FAIL_POLICY).toBe('fail_closed');
  });

  it('setTenantContext rejects malformed or malicious SQL injection strings as tenantId', async () => {
    const mockClient = {
      query: async () => ({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] })
    } as unknown as Parameters<typeof setTenantContext>[0];

    await expect(setTenantContext(mockClient, "'; DROP TABLE tenants; --")).rejects.toThrow(
      'Invalid tenant ID format'
    );

    await expect(setTenantContext(mockClient, '11111111-invalid-uuid')).rejects.toThrow(
      'Invalid tenant ID format'
    );
  });

  it('setTenantContext accepts valid UUID tenantId', async () => {
    let executedQuery = '';
    const mockClient = {
      query: async (sql: string) => {
        executedQuery = sql;
        return { rows: [], command: '', rowCount: 0, oid: 0, fields: [] };
      }
    } as unknown as Parameters<typeof setTenantContext>[0];

    const validUuid = '11111111-1111-4111-8111-111111111111';
    await setTenantContext(mockClient, validUuid);
    expect(executedQuery).toBe(`SET LOCAL app.current_tenant_id = '${validUuid}';`);
  });
});
