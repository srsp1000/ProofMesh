import { randomUUID } from 'node:crypto';
import type { ProofMeshClientOptions, WorkflowContext } from './types.js';
import { WorkflowContextManager } from './context.js';

export interface TelemetrySpanItem {
  id: string;
  name: string;
  kind?: string;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  status: 'ok' | 'error';
  attributes?: Record<string, unknown>;
  events?: Array<{ name: string; timeUnixNano: number; attributes?: Record<string, unknown> }>;
  workflowContext?: WorkflowContext;
}

export class TelemetryBuffer {
  private readonly buffer: TelemetrySpanItem[] = [];
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly options: ProofMeshClientOptions;
  private isRunning = true;

  constructor(options: ProofMeshClientOptions, maxBatchSize = 50, flushIntervalMs = 2000) {
    this.options = options;
    this.maxBatchSize = maxBatchSize;
    this.flushIntervalMs = flushIntervalMs;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);

    // Unref timer so it doesn't prevent Node process exit
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  /**
   * Records a completed span to the in-memory telemetry buffer.
   */
  public recordSpan(
    span: Omit<TelemetrySpanItem, 'id' | 'workflowContext'> & { id?: string }
  ): void {
    if (!this.isRunning) return;

    const activeContext = WorkflowContextManager.getWorkflowContext();
    const item: TelemetrySpanItem = {
      id: span.id ?? randomUUID(),
      name: span.name,
      kind: span.kind ?? 'INTERNAL',
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.endTimeUnixNano,
      status: span.status,
      attributes: span.attributes ?? {},
      events: span.events ?? [],
      workflowContext: activeContext
    };

    this.buffer.push(item);

    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /**
   * Flushes currently buffered telemetry spans to the Gateway.
   * Telemetry uses fail-open semantics: errors do not bubble up to crash the application.
   */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const itemsToSend = this.buffer.splice(0, this.buffer.length);
    const tenantId = this.options.tenantId;

    try {
      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'proofmesh-sdk' } },
                { key: 'telemetry.sdk.language', value: { stringValue: 'typescript' } }
              ]
            },
            scopeSpans: [
              {
                scope: { name: 'proofmesh.sdk.telemetry', version: '1.0.0' },
                spans: itemsToSend.map((s) => ({
                  traceId: s.workflowContext?.traceId ?? randomUUID().replace(/-/g, ''),
                  spanId:
                    s.workflowContext?.spanId ?? randomUUID().replace(/-/g, '').substring(0, 16),
                  parentSpanId: s.workflowContext?.parentSpanId,
                  name: s.name,
                  kind: 1, // INTERNAL
                  startTimeUnixNano: String(s.startTimeUnixNano),
                  endTimeUnixNano: String(s.endTimeUnixNano),
                  attributes: [
                    {
                      key: 'proofmesh.correlation_id',
                      value: { stringValue: s.workflowContext?.correlationId ?? '' }
                    },
                    {
                      key: 'proofmesh.workflow_id',
                      value: { stringValue: s.workflowContext?.workflowId ?? '' }
                    },
                    ...Object.entries(s.attributes ?? {}).map(([k, v]) => ({
                      key: k,
                      value: { stringValue: String(v) }
                    }))
                  ],
                  status: { code: s.status === 'ok' ? 1 : 2 }
                }))
              }
            ]
          }
        ]
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`
      };
      if (tenantId) {
        headers['X-Tenant-ID'] = tenantId;
      }

      const res = await fetch(`${this.options.baseUrl}/v1/adapters/opentelemetry/v1/traces`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        this.options.logger?.warn?.(`Telemetry flush failed with status HTTP ${res.status}`);
      }
    } catch (err) {
      this.options.logger?.warn?.(
        'Failed to send telemetry batch to ProofMesh gateway (fail-open)',
        err
      );
    }
  }

  /**
   * Stops the periodic flush timer and performs a final flush.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
