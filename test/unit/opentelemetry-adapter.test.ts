import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { OpenTelemetryAdapter } from '../../apps/api/src/gateway/adapters/opentelemetry.adapter.js';

describe('OpenTelemetryAdapter (Unit)', () => {
  const tenantId = crypto.randomUUID();
  const context = {
    tenantId,
    actor: {
      principalId: crypto.randomUUID(),
      principalType: 'service_account' as const
    }
  };

  it('normalizes OTLP KeyValue arrays and direct dictionaries identically', () => {
    const rawArray = [
      { key: 'service.name', value: { stringValue: 'claims-service' } },
      { key: 'gen_ai.usage.total_tokens', value: { intValue: 1250 } },
      { key: 'enabled', value: { boolValue: true } }
    ];

    const normalized = OpenTelemetryAdapter.normalizeAttributes(rawArray);
    expect(normalized['service.name']).toBe('claims-service');
    expect(normalized['gen_ai.usage.total_tokens']).toBe(1250);
    expect(normalized['enabled']).toBe(true);
  });

  it('transforms OTLP spans and detects GenAI semantic conventions', () => {
    const adapter = new OpenTelemetryAdapter({
      adapterId: 'otel_test',
      allowContentCapture: false // Metadata-only by default
    });

    const otlpInput = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'credit-agent' } },
              { key: 'deployment.environment', value: { stringValue: 'production' } }
            ]
          },
          scopeSpans: [
            {
              scope: { name: '@opentelemetry/instrumentation-openai', version: '0.40.0' },
              spans: [
                {
                  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
                  spanId: '00f067aa0ba902b7',
                  name: 'chat.completions gpt-4o',
                  kind: 3, // Client
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000002500000000',
                  attributes: [
                    { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                    { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
                    { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                    { key: 'gen_ai.usage.prompt_tokens', value: { intValue: 350 } },
                    { key: 'gen_ai.usage.completion_tokens', value: { intValue: 120 } },
                    { key: 'gen_ai.prompt', value: { stringValue: 'Evaluate loan applicant' } },
                    { key: 'gen_ai.completion', value: { stringValue: 'Applicant approved' } },
                    {
                      key: 'proofmesh.workflow_id',
                      value: { stringValue: 'wf_credit_eval_101' }
                    }
                  ],
                  status: { code: 1, message: 'Success' }
                }
              ]
            }
          ]
        }
      ]
    };

    const envelopes = adapter.transform(otlpInput, context);

    // Expect both TelemetrySpanReceivedV1 and AgentActivityV1 envelopes
    expect(envelopes.length).toBe(2);

    const spanEnv = envelopes.find((e) => e.type === 'io.proofmesh.telemetry.span.received.v1');
    expect(spanEnv).toBeDefined();
    expect(spanEnv?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(spanEnv?.spanId).toBe('00f067aa0ba902b7');
    expect(spanEnv?.contentMode).toBe('metadata_only');
    // Content should be stripped in metadata_only mode
    expect(
      (spanEnv?.data as Record<string, unknown>).attributes as Record<string, unknown>
    ).not.toHaveProperty('gen_ai.prompt');

    const agentEnv = envelopes.find((e) => e.type === 'io.proofmesh.agent.activity.v1');
    expect(agentEnv).toBeDefined();
    expect((agentEnv?.data as Record<string, unknown>).activityType).toBe('prompt_invocation');
    expect((agentEnv?.data as Record<string, unknown>).executionStatus).toBe('completed');
  });

  it('preserves prompt/completion contents only when allowContentCapture is true', () => {
    const adapter = new OpenTelemetryAdapter({
      adapterId: 'otel_optin_test',
      allowContentCapture: true // Explicit opt-in
    });

    const otlpInput = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: '11112222333344445555666677778888',
                  spanId: '8888777766665555',
                  name: 'chat gpt-4',
                  kind: 'client',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000001000000000',
                  attributes: [
                    { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                    { key: 'gen_ai.prompt', value: { stringValue: 'Sensitive text' } },
                    { key: 'gen_ai.completion', value: { stringValue: 'Model reply' } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const envelopes = adapter.transform(otlpInput, context);
    const spanEnv = envelopes[0]!;

    expect(spanEnv.contentMode).toBe('full_content');
    const attrs = (spanEnv.data as Record<string, unknown>).attributes as Record<string, unknown>;
    expect(attrs['gen_ai.prompt']).toBe('Sensitive text');
    expect(attrs['gen_ai.completion']).toBe('Model reply');
  });

  it('assesses instrumentation coverage gaps accurately', () => {
    const span = {
      traceId: 't1',
      spanId: 's1',
      name: 'llm_call',
      startTimeUnixNano: '100',
      endTimeUnixNano: '200'
    };

    // Incomplete GenAI instrumentation (missing vendor system, missing tokens)
    const incompleteAttrs = {
      'gen_ai.request.model': 'claude-3-5-sonnet'
    };

    const assessment = OpenTelemetryAdapter.assessCoverage(span, incompleteAttrs);

    expect(assessment.hasGenAiAttributes).toBe(true);
    expect(assessment.missingAttributes).toContain('gen_ai.system');
    expect(assessment.missingAttributes).toContain('gen_ai.usage.prompt_tokens');
    expect(assessment.coverageScore).toBeLessThan(100);
    expect(assessment.recommendations.length).toBeGreaterThan(0);
  });
});
