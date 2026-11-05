import { z } from 'zod';

export const AdapterProtocolTypeEnum = z.enum(['switch', 'webhook', 'opentelemetry']);
export type AdapterProtocolType = z.infer<typeof AdapterProtocolTypeEnum>;

export const AdapterConnectionStateEnum = z.enum([
  'connected',
  'disconnected',
  'reconnecting',
  'lapsed',
  'degraded'
]);
export type AdapterConnectionState = z.infer<typeof AdapterConnectionStateEnum>;

export const AdapterCursorStatusSchema = z.object({
  cursor: z.number().int().min(0),
  head: z.number().int().min(0).optional(),
  generation: z.string().nullable(),
  gapCount: z.number().int().min(0).default(0)
});
export type AdapterCursorStatus = z.infer<typeof AdapterCursorStatusSchema>;

export const AdapterHealthStatusSchema = z.object({
  adapterId: z.string(),
  protocol: AdapterProtocolTypeEnum,
  connectionStatus: AdapterConnectionStateEnum,
  lastEventAt: z.string().datetime().nullable(),
  queueLag: z.number().int().min(0),
  eventRejectionCount: z.number().int().min(0),
  schemaIncompatibilityCount: z.number().int().min(0),
  cursorStatus: AdapterCursorStatusSchema,
  droppedEventsCount: z.number().int().min(0),
  permissionErrorsCount: z.number().int().min(0),
  details: z.record(z.unknown()).optional()
});
export type AdapterHealthStatus = z.infer<typeof AdapterHealthStatusSchema>;

export const AdapterHealthSummaryResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  adapters: z.array(AdapterHealthStatusSchema),
  timestamp: z.string().datetime()
});
export type AdapterHealthSummaryResponse = z.infer<typeof AdapterHealthSummaryResponseSchema>;
