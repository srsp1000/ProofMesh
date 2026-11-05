import type { ProofMeshClient } from './client.js';
import { WorkflowContextManager } from './context.js';
import { randomUUID } from 'node:crypto';

let globalClient: ProofMeshClient | null = null;

export function setGlobalProofMeshClient(client: ProofMeshClient): void {
  globalClient = client;
}

export function getGlobalProofMeshClient(): ProofMeshClient | null {
  return globalClient;
}

/**
 * Functional wrapper to observe workflow execution with automated telemetry recording.
 */
export async function observeWorkflow<T>(
  client: ProofMeshClient,
  workflowName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const currentCtx = WorkflowContextManager.getWorkflowContext();
  const workflowId = currentCtx?.workflowId ?? randomUUID();
  const correlationId = currentCtx?.correlationId ?? randomUUID();
  const traceId = currentCtx?.traceId ?? randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').substring(0, 16);

  const context = {
    workflowId,
    correlationId,
    traceId,
    spanId,
    parentSpanId: currentCtx?.spanId,
    metadata: { ...currentCtx?.metadata, ...metadata }
  };

  const startTime = Date.now() * 1_000_000;

  return WorkflowContextManager.withWorkflow(context, async () => {
    try {
      const result = await fn();
      const endTime = Date.now() * 1_000_000;
      client.telemetry.recordSpan({
        name: `workflow:${workflowName}`,
        kind: 'INTERNAL',
        startTimeUnixNano: startTime,
        endTimeUnixNano: endTime,
        status: 'ok',
        attributes: {
          'proofmesh.workflow_name': workflowName,
          ...metadata
        }
      });
      return result;
    } catch (err: unknown) {
      const endTime = Date.now() * 1_000_000;
      const errorMessage = err instanceof Error ? err.message : String(err);
      client.telemetry.recordSpan({
        name: `workflow:${workflowName}`,
        kind: 'INTERNAL',
        startTimeUnixNano: startTime,
        endTimeUnixNano: endTime,
        status: 'error',
        attributes: {
          'proofmesh.workflow_name': workflowName,
          'error.message': errorMessage,
          ...metadata
        }
      });
      throw err;
    }
  });
}

/**
 * Functional wrapper to observe tool execution with automated telemetry recording.
 */
export async function observeTool<T>(
  client: ProofMeshClient,
  toolName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const spanId = randomUUID().replace(/-/g, '').substring(0, 16);
  const startTime = Date.now() * 1_000_000;

  const childCtx = WorkflowContextManager.createChildContext({ spanId });

  return WorkflowContextManager.withWorkflow(childCtx, async () => {
    try {
      const result = await fn();
      const endTime = Date.now() * 1_000_000;
      client.telemetry.recordSpan({
        name: `tool:${toolName}`,
        kind: 'INTERNAL',
        startTimeUnixNano: startTime,
        endTimeUnixNano: endTime,
        status: 'ok',
        attributes: {
          'proofmesh.tool_name': toolName,
          ...metadata
        }
      });
      return result;
    } catch (err: unknown) {
      const endTime = Date.now() * 1_000_000;
      const errorMessage = err instanceof Error ? err.message : String(err);
      client.telemetry.recordSpan({
        name: `tool:${toolName}`,
        kind: 'INTERNAL',
        startTimeUnixNano: startTime,
        endTimeUnixNano: endTime,
        status: 'error',
        attributes: {
          'proofmesh.tool_name': toolName,
          'error.message': errorMessage,
          ...metadata
        }
      });
      throw err;
    }
  });
}

/**
 * Method decorator to observe workflow methods automatically.
 */
export function ObserveWorkflow(workflowName?: string) {
  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const name = workflowName ?? propertyKey;

    descriptor.value = async function (...args: unknown[]) {
      const client =
        (this as { proofMeshClient?: ProofMeshClient }).proofMeshClient ?? globalClient;
      if (!client) {
        return originalMethod.apply(this, args);
      }
      return observeWorkflow(client, name, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Method decorator to observe tool execution automatically.
 */
export function ObserveTool(toolName?: string) {
  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const name = toolName ?? propertyKey;

    descriptor.value = async function (...args: unknown[]) {
      const client =
        (this as { proofMeshClient?: ProofMeshClient }).proofMeshClient ?? globalClient;
      if (!client) {
        return originalMethod.apply(this, args);
      }
      return observeTool(client, name, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
