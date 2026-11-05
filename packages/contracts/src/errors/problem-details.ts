import { z } from 'zod';

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string().optional(),
  code: z.string(),
  tenantId: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  invalidParams: z
    .array(
      z.object({
        name: z.string(),
        reason: z.string()
      })
    )
    .optional()
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export function createProblemDetails(params: {
  status: number;
  code: string;
  title: string;
  detail: string;
  instance?: string;
  tenantId?: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}): ProblemDetails {
  return {
    type: `https://proofmesh.io/errors/${params.code.toLowerCase().replace(/_/g, '-')}`,
    title: params.title,
    status: params.status,
    detail: params.detail,
    instance: params.instance,
    code: params.code,
    tenantId: params.tenantId,
    timestamp: new Date().toISOString(),
    invalidParams: params.invalidParams
  };
}
