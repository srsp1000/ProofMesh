import crypto from 'node:crypto';
import type {
  CanonicalEventEnvelope,
  TelemetrySpanReceivedV1,
  AgentActivityV1,
  OTLPTracesPayload,
  OTLPSpan,
  InstrumentationCoverageGapReport
} from '@proofmesh/contracts';
import { OTLPTracesPayloadSchema, createCanonicalEnvelope } from '@proofmesh/contracts';
import type { ProtocolAdapter, AdapterContext } from './adapter.interface.js';
import { ensureUuid } from './adapter.interface.js';
import { AdapterHealthService } from './adapter-health.service.js';

export interface OpenTelemetryAdapterOptions {
  adapterId?: string;
  allowContentCapture?: boolean;
}

export class OpenTelemetryAdapter implements ProtocolAdapter<
  OTLPTracesPayload,
  TelemetrySpanReceivedV1 | AgentActivityV1
> {
  readonly protocolName = 'opentelemetry';
  private readonly adapterId: string;
  private readonly healthService = AdapterHealthService.getInstance();
  private readonly allowContentCapture: boolean;

  constructor(options: OpenTelemetryAdapterOptions = {}) {
    this.adapterId = options.adapterId ?? 'otel_default';
    this.allowContentCapture = options.allowContentCapture ?? false;
    this.healthService.registerAdapter(this.adapterId, 'opentelemetry', 'connected');
  }

  /**
   * Helper to normalize raw OTLP attributes (both { key, value: { stringValue } } and plain dicts).
   */
  public static normalizeAttributes(
    raw: unknown[] | Record<string, unknown> | undefined
  ): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...raw };
    }

    const result: Record<string, unknown> = {};
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'object' && item !== null && 'key' in item && 'value' in item) {
          const entry = item as { key: string; value: unknown };
          result[entry.key] = OpenTelemetryAdapter.extractAnyValue(entry.value);
        }
      }
    }
    return result;
  }

  public static extractAnyValue(val: unknown): unknown {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;
    const obj = val as Record<string, unknown>;
    if ('stringValue' in obj) return obj.stringValue;
    if ('boolValue' in obj) return obj.boolValue;
    if ('intValue' in obj) {
      return typeof obj.intValue === 'string' ? parseInt(obj.intValue, 10) : obj.intValue;
    }
    if ('doubleValue' in obj) return obj.doubleValue;
    if ('arrayValue' in obj && typeof obj.arrayValue === 'object' && obj.arrayValue !== null) {
      const arr = (obj.arrayValue as { values?: unknown[] }).values;
      return Array.isArray(arr) ? arr.map(OpenTelemetryAdapter.extractAnyValue) : [];
    }
    if ('kvlistValue' in obj && typeof obj.kvlistValue === 'object' && obj.kvlistValue !== null) {
      const kvs = (obj.kvlistValue as { values?: Array<{ key: string; value: unknown }> }).values;
      if (Array.isArray(kvs)) {
        const out: Record<string, unknown> = {};
        for (const kv of kvs) {
          out[kv.key] = OpenTelemetryAdapter.extractAnyValue(kv.value);
        }
        return out;
      }
    }
    return val;
  }

  /**
   * Analyzes an OTLP Span for GenAI semantic conventions and instrumentation completeness.
   */
  public static assessCoverage(
    span: OTLPSpan,
    attrs: Record<string, unknown>
  ): InstrumentationCoverageGapReport {
    const missingAttributes: string[] = [];
    const unsupportedInstrumentation: string[] = [];
    const recommendations: string[] = [];

    const isGenAi =
      Boolean(attrs['gen_ai.system']) ||
      Boolean(attrs['gen_ai.operation.name']) ||
      Boolean(attrs['gen_ai.request.model']) ||
      Boolean(attrs['gen_ai.tool.name']);

    const hasCorrelation =
      Boolean(attrs['proofmesh.workflow_id']) ||
      Boolean(attrs['proofmesh.decision_id']) ||
      Boolean(attrs['proofmesh.claim_id']);

    if (isGenAi) {
      if (!attrs['gen_ai.system']) {
        missingAttributes.push('gen_ai.system');
        recommendations.push(
          'Provide gen_ai.system (e.g. openai, anthropic, langchain) for model vendor classification'
        );
      }
      if (!attrs['gen_ai.request.model'] && !attrs['gen_ai.response.model']) {
        missingAttributes.push('gen_ai.request.model');
        recommendations.push('Specify the AI model identifier in span attributes');
      }
      if (
        attrs['gen_ai.usage.prompt_tokens'] === undefined &&
        attrs['gen_ai.usage.completion_tokens'] === undefined
      ) {
        missingAttributes.push('gen_ai.usage.prompt_tokens');
        recommendations.push('Capture token consumption metrics for cost and audit telemetry');
      }
    }

    if (!span.parentSpanId && span.name !== 'root') {
      recommendations.push(
        'Span lacks parentSpanId; verify distributed trace context propagation (traceparent header)'
      );
    }

    const penalty = missingAttributes.length * 15;
    const score = isGenAi ? Math.max(20, 100 - penalty) : 70;

    return {
      spanId: span.spanId,
      traceId: span.traceId,
      spanName: span.name,
      hasGenAiAttributes: isGenAi,
      hasCorrelationAttributes: hasCorrelation,
      missingAttributes,
      unsupportedInstrumentation,
      coverageScore: score,
      recommendations
    };
  }

  /**
   * Implements ProtocolAdapter transform interface.
   * Maps OTLP spans to canonical telemetry and agent activity events without inferring claim dependencies.
   */
  public transform(
    input: OTLPTracesPayload,
    context: AdapterContext
  ): CanonicalEventEnvelope<TelemetrySpanReceivedV1 | AgentActivityV1>[] {
    const parseResult = OTLPTracesPayloadSchema.safeParse(input);
    if (!parseResult.success) {
      this.healthService.recordSchemaIncompatibility(this.adapterId);
      return [];
    }

    const envelopes: CanonicalEventEnvelope<TelemetrySpanReceivedV1 | AgentActivityV1>[] = [];
    const shouldCaptureContent = this.allowContentCapture;

    const actorPrincipalId = ensureUuid(
      context.actor?.principalId,
      `otel_actor:${context.tenantId}:${this.adapterId}`
    );
    const validatedActor = {
      principalId: actorPrincipalId,
      principalType: context.actor?.principalType ?? 'service_account'
    };

    for (const resourceSpan of parseResult.data.resourceSpans) {
      const resourceAttrs = OpenTelemetryAdapter.normalizeAttributes(
        resourceSpan.resource?.attributes
      );

      for (const scopeSpan of resourceSpan.scopeSpans) {
        for (const span of scopeSpan.spans) {
          const spanAttrs = OpenTelemetryAdapter.normalizeAttributes(span.attributes);
          const allAttrs: Record<string, unknown> = {
            ...resourceAttrs,
            ...spanAttrs
          };

          this.healthService.recordEventReceived(this.adapterId);

          // 1. Explicit Trace Correlation extraction (NO CLAIM INFERENCE)
          const workflowId =
            typeof allAttrs['proofmesh.workflow_id'] === 'string'
              ? (allAttrs['proofmesh.workflow_id'] as string)
              : undefined;
          const decisionId =
            typeof allAttrs['proofmesh.decision_id'] === 'string'
              ? (allAttrs['proofmesh.decision_id'] as string)
              : undefined;

          // Normalize span kind
          let kindStr = 'internal';
          if (typeof span.kind === 'string') {
            kindStr = span.kind.toLowerCase();
          } else if (typeof span.kind === 'number') {
            const kindMap: Record<number, string> = {
              1: 'internal',
              2: 'server',
              3: 'client',
              4: 'producer',
              5: 'consumer'
            };
            kindStr = kindMap[span.kind] ?? 'internal';
          }

          // Privacy by Default: strip sensitive prompts / completions unless opted in
          const sanitizedAttributes: Record<string, unknown> = { ...allAttrs };
          if (!shouldCaptureContent) {
            delete sanitizedAttributes['gen_ai.prompt'];
            delete sanitizedAttributes['gen_ai.completion'];
            delete sanitizedAttributes['gen_ai.tool.input'];
            delete sanitizedAttributes['gen_ai.tool.output'];
          }

          const spanPayload: TelemetrySpanReceivedV1 = {
            spanId: span.spanId,
            traceId: span.traceId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: kindStr as 'client' | 'server' | 'producer' | 'consumer' | 'internal',
            startTimeUnixNano: span.startTimeUnixNano,
            endTimeUnixNano: span.endTimeUnixNano,
            attributes: sanitizedAttributes,
            events: (span.events ?? []).map((e) => ({
              timeUnixNano: e.timeUnixNano,
              name: e.name,
              attributes: OpenTelemetryAdapter.normalizeAttributes(e.attributes)
            })),
            status: {
              code:
                span.status?.code === 2 ||
                span.status?.code === 'error' ||
                span.status?.code === 'ERROR'
                  ? 'error'
                  : span.status?.code === 1 ||
                      span.status?.code === 'ok' ||
                      span.status?.code === 'OK'
                    ? 'ok'
                    : 'unset',
              message: span.status?.message
            }
          };

          // 2. Base Canonical Telemetry Span Envelope
          const spanEnvelope = createCanonicalEnvelope<TelemetrySpanReceivedV1>({
            id: crypto.randomUUID(),
            source: `/tenants/${context.tenantId}/integrations/opentelemetry`,
            type: 'io.proofmesh.telemetry.span.received.v1',
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            schemaVersion: '1.0.0',
            sourceIntegration: 'opentelemetry',
            instanceIdentity: this.adapterId,
            actor: validatedActor,
            correlationId: crypto.randomUUID(),
            causationId:
              decisionId &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decisionId)
                ? decisionId
                : undefined,
            traceId: span.traceId,
            spanId: span.spanId,
            workflowId,
            captureMethod: 'captured',
            contentMode: shouldCaptureContent ? 'full_content' : 'metadata_only',
            idempotencyKey: `otel_${span.traceId}_${span.spanId}`,
            data: spanPayload
          });

          envelopes.push(spanEnvelope);

          // 3. If GenAI / Agent invocation semantic conventions are detected, map AgentActivityV1
          const isAgentOrTool =
            Boolean(allAttrs['gen_ai.system']) ||
            Boolean(allAttrs['gen_ai.operation.name']) ||
            Boolean(allAttrs['gen_ai.tool.name']) ||
            Boolean(allAttrs['gen_ai.agent.id']);

          if (isAgentOrTool) {
            const activityType:
              | 'tool_call'
              | 'prompt_invocation'
              | 'planning'
              | 'subagent_spawn'
              | 'state_transition' = allAttrs['gen_ai.tool.name']
              ? 'tool_call'
              : span.name.includes('handoff') || span.name.includes('spawn')
                ? 'subagent_spawn'
                : 'prompt_invocation';

            const startNano = Number(span.startTimeUnixNano);
            const endNano = Number(span.endTimeUnixNano);
            const durationMs =
              !isNaN(startNano) && !isNaN(endNano) && endNano >= startNano
                ? Math.round((endNano - startNano) / 1_000_000)
                : undefined;

            const agentPayload: AgentActivityV1 = {
              activityId: crypto.randomUUID(),
              agentId:
                typeof allAttrs['gen_ai.agent.id'] === 'string'
                  ? (allAttrs['gen_ai.agent.id'] as string)
                  : `agent_${context.actor.principalId}`,
              agentRole:
                typeof allAttrs['gen_ai.agent.name'] === 'string'
                  ? (allAttrs['gen_ai.agent.name'] as string)
                  : 'ai_assistant',
              activityType,
              toolName:
                typeof allAttrs['gen_ai.tool.name'] === 'string'
                  ? (allAttrs['gen_ai.tool.name'] as string)
                  : undefined,
              toolParameters:
                shouldCaptureContent && typeof allAttrs['gen_ai.tool.input'] === 'object'
                  ? (allAttrs['gen_ai.tool.input'] as Record<string, unknown>)
                  : undefined,
              executionStatus:
                span.status?.code === 'error' || span.status?.code === 2 ? 'failed' : 'completed',
              durationMs,
              errorDetails: span.status?.message
            };

            const agentEnvelope = createCanonicalEnvelope<AgentActivityV1>({
              id: crypto.randomUUID(),
              source: `/tenants/${context.tenantId}/integrations/opentelemetry/agents`,
              type: 'io.proofmesh.agent.activity.v1',
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              projectId: context.projectId,
              schemaVersion: '1.0.0',
              sourceIntegration: 'opentelemetry',
              instanceIdentity: this.adapterId,
              actor: validatedActor,
              correlationId: crypto.randomUUID(),
              traceId: span.traceId,
              spanId: span.spanId,
              workflowId,
              captureMethod: 'captured',
              contentMode: shouldCaptureContent ? 'full_content' : 'metadata_only',
              idempotencyKey: `otel_agent_${span.traceId}_${span.spanId}`,
              data: agentPayload
            });

            envelopes.push(agentEnvelope);
          }
        }
      }
    }

    return envelopes;
  }
}
