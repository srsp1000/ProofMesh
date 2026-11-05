import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProofMeshClient,
  WorkflowContextManager,
  observeWorkflow,
  observeTool,
  ProofMeshApiError,
  type TelemetrySpanItem
} from '@proofmesh/sdk';

describe('TypeScript SDK Client & Context', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates client configuration on creation', () => {
    expect(() => new ProofMeshClient({ apiKey: '', baseUrl: 'http://localhost:3000' })).toThrow(
      'ProofMeshClient requires an apiKey'
    );
    expect(() => new ProofMeshClient({ apiKey: 'key', baseUrl: '' })).toThrow(
      'ProofMeshClient requires a baseUrl'
    );

    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000',
      tenantId: 'tenant-123'
    });
    expect(client.options.apiKey).toBe('test_key');
    expect(client.options.tenantId).toBe('tenant-123');
    expect(client.options.timeoutMs).toBe(5000);
  });

  it('manages async workflow context with AsyncLocalStorage', async () => {
    expect(WorkflowContextManager.getWorkflowContext()).toBeUndefined();

    const ctx = WorkflowContextManager.createWorkflowContext({
      workflowId: 'wf-abc',
      correlationId: 'corr-xyz'
    });

    await WorkflowContextManager.withWorkflow(ctx, async () => {
      const active = WorkflowContextManager.getWorkflowContext();
      expect(active).toBeDefined();
      expect(active?.workflowId).toBe('wf-abc');
      expect(active?.correlationId).toBe('corr-xyz');

      // Nested child context
      const child = WorkflowContextManager.createChildContext({ metadata: { step: 2 } });
      await WorkflowContextManager.withWorkflow(child, async () => {
        const nested = WorkflowContextManager.getWorkflowContext();
        expect(nested?.workflowId).toBe('wf-abc');
        expect(nested?.correlationId).toBe('corr-xyz');
        expect(nested?.parentSpanId).toBe(ctx.spanId);
        expect(nested?.metadata?.step).toBe(2);
      });

      // Context returns to parent
      expect(WorkflowContextManager.getWorkflowContext()?.spanId).toBe(ctx.spanId);
    });

    expect(WorkflowContextManager.getWorkflowContext()).toBeUndefined();
  });

  it('observes workflow and records telemetry spans', async () => {
    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000'
    });

    const recordedSpans: Array<Omit<TelemetrySpanItem, 'workflowContext'> & { id?: string }> = [];
    vi.spyOn(client.telemetry, 'recordSpan').mockImplementation((span) => {
      recordedSpans.push(span);
    });

    const result = await observeWorkflow(client, 'test_flow', async () => {
      return 42;
    });

    expect(result).toBe(42);
    expect(recordedSpans).toHaveLength(1);
    expect(recordedSpans[0].name).toBe('workflow:test_flow');
    expect(recordedSpans[0].status).toBe('ok');
  });

  it('observes tool execution and handles failures', async () => {
    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000'
    });

    const recordedSpans: Array<Omit<TelemetrySpanItem, 'workflowContext'> & { id?: string }> = [];
    vi.spyOn(client.telemetry, 'recordSpan').mockImplementation((span) => {
      recordedSpans.push(span);
    });

    await expect(
      observeTool(client, 'failing_tool', async () => {
        throw new Error('Database unreachable');
      })
    ).rejects.toThrow('Database unreachable');

    expect(recordedSpans).toHaveLength(1);
    expect(recordedSpans[0].name).toBe('tool:failing_tool');
    expect(recordedSpans[0].status).toBe('error');
    expect(recordedSpans[0].attributes?.['error.message']).toBe('Database unreachable');
  });

  it('does not retry 4xx client errors in HTTP requests', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', async () => {
      callCount++;
      return {
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          code: 'VALIDATION_FAILED',
          detail: 'Invalid qualifier input'
        })
      };
    });

    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000',
      maxRetries: 3
    });

    await expect(
      client.claims.register({
        claimConceptKey: 'test',
        statement: 'statement'
      })
    ).rejects.toBeInstanceOf(ProofMeshApiError);

    // Should only have been called once (no retry for 4xx)
    expect(callCount).toBe(1);
  });

  it('fails open when failOpen is enabled on client', async () => {
    vi.stubGlobal('fetch', async () => {
      return {
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          code: 'INTERNAL_ERROR',
          detail: 'Internal service failure'
        })
      };
    });

    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000',
      maxRetries: 1,
      retryDelayMs: 10,
      failOpen: true
    });

    const result = await client.claims.register({
      claimConceptKey: 'test',
      statement: 'statement'
    });

    expect(result).toBeNull();
  });
});
