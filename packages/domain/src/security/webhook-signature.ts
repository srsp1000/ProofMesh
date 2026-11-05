import crypto from 'node:crypto';

export interface WebhookVerificationOptions {
  secret: string;
  signature: string;
  rawPayload: string | Buffer;
  timestampHeader?: string;
  maxSkewSeconds?: number;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

export class WebhookSignatureVerifier {
  /**
   * Verifies an HMAC-SHA256 webhook signature and timestamp freshness.
   * Protects against payload tampering and replay attacks.
   */
  public static verify(options: WebhookVerificationOptions): WebhookVerificationResult {
    const { secret, signature, rawPayload, timestampHeader, maxSkewSeconds = 300 } = options;

    if (!signature) {
      return { valid: false, reason: 'Missing signature header' };
    }

    if (!secret) {
      return { valid: false, reason: 'Missing webhook verification secret' };
    }

    // 1. Timestamp Freshness Check (Replay Protection)
    if (timestampHeader) {
      const timestampMs = this.parseTimestamp(timestampHeader);
      if (isNaN(timestampMs)) {
        return { valid: false, reason: 'Invalid timestamp header format' };
      }

      const now = Date.now();
      const skewMs = Math.abs(now - timestampMs);
      const maxSkewMs = maxSkewSeconds * 1000;

      if (skewMs > maxSkewMs) {
        return {
          valid: false,
          reason: `Timestamp skew exceeded: request timestamp (${new Date(
            timestampMs
          ).toISOString()}) is outside the ${maxSkewSeconds}s tolerance window`
        };
      }
    }

    // 2. Format signature normalization (strip 'sha256=' prefix or parse v1= scheme)
    let normalizedExpectedSig = signature.trim();
    if (normalizedExpectedSig.startsWith('sha256=')) {
      normalizedExpectedSig = normalizedExpectedSig.slice(7);
    } else if (normalizedExpectedSig.includes('v1=')) {
      const match = /v1=([0-9a-f]+)/i.exec(normalizedExpectedSig);
      if (match && match[1]) {
        normalizedExpectedSig = match[1];
      }
    }

    // 3. Compute expected HMAC-SHA256
    const payloadBuffer = Buffer.isBuffer(rawPayload)
      ? rawPayload
      : Buffer.from(rawPayload, 'utf8');

    // If timestampHeader is present, first try timestamp-prefixed HMAC (${timestamp}.${payload})
    const boundHmac = crypto
      .createHmac('sha256', secret)
      .update(
        timestampHeader
          ? Buffer.concat([Buffer.from(`${timestampHeader}.`, 'utf8'), payloadBuffer])
          : payloadBuffer
      )
      .digest('hex');

    // 4. Constant-Time Comparison
    try {
      const expectedBuffer = Buffer.from(normalizedExpectedSig, 'hex');
      const boundBuffer = Buffer.from(boundHmac, 'hex');

      if (
        expectedBuffer.length === boundBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, boundBuffer)
      ) {
        return { valid: true };
      }

      // If timestamp-prefixed comparison failed and timestampHeader was provided,
      // fallback to checking direct payload HMAC (e.g. GitHub standard with separate timestamp)
      if (timestampHeader) {
        const directHmac = crypto.createHmac('sha256', secret).update(payloadBuffer).digest('hex');
        const directBuffer = Buffer.from(directHmac, 'hex');

        if (
          expectedBuffer.length === directBuffer.length &&
          crypto.timingSafeEqual(expectedBuffer, directBuffer)
        ) {
          return { valid: true };
        }
      }

      if (expectedBuffer.length !== boundBuffer.length) {
        return { valid: false, reason: 'Signature length mismatch' };
      }

      return { valid: false, reason: 'Invalid signature digest' };
    } catch {
      return { valid: false, reason: 'Malformed signature encoding' };
    }
  }

  /**
   * Helper to parse timestamps in either ISO 8601 string or Unix epoch (seconds/milliseconds).
   */
  public static parseTimestamp(header: string): number {
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      // If seconds (10 digits), convert to ms
      return num < 10000000000 ? num * 1000 : num;
    }
    return Date.parse(trimmed);
  }

  /**
   * Generates a valid HMAC-SHA256 signature for test fixtures and outbound webhooks.
   */
  public static sign(secret: string, payload: string | Buffer, timestamp?: string): string {
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    let hmacPayload = payloadBuffer;
    if (timestamp) {
      hmacPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), payloadBuffer]);
    }
    return crypto.createHmac('sha256', secret).update(hmacPayload).digest('hex');
  }
}
