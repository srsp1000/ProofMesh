import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash
} from 'node:crypto';

export interface SecretManager {
  storeSecret(secretValue: string): Promise<string>;
  getSecret(credentialRef: string): Promise<string>;
  rotateSecret(credentialRef: string, newSecretValue: string): Promise<string>;
}

export class SecretDecryptionError extends Error {
  constructor(
    message = 'Failed to decrypt secret payload: Invalid authentication tag or corrupted ciphertext.'
  ) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}

/**
 * EnvelopeSecretManager implements authenticated AES-256-GCM envelope encryption.
 * Secrets are encrypted with unique 96-bit IVs and verified with 128-bit authentication tags.
 * Plaintext secrets are never stored in database columns or emitted in logs.
 */
export class EnvelopeSecretManager implements SecretManager {
  private key: Buffer;

  constructor(masterKey?: string | Buffer) {
    if (!masterKey) {
      // Derive a deterministic 256-bit key if not provided directly
      this.key = createHash('sha256').update('proofmesh-master-key-seed-default-local').digest();
    } else if (Buffer.isBuffer(masterKey)) {
      if (masterKey.length !== 32) {
        throw new Error('Master encryption key buffer must be exactly 32 bytes (256 bits).');
      }
      this.key = masterKey;
    } else {
      // Hash string seed to guarantee exactly 32 bytes
      this.key = createHash('sha256').update(masterKey, 'utf8').digest();
    }
  }

  /**
   * Encrypts plaintext secret and returns an opaque credential reference string.
   * Format: enc://v1/<iv_hex>:<authTag_hex>:<ciphertext_hex>
   */
  async storeSecret(secretValue: string): Promise<string> {
    const iv = randomBytes(12); // Standard 96-bit IV for AES-GCM
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);

    let ciphertext = cipher.update(secretValue, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `enc://v1/${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
  }

  /**
   * Decrypts an opaque credential reference string and returns the plaintext secret.
   * Throws SecretDecryptionError if the ciphertext or authentication tag is tampered with.
   */
  async getSecret(credentialRef: string): Promise<string> {
    if (!credentialRef.startsWith('enc://v1/')) {
      throw new Error(`Unsupported secret reference protocol: ${credentialRef.slice(0, 15)}...`);
    }

    const payload = credentialRef.slice('enc://v1/'.length);
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted secret reference format.');
    }

    const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

    try {
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);

      let plaintext = decipher.update(ciphertextHex, 'hex', 'utf8');
      plaintext += decipher.final('utf8');

      return plaintext;
    } catch {
      throw new SecretDecryptionError();
    }
  }

  /**
   * Rotates a secret by encrypting the new value under a freshly generated IV.
   */
  async rotateSecret(_oldCredentialRef: string, newSecretValue: string): Promise<string> {
    return this.storeSecret(newSecretValue);
  }

  /**
   * Constant-time string/token comparison to prevent timing side-channel attacks.
   */
  static verifyConstantTime(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');

    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
