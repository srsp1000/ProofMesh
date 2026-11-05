import crypto from 'node:crypto';
import type {
  CanonicalEventEnvelope,
  FrameworkCallbackInput,
  AgentActivityV1,
  MessageObservedV1
} from '@proofmesh/contracts';
import { createCanonicalEnvelope } from '@proofmesh/contracts';
import type { ProtocolAdapter, AdapterContext } from './adapter.interface.js';

export class FrameworkCallbackAdapter implements ProtocolAdapter<
  FrameworkCallbackInput,
  Record<string, unknown>
> {
  readonly protocolName = 'framework_callback';

  transform(
    input: FrameworkCallbackInput,
    context: AdapterContext
  ): CanonicalEventEnvelope<Record<string, unknown>>[] {
    const isLlmMessage = input.eventType === 'on_llm_start' || input.eventType === 'on_llm_end';

    if (isLlmMessage) {
      const content = (input.payload.content as string) ?? JSON.stringify(input.payload);
      const contentHash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;

      const messagePayload: MessageObservedV1 = {
        messageId: crypto.randomUUID(),
        conversationId: input.conversationId ?? `conv_${input.agentId}`,
        role: input.eventType === 'on_llm_start' ? 'user' : 'assistant',
        content,
        contentHash,
        tokenCount:
          typeof input.payload.tokenCount === 'number' ? input.payload.tokenCount : undefined,
        model: typeof input.payload.model === 'string' ? input.payload.model : undefined
      };

      const envelope = createCanonicalEnvelope<MessageObservedV1>({
        id: crypto.randomUUID(),
        source: `/tenants/${context.tenantId}/integrations/${input.framework}`,
        type: 'io.proofmesh.message.observed.v1',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        schemaVersion: '1.0.0',
        sourceIntegration: input.framework,
        instanceIdentity: input.agentId,
        actor: context.actor,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        correlationId: crypto.randomUUID(),
        captureMethod: 'captured',
        contentMode: 'metadata_only',
        idempotencyKey: input.idempotencyKey,
        data: messagePayload
      });

      return [envelope as CanonicalEventEnvelope<Record<string, unknown>>];
    }

    // Default to agent activity event
    const activityType =
      input.eventType === 'on_tool_start' || input.eventType === 'on_tool_end'
        ? ('tool_call' as const)
        : ('planning' as const);

    const executionStatus = input.eventType.endsWith('_end')
      ? ('completed' as const)
      : input.eventType.endsWith('_start')
        ? ('started' as const)
        : ('running' as const);

    const activityPayload: AgentActivityV1 = {
      activityId: crypto.randomUUID(),
      agentId: input.agentId,
      agentRole: input.agentRole ?? 'autonomous_agent',
      activityType,
      toolName: typeof input.payload.toolName === 'string' ? input.payload.toolName : undefined,
      toolParameters:
        typeof input.payload.parameters === 'object' && input.payload.parameters !== null
          ? (input.payload.parameters as Record<string, unknown>)
          : undefined,
      executionStatus,
      durationMs:
        typeof input.payload.durationMs === 'number' ? input.payload.durationMs : undefined
    };

    const envelope = createCanonicalEnvelope<AgentActivityV1>({
      id: crypto.randomUUID(),
      source: `/tenants/${context.tenantId}/integrations/${input.framework}`,
      type: 'io.proofmesh.agent.activity.v1',
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      schemaVersion: '1.0.0',
      sourceIntegration: input.framework,
      instanceIdentity: input.agentId,
      actor: context.actor,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      correlationId: crypto.randomUUID(),
      captureMethod: 'captured',
      contentMode: 'metadata_only',
      idempotencyKey: input.idempotencyKey,
      data: activityPayload
    });

    return [envelope as CanonicalEventEnvelope<Record<string, unknown>>];
  }
}
