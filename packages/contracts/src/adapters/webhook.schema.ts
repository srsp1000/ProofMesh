import { z } from 'zod';

export const WebhookSourceEnum = z.enum(['generic_hmac', 'github', 'slack', 'custom_agent']);
export type WebhookSource = z.infer<typeof WebhookSourceEnum>;

export const WebhookHeadersSchema = z.object({
  signature: z.string().min(1),
  timestamp: z.string().min(1),
  source: WebhookSourceEnum.default('generic_hmac'),
  idempotencyKey: z.string().optional(),
  correlationId: z.string().uuid().optional()
});
export type WebhookHeaders = z.infer<typeof WebhookHeadersSchema>;

export const WebhookIngestPayloadSchema = z.object({
  eventType: z.string().min(1),
  source: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().optional(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  data: z.record(z.unknown())
});
export type WebhookIngestPayload = z.infer<typeof WebhookIngestPayloadSchema>;

export const WebhookIngestResponseSchema = z.object({
  eventId: z.string().uuid(),
  status: z.enum(['accepted', 'duplicate', 'queued']),
  correlationId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  inboxId: z.string().uuid().optional()
});
export type WebhookIngestResponse = z.infer<typeof WebhookIngestResponseSchema>;
