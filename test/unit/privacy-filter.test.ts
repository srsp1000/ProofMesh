import { describe, it, expect } from 'vitest';
import { PrivacyFilterService } from '../../packages/domain/src/gateway/privacy-filter.js';

describe('PrivacyFilterService (Unit)', () => {
  it('defaults to metadata-only capture, replacing raw content with byte size and hash', () => {
    const rawPayload = {
      messageId: 'msg-01',
      content: 'This is a sensitive customer prompt with personal financial details.',
      tokenCount: 12
    };

    const result = PrivacyFilterService.filter(rawPayload, { contentMode: 'metadata_only' });

    expect(result.contentMode).toBe('metadata_only');
    expect(result.wasRedacted).toBe(true);
    expect(result.sanitizedData.content).toContain('[METADATA_ONLY:');
    expect(result.sanitizedData.content).toContain('sha256:');
    expect(result.sanitizedData.content).not.toContain('financial details');
    expect(result.sanitizedData.tokenCount).toBe(12);
  });

  it('scrubs bearer tokens and API keys under redacted mode', () => {
    const rawPayload = {
      prompt:
        'Here is my OpenAI key: sk-dummy_test_secret_1234567890 and token Bearer mysecrettoken123',
      agentRole: 'assistant'
    };

    const result = PrivacyFilterService.filter(rawPayload, { contentMode: 'redacted' });

    expect(result.sanitizedData.prompt).toContain('sk-[REDACTED]');
    expect(result.sanitizedData.prompt).toContain('Bearer [REDACTED_TOKEN]');
    expect(result.sanitizedData.prompt).not.toContain('dummy_test_secret');

    expect(result.sanitizedData.prompt).not.toContain('mysecrettoken123');
  });

  it('enforces field allowlists by stripping unlisted fields', () => {
    const rawPayload = {
      allowedField1: 'keep this',
      allowedField2: 'keep this too',
      unauthorizedSecretField: 'strip this immediately',
      extraInternalData: 42
    };

    const result = PrivacyFilterService.filter(rawPayload, {
      contentMode: 'full_content',
      allowedFields: ['allowedField1', 'allowedField2']
    });

    expect(result.sanitizedData.allowedField1).toBe('keep this');
    expect(result.sanitizedData.allowedField2).toBe('keep this too');
    expect(
      (result.sanitizedData as Record<string, unknown>).unauthorizedSecretField
    ).toBeUndefined();
    expect((result.sanitizedData as Record<string, unknown>).extraInternalData).toBeUndefined();
  });

  it('truncates content exceeding maxContentLength', () => {
    const longStatement = 'A'.repeat(500);
    const rawPayload = {
      statement: longStatement
    };

    const result = PrivacyFilterService.filter(rawPayload, {
      contentMode: 'full_content',
      maxContentLength: 100
    });

    expect(result.wasTruncated).toBe(true);
    expect(result.sanitizedData.statement.length).toBeLessThan(150);
    expect(result.sanitizedData.statement).toContain('... [TRUNCATED]');
  });

  it('stamps data classification correctly', () => {
    const rawPayload = { key: 'val' };
    const result = PrivacyFilterService.filter(rawPayload, {
      dataClassification: 'restricted'
    });

    expect(result.dataClassification).toBe('restricted');
  });
});
