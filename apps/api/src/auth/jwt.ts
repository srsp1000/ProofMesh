import { createHmac } from 'node:crypto';
import { EnvelopeSecretManager } from '@proofmesh/db';
import type { AuthTokenClaims } from '@proofmesh/contracts';

export class JwtVerificationError extends Error {
  constructor(message: string) {
    super(`Authentication Failure: ${message}`);
    this.name = 'JwtVerificationError';
  }
}

export class JwtSigner {
  constructor(
    private readonly secret: string,
    private readonly defaultIssuer = 'https://auth.proofmesh.io'
  ) {}

  /**
   * Signs a JWT with HMAC-SHA256 (RFC 7519).
   */
  sign(
    claims: Omit<AuthTokenClaims, 'iss' | 'iat' | 'exp' | 'aud'> & {
      aud?: string | string[];
      expiresInSeconds?: number;
    }
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (claims.expiresInSeconds ?? 3600);

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: AuthTokenClaims = {
      ...claims,
      aud: claims.aud ?? 'proofmesh-api',
      iss: this.defaultIssuer,
      iat: now,
      exp
    };

    const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    const signature = createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Verifies a JWT's signature and expiration, returning verified claims.
   */
  verify(token: string): AuthTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new JwtVerificationError('Malformed JWT structure.');
    }

    const [headerB64, payloadB64, signature] = parts as [string, string, string];

    const expectedSignature = createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    // Constant-time signature verification prevents timing attacks
    if (!EnvelopeSecretManager.verifyConstantTime(signature, expectedSignature)) {
      throw new JwtVerificationError('Invalid token signature.');
    }

    let payload: AuthTokenClaims;
    try {
      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(payloadJson) as AuthTokenClaims;
    } catch {
      throw new JwtVerificationError('Failed to parse token payload.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new JwtVerificationError('Token has expired.');
    }

    return payload;
  }
}
