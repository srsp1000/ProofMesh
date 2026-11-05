export class RedactionFilter {
  private static readonly SENSITIVE_KEY_PATTERNS = [
    /pass(word)?/i,
    /secret/i,
    /token/i,
    /api[_-]?key/i,
    /auth(orization)?/i,
    /private[_-]?key/i,
    /credential/i,
    /jwt/i
  ];

  private static readonly SENSITIVE_VALUE_PATTERNS: {
    name: string;
    regex: RegExp;
    mask: string;
  }[] = [
    {
      name: 'Bearer Token',
      regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
      mask: 'Bearer [REDACTED_TOKEN]'
    },
    { name: 'ProofMesh Live Key', regex: /pm_live_[a-zA-Z0-9]{20,}/g, mask: 'pm_live_[REDACTED]' },
    { name: 'Generic API Key', regex: /sk-[a-zA-Z0-9]{20,}/g, mask: 'sk-[REDACTED]' },
    {
      name: 'Private Key Block',
      regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----[^-]+-----END [A-Z ]+PRIVATE KEY-----/gs,
      mask: '[REDACTED_PRIVATE_KEY]'
    }
  ];

  /**
   * Recursively sanitizes an object or string, redacting sensitive keys and values.
   */
  static redact<T>(data: T): T {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.redactString(data) as unknown as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redact(item)) as unknown as T;
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(data)) {
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.redact(val);
        }
      }
      return sanitized as unknown as T;
    }

    return data;
  }

  private static isSensitiveKey(key: string): boolean {
    return this.SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
  }

  private static redactString(str: string): string {
    let result = str;
    for (const pattern of this.SENSITIVE_VALUE_PATTERNS) {
      result = result.replace(pattern.regex, pattern.mask);
    }
    return result;
  }
}
