import { describe, it, expect } from 'vitest';
import {
  EnvelopeSecretManager,
  SecretDecryptionError
} from '../../packages/db/src/secrets/secret-manager.js';

describe('EnvelopeSecretManager & Cryptographic Primitives (Unit)', () => {
  const secretManager = new EnvelopeSecretManager('test-master-key-seed-32-chars-long');

  it('encrypts secret into opaque reference format and decrypts cleanly', async () => {
    const rawSecret = 'postgresql://user:super_secret_pw@db.internal:5432/claims';
    const ref = await secretManager.storeSecret(rawSecret);

    expect(ref.startsWith('enc://v1/')).toBe(true);
    expect(ref).not.toContain(rawSecret); // Zero plaintext leakage in reference

    const decrypted = await secretManager.getSecret(ref);
    expect(decrypted).toBe(rawSecret);
  });

  it('detects tampering and rejects decryption with SecretDecryptionError', async () => {
    const rawSecret = 'api_key_abc_12345';
    const ref = await secretManager.storeSecret(rawSecret);

    // Tamper with the ciphertext (change last character)
    const lastChar = ref[ref.length - 1];
    const replacement = lastChar === 'a' ? 'b' : 'a';
    const tamperedRef = ref.slice(0, -1) + replacement;

    await expect(secretManager.getSecret(tamperedRef)).rejects.toThrow(SecretDecryptionError);
  });

  it('rotates secret into a fresh IV and reference', async () => {
    const initialSecret = 'old_secret_1';
    const initialRef = await secretManager.storeSecret(initialSecret);

    const rotatedSecret = 'new_secret_2';
    const newRef = await secretManager.rotateSecret(initialRef, rotatedSecret);

    expect(newRef).not.toBe(initialRef);

    const decrypted = await secretManager.getSecret(newRef);
    expect(decrypted).toBe(rotatedSecret);
  });

  it('constant-time comparison verifies strings and mitigates timing attacks', () => {
    expect(EnvelopeSecretManager.verifyConstantTime('pm_live_token123', 'pm_live_token123')).toBe(
      true
    );
    expect(EnvelopeSecretManager.verifyConstantTime('pm_live_token123', 'pm_live_token456')).toBe(
      false
    );
    expect(EnvelopeSecretManager.verifyConstantTime('pm_live_short', 'pm_live_longer_token')).toBe(
      false
    );
  });
});
