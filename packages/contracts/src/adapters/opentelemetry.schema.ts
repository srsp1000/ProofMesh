import { z } from 'zod';

export const OTLPAnyValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ stringValue: z.string() }),
    z.object({ boolValue: z.boolean() }),
    z.object({ intValue: z.union([z.string(), z.number()]) }),
    z.object({ doubleValue: z.number() }),
    z.object({
      arrayValue: z.object({ values: z.array(OTLPAnyValueSchema) })
    }),
    z.object({
      kvlistValue: z.object({
        values: z.array(
          z.object({
            key: z.string(),
            value: OTLPAnyValueSchema
          })
        )
      })
    }),
    z.string(),
    z.number(),
    z.boolean()
  ])
);

export const OTLPKeyValueSchema = z.object({
  key: z.string(),
  value: OTLPAnyValueSchema
});
export type OTLPKeyValue = z.infer<typeof OTLPKeyValueSchema>;

export const OTLPSpanStatusSchema = z.object({
  message: z.string().optional(),
  code: z.union([z.number(), z.string()]).optional()
});
export type OTLPSpanStatus = z.infer<typeof OTLPSpanStatusSchema>;

export const OTLPSpanEventSchema = z.object({
  timeUnixNano: z.string(),
  name: z.string(),
  attributes: z.union([z.array(OTLPKeyValueSchema), z.record(z.unknown())]).optional()
});
export type OTLPSpanEvent = z.infer<typeof OTLPSpanEventSchema>;

export const OTLPSpanSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().min(1),
  kind: z.union([z.number(), z.string()]).optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]),
  endTimeUnixNano: z.union([z.string(), z.number()]),
  attributes: z.union([z.array(OTLPKeyValueSchema), z.record(z.unknown())]).optional(),
  events: z.array(OTLPSpanEventSchema).optional(),
  status: OTLPSpanStatusSchema.optional()
});
export type OTLPSpan = z.infer<typeof OTLPSpanSchema>;

export const OTLPScopeSpanSchema = z.object({
  scope: z
    .object({
      name: z.string().optional(),
      version: z.string().optional()
    })
    .optional(),
  spans: z.array(OTLPSpanSchema)
});
export type OTLPScopeSpan = z.infer<typeof OTLPScopeSpanSchema>;

export const OTLPResourceSpanSchema = z.object({
  resource: z
    .object({
      attributes: z.union([z.array(OTLPKeyValueSchema), z.record(z.unknown())]).optional()
    })
    .optional(),
  scopeSpans: z.array(OTLPScopeSpanSchema)
});
export type OTLPResourceSpan = z.infer<typeof OTLPResourceSpanSchema>;

export const OTLPTracesPayloadSchema = z.object({
  resourceSpans: z.array(OTLPResourceSpanSchema)
});
export type OTLPTracesPayload = z.infer<typeof OTLPTracesPayloadSchema>;

export const GenAISemanticAttributesSchema = z.object({
  'gen_ai.system': z.string().optional(),
  'gen_ai.request.model': z.string().optional(),
  'gen_ai.response.model': z.string().optional(),
  'gen_ai.operation.name': z
    .enum(['chat', 'text_completion', 'embeddings', 'execute_tool'])
    .optional(),
  'gen_ai.usage.prompt_tokens': z.number().int().optional(),
  'gen_ai.usage.completion_tokens': z.number().int().optional(),
  'gen_ai.usage.total_tokens': z.number().int().optional(),
  'gen_ai.prompt': z.string().optional(),
  'gen_ai.completion': z.string().optional(),
  'gen_ai.tool.name': z.string().optional(),
  'gen_ai.tool.call.id': z.string().optional(),
  'gen_ai.tool.input': z.string().optional(),
  'gen_ai.tool.output': z.string().optional(),
  'gen_ai.agent.id': z.string().optional(),
  'gen_ai.agent.name': z.string().optional()
});
export type GenAISemanticAttributes = z.infer<typeof GenAISemanticAttributesSchema>;

export const ProofMeshTraceCorrelationAttributesSchema = z.object({
  'proofmesh.tenant_id': z.string().uuid().optional(),
  'proofmesh.workspace_id': z.string().uuid().optional(),
  'proofmesh.project_id': z.string().uuid().optional(),
  'proofmesh.workflow_id': z.string().optional(),
  'proofmesh.decision_id': z.string().uuid().optional(),
  'proofmesh.claim_id': z.string().uuid().optional()
});
export type ProofMeshTraceCorrelationAttributes = z.infer<
  typeof ProofMeshTraceCorrelationAttributesSchema
>;

export const InstrumentationCoverageGapReportSchema = z.object({
  spanId: z.string(),
  traceId: z.string(),
  spanName: z.string(),
  hasGenAiAttributes: z.boolean(),
  hasCorrelationAttributes: z.boolean(),
  missingAttributes: z.array(z.string()),
  unsupportedInstrumentation: z.array(z.string()),
  coverageScore: z.number().min(0).max(100),
  recommendations: z.array(z.string())
});
export type InstrumentationCoverageGapReport = z.infer<
  typeof InstrumentationCoverageGapReportSchema
>;
