import { z } from 'zod';

export const AuditEventSchema = z.object({
  id: z.string(), // BIGSERIAL converted to string for JS safe integer handling
  tenantId: z.string().uuid(),
  principalId: z.string().uuid().nullable(),
  action: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(),
  payloadHash: z.string().min(64).max(71), // sha256:...
  payloadDiff: z.record(z.unknown()).nullable(),
  prevEventHash: z.string().nullable(),
  correlationId: z.string().max(100).nullable(),
  policyDecision: z.string().max(50).nullable(),
  recordedAt: z.string().datetime()
});
export type AuditEventDTO = z.infer<typeof AuditEventSchema>;

export const CreateAuditEventInputSchema = z.object({
  tenantId: z.string().uuid(),
  principalId: z.string().uuid().nullable().optional(),
  action: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(),
  payload: z.unknown(),
  payloadDiff: z.record(z.unknown()).optional(),
  correlationId: z.string().max(100).optional(),
  policyDecision: z.string().max(50).optional()
});
export type CreateAuditEventInput = z.infer<typeof CreateAuditEventInputSchema>;

export const AuditCheckpointSchema = z.object({
  id: z.string(),
  tenantId: z.string().uuid(),
  startEventId: z.string(),
  endEventId: z.string(),
  eventCount: z.number().int().nonnegative(),
  merkleRoot: z.string().min(64).max(71),
  prevCheckpointRoot: z.string().nullable(),
  signature: z.string().nullable(),
  sealedAt: z.string().datetime()
});
export type AuditCheckpointDTO = z.infer<typeof AuditCheckpointSchema>;

export const AuditQueryFilterSchema = z.object({
  tenantId: z.string().uuid(),
  principalId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  action: z.string().optional(),
  fromTime: z.string().datetime().optional(),
  toTime: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  cursor: z.string().optional()
});
export type AuditQueryFilter = z.infer<typeof AuditQueryFilterSchema>;
