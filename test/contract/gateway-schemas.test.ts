import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  CanonicalEventEnvelopeSchema,
  createCanonicalEnvelope,
  IngestEventInputSchema,
  IngestBatchInputSchema,
  OpenTelemetryIngestInputSchema,
  FrameworkCallbackInputSchema,
  GatewayHealthResponseSchema
} from '../../packages/contracts/src/index.js';

describe('Gateway Contracts & Canonical Envelope (Contract)', () => {
  const tenantId = crypto.randomUUID();
  const principalId = crypto.randomUUID();

  it('validates a complete CanonicalEventEnvelope with governance metadata', () => {
    const envelope = createCanonicalEnvelope({
      id: crypto.randomUUID(),
      source: `/tenants/${tenantId}/gateways/default`,
      type: 'io.proofmesh.claim.registered.v1',
      tenantId,
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      schemaVersion: '1.0.0',
      sourceIntegration: 'langchain',
      instanceIdentity: 'agent_worker_1',
      actor: { principalId, principalType: 'agent_identity' },
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      traceId: 'trace-12345',
      spanId: 'span-67890',
      captureMethod: 'captured',
      contentMode: 'metadata_only',
      idempotencyKey: 'idemp-contract-01',
      data: { statement: 'Test statement' }
    });

    const parsed = CanonicalEventEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.specversion).toBe('1.0');
      expect(parsed.data.actor.principalType).toBe('agent_identity');
      expect(parsed.data.captureMethod).toBe('captured');
      expect(parsed.data.contentMode).toBe('metadata_only');
    }
  });

  it('rejects an envelope when actor or tenantId is missing or invalid', () => {
    const invalidEnvelope = {
      specversion: '1.0',
      id: crypto.randomUUID(),
      source: '/test',
      type: 'io.proofmesh.claim.registered.v1',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      // tenantId missing
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'key',
      data: {}
    };

    const parsed = CanonicalEventEnvelopeSchema.safeParse(invalidEnvelope);
    expect(parsed.success).toBe(false);
  });

  it('validates IngestEventInputSchema and IngestBatchInputSchema', () => {
    const singleInput = IngestEventInputSchema.parse({
      type: 'io.proofmesh.claim.registered.v1',
      idempotencyKey: 'idemp-batch-01',
      data: { statement: 'Valid claim' }
    });
    expect(singleInput.type).toBe('io.proofmesh.claim.registered.v1');

    const batchInput = IngestBatchInputSchema.parse({
      events: [singleInput]
    });
    expect(batchInput.events.length).toBe(1);

    // Reject empty batch
    const emptyBatch = IngestBatchInputSchema.safeParse({ events: [] });
    expect(emptyBatch.success).toBe(false);
  });

  it('validates OpenTelemetryIngestInputSchema and FrameworkCallbackInputSchema', () => {
    const otelPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'chat',
                  kind: 1, // 'internal'
                  startTimeUnixNano: '1000',
                  endTimeUnixNano: '2000'
                }
              ]
            }
          ]
        }
      ]
    };
    const parsedOtel = OpenTelemetryIngestInputSchema.parse(otelPayload);
    expect(parsedOtel.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.name).toBe('chat');

    const callbackPayload = {
      framework: 'langchain',
      eventType: 'on_tool_start',
      idempotencyKey: 'cb-001',
      agentId: 'agent-1',
      payload: { toolName: 'calculator' }
    };
    const parsedCb = FrameworkCallbackInputSchema.parse(callbackPayload);
    expect(parsedCb.framework).toBe('langchain');
  });

  it('validates GatewayHealthResponseSchema', () => {
    const health = GatewayHealthResponseSchema.parse({
      status: 'healthy',
      queueLag: {
        highPriorityPending: 2,
        bulkTelemetryPending: 10,
        oldestUnprocessedSec: 1.5
      },
      circuitBreaker: {
        status: 'closed',
        failureCount: 0,
        lastFailure: null
      },
      connectors: [
        {
          connectorId: 'otel-1',
          type: 'otel',
          status: 'healthy',
          latencyMs: 12,
          lastCheck: new Date().toISOString()
        }
      ],
      uptimeSec: 3600,
      timestamp: new Date().toISOString()
    });
    expect(health.status).toBe('healthy');
  });
});
