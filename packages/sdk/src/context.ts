import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { WorkflowContext } from './types.js';

const storage = new AsyncLocalStorage<WorkflowContext>();

export class WorkflowContextManager {
  /**
   * Executes a callback within a scoped workflow context.
   */
  public static async withWorkflow<T>(
    context: WorkflowContext,
    fn: () => Promise<T> | T
  ): Promise<T> {
    return storage.run(context, fn);
  }

  /**
   * Retrieves the currently active workflow context, if any.
   */
  public static getWorkflowContext(): WorkflowContext | undefined {
    return storage.getStore();
  }

  /**
   * Creates a new root workflow context with generated UUIDs.
   */
  public static createWorkflowContext(initial?: Partial<WorkflowContext>): WorkflowContext {
    const correlationId = initial?.correlationId ?? randomUUID();
    const workflowId = initial?.workflowId ?? randomUUID();
    return {
      workflowId,
      correlationId,
      traceId: initial?.traceId ?? randomUUID().replace(/-/g, ''),
      spanId: initial?.spanId ?? randomUUID().replace(/-/g, '').substring(0, 16),
      parentSpanId: initial?.parentSpanId,
      metadata: initial?.metadata ?? {}
    };
  }

  /**
   * Creates a child workflow context descending from the active context or initial values.
   */
  public static createChildContext(overrides?: Partial<WorkflowContext>): WorkflowContext {
    const parent = storage.getStore();
    return {
      workflowId: overrides?.workflowId ?? parent?.workflowId ?? randomUUID(),
      correlationId: overrides?.correlationId ?? parent?.correlationId ?? randomUUID(),
      traceId: overrides?.traceId ?? parent?.traceId ?? randomUUID().replace(/-/g, ''),
      parentSpanId: parent?.spanId,
      spanId: overrides?.spanId ?? randomUUID().replace(/-/g, '').substring(0, 16),
      metadata: { ...(parent?.metadata ?? {}), ...(overrides?.metadata ?? {}) }
    };
  }
}

export const withWorkflow = WorkflowContextManager.withWorkflow;
export const getWorkflowContext = WorkflowContextManager.getWorkflowContext;
export const createWorkflowContext = WorkflowContextManager.createWorkflowContext;
