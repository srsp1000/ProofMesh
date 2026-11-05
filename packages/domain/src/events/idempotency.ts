import { createHash } from 'node:crypto';

export class IdempotencyService {
  /**
   * Generates a deterministic idempotency key if one is not provided by the client.
   */
  public static computeKey(
    tenantId: string,
    eventType: string,
    source: string,
    payload: unknown
  ): string {
    const canonical = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hash = createHash('sha256')
      .update(`${tenantId}:${eventType}:${source}:${canonical}`)
      .digest('hex');
    return `idemp_${hash.substring(0, 32)}`;
  }

  /**
   * Validates idempotency key format.
   */
  public static isValidKey(key: string): boolean {
    return typeof key === 'string' && key.trim().length >= 4 && key.trim().length <= 128;
  }
}
