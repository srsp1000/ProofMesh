import crypto from 'node:crypto';
import type {
  CanonicalEventEnvelope,
  OpenTelemetryIngestInput,
  TelemetrySpanReceivedV1
} from '@proofmesh/contracts';
import { createCanonicalEnvelope } from '@proofmesh/contracts';
import type { ProtocolAdapter, AdapterContext } from './adapter.interface.js';

export class OpenTelemetryAdapter implements ProtocolAdapter<
  OpenTelemetryIngestInput,
  TelemetrySpanReceivedV1
> {
  readonly protocolName = 'opentelemetry';

  transform(
    input: OpenTelemetryIngestInput,
    context: AdapterContext
  ): CanonicalEventEnvelope<TelemetrySpanReceivedV1>[] {
    const envelopes: CanonicalEventEnvelope<TelemetrySpanReceivedV1>[] = [];

    for (const resourceSpan of input.resourceSpans) {
      for (const scopeSpan of resourceSpan.scopeSpans) {
        for (const span of scopeSpan.spans) {
          const kind = (
            typeof span.kind === 'string' &&
            ['client', 'server', 'producer', 'consumer', 'internal'].includes(span.kind)
              ? span.kind
              : 'internal'
          ) as 'client' | 'server' | 'producer' | 'consumer' | 'internal';

          const spanPayload: TelemetrySpanReceivedV1 = {
            spanId: span.spanId,
            traceId: span.traceId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind,
            startTimeUnixNano: span.startTimeUnixNano,
            endTimeUnixNano: span.endTimeUnixNano,
            attributes: span.attributes ?? {},
            events: [],
            status: {
              code: span.status?.code ?? 'unset',
              message: span.status?.message
            }
          };

          const envelope = createCanonicalEnvelope<TelemetrySpanReceivedV1>({
            id: crypto.randomUUID(),
            source: `/tenants/${context.tenantId}/integrations/opentelemetry`,
            type: 'io.proofmesh.telemetry.span.received.v1',
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            schemaVersion: '1.0.0',
            sourceIntegration: 'opentelemetry',
            instanceIdentity: 'otel_collector',
            actor: context.actor,
            correlationId: crypto.randomUUID(),
            traceId: span.traceId,
            spanId: span.spanId,
            captureMethod: 'captured',
            contentMode: 'metadata_only',
            idempotencyKey: `otel_${span.traceId}_${span.spanId}`,
            data: spanPayload
          });

          envelopes.push(envelope);
        }
      }
    }

    return envelopes;
  }
}
