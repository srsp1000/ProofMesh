import { z } from 'zod';
import { CaptureMethodEnum, ContentModeEnum } from '../events/canonical-envelope.schema.js';

export const IngestEventInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.string().min(1),
  schemaVersion: z.string().optional(),
  sourceIntegration: z.string().optional(),
  instanceIdentity: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  workflowId: z.string().optional(),
  captureMethod: CaptureMethodEnum.optional(),
  contentMode: ContentModeEnum.optional(),
  idempotencyKey: z.string().min(1),
  payloadRef: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  data: z.record(z.unknown())
});
export type IngestEventInput = z.infer<typeof IngestEventInputSchema>;

export const IngestBatchInputSchema = z.object({
  events: z.array(IngestEventInputSchema).min(1).max(100)
});
export type IngestBatchInput = z.infer<typeof IngestBatchInputSchema>;

export const PriorityLaneEnum = z.enum(['high_priority', 'bulk_telemetry']);
export type PriorityLane = z.infer<typeof PriorityLaneEnum>;

export const IngestEventResponseSchema = z.object({
  success: z.literal(true),
  eventId: z.string().uuid(),
  status: z.enum(['accepted', 'duplicate']),
  lane: PriorityLaneEnum,
  receivedAt: z.string().datetime()
});
export type IngestEventResponse = z.infer<typeof IngestEventResponseSchema>;

export const IngestBatchResponseSchema = z.object({
  success: z.literal(true),
  processedCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  eventIds: z.array(z.string().uuid())
});
export type IngestBatchResponse = z.infer<typeof IngestBatchResponseSchema>;

// OpenTelemetry Span Ingest Adapter Schemas
export const OpenTelemetrySpanSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().min(1),
  kind: z.union([z.string(), z.number()]).transform((val) => {
    if (typeof val === 'number') {
      const kinds = ['unset', 'internal', 'server', 'client', 'producer', 'consumer'] as const;
      return kinds[val] ?? 'internal';
    }
    return val.toLowerCase();
  }),
  startTimeUnixNano: z.union([z.string(), z.number()]),
  endTimeUnixNano: z.union([z.string(), z.number()]),
  attributes: z
    .array(
      z.object({
        key: z.string(),
        value: z.record(z.unknown())
      })
    )
    .optional()
    .transform((attrs) => {
      if (!attrs) return {};
      const result: Record<string, unknown> = {};
      for (const attr of attrs) {
        const valObj = attr.value;
        const val =
          valObj.stringValue ?? valObj.intValue ?? valObj.boolValue ?? valObj.doubleValue ?? valObj;
        result[attr.key] = val;
      }
      return result;
    }),
  status: z
    .object({
      code: z.union([z.string(), z.number()]).optional(),
      message: z.string().optional()
    })
    .optional()
    .transform((s) => ({
      code: (typeof s?.code === 'number'
        ? s.code === 1
          ? 'ok'
          : s.code === 2
            ? 'error'
            : 'unset'
        : (s?.code?.toLowerCase() ?? 'unset')) as 'unset' | 'ok' | 'error',
      message: s?.message
    }))
});

export const OpenTelemetryIngestInputSchema = z.object({
  resourceSpans: z.array(
    z.object({
      resource: z
        .object({
          attributes: z
            .array(z.object({ key: z.string(), value: z.record(z.unknown()) }))
            .optional()
        })
        .optional(),
      scopeSpans: z.array(
        z.object({
          scope: z
            .object({ name: z.string().optional(), version: z.string().optional() })
            .optional(),
          spans: z.array(OpenTelemetrySpanSchema)
        })
      )
    })
  )
});
export type OpenTelemetryIngestInput = z.infer<typeof OpenTelemetryIngestInputSchema>;

// Framework / MCP Callback Ingest Schema
export const FrameworkCallbackInputSchema = z.object({
  framework: z.enum(['langchain', 'llamaindex', 'mcp', 'semantic_kernel', 'custom']),
  eventType: z.enum([
    'on_tool_start',
    'on_tool_end',
    'on_llm_start',
    'on_llm_end',
    'on_chain_start',
    'on_chain_end',
    'on_agent_action'
  ]),
  idempotencyKey: z.string().min(1),
  agentId: z.string().min(1),
  agentRole: z.string().optional(),
  conversationId: z.string().optional(),
  payload: z.record(z.unknown()),
  occurredAt: z.string().datetime().optional()
});
export type FrameworkCallbackInput = z.infer<typeof FrameworkCallbackInputSchema>;

// Gateway Diagnostics & Health
export const ConnectorHealthStatusSchema = z.object({
  connectorId: z.string(),
  type: z.string(),
  status: z.enum(['healthy', 'degraded', 'failing', 'offline']),
  latencyMs: z.number().nonnegative(),
  lastCheck: z.string().datetime()
});

export const GatewayHealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  queueLag: z.object({
    highPriorityPending: z.number().int().nonnegative(),
    bulkTelemetryPending: z.number().int().nonnegative(),
    oldestUnprocessedSec: z.number().nonnegative()
  }),
  circuitBreaker: z.object({
    status: z.enum(['closed', 'half_open', 'open']),
    failureCount: z.number().int().nonnegative(),
    lastFailure: z.string().datetime().nullable()
  }),
  connectors: z.array(ConnectorHealthStatusSchema),
  uptimeSec: z.number().nonnegative(),
  timestamp: z.string().datetime()
});
export type GatewayHealthResponse = z.infer<typeof GatewayHealthResponseSchema>;

// Privacy Policy Configuration
export const PrivacyPolicyConfigSchema = z.object({
  defaultContentMode: ContentModeEnum.default('metadata_only'),
  allowedFields: z.array(z.string()).optional(),
  redactPii: z.boolean().default(true),
  maxContentLength: z.number().int().positive().default(4096),
  dataClassification: z
    .enum(['public', 'internal', 'confidential', 'restricted'])
    .default('internal')
});
export type PrivacyPolicyConfig = z.infer<typeof PrivacyPolicyConfigSchema>;
