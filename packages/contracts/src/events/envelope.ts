import { z } from 'zod';

export const EventEnvelopeSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.string().uuid(),
  source: z.string().min(1),
  type: z.string().regex(/^io\.proofmesh\.[a-z0-9_-]+\.[a-z0-9_-]+\.v[1-9][0-9]*$/),
  time: z.string().datetime(),
  datacontenttype: z.literal('application/json'),
  tenantId: z.string().uuid(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).optional(),
  data: z.record(z.unknown())
});

export type EventEnvelope<T = Record<string, unknown>> = Omit<
  z.infer<typeof EventEnvelopeSchema>,
  'data'
> & {
  data: T;
};

export function createEventEnvelope<T extends Record<string, unknown>>(params: {
  id: string;
  source: string;
  type: string;
  tenantId: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  data: T;
  time?: string;
}): EventEnvelope<T> {
  const envelope: EventEnvelope<T> = {
    specversion: '1.0',
    id: params.id,
    source: params.source,
    type: params.type,
    time: params.time ?? new Date().toISOString(),
    datacontenttype: 'application/json',
    tenantId: params.tenantId,
    correlationId: params.correlationId,
    causationId: params.causationId,
    idempotencyKey: params.idempotencyKey,
    data: params.data
  };

  EventEnvelopeSchema.parse(envelope);
  return envelope;
}
