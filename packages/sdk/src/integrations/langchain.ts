import type { ProofMeshClient } from '../client.js';

interface ActiveRun {
  name: string;
  kind: string;
  startTimeUnixNano: number;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
}

export class ProofMeshLangChainCallback {
  public readonly name = 'proofmesh_langchain_callback';
  private readonly client: ProofMeshClient;
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(client: ProofMeshClient) {
    this.client = client;
  }

  public handleChainStart(
    chain: { name?: string },
    _inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>
  ): void {
    this.activeRuns.set(runId, {
      name: chain.name ?? 'Chain',
      kind: 'chain',
      startTimeUnixNano: Date.now() * 1_000_000,
      parentRunId,
      metadata
    });
  }

  public handleChainEnd(_outputs: Record<string, unknown>, runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);

    const endTime = Date.now() * 1_000_000;
    this.client.telemetry.recordSpan({
      id: runId.replace(/-/g, '').substring(0, 16),
      name: `langchain.chain:${run.name}`,
      kind: 'INTERNAL',
      startTimeUnixNano: run.startTimeUnixNano,
      endTimeUnixNano: endTime,
      status: 'ok',
      attributes: {
        'langchain.run_id': runId,
        'langchain.parent_run_id': run.parentRunId ?? '',
        'proofmesh.capture_method': 'captured',
        ...run.metadata
      }
    });
  }

  public handleChainError(err: Error, runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);

    const endTime = Date.now() * 1_000_000;
    this.client.telemetry.recordSpan({
      id: runId.replace(/-/g, '').substring(0, 16),
      name: `langchain.chain:${run.name}`,
      kind: 'INTERNAL',
      startTimeUnixNano: run.startTimeUnixNano,
      endTimeUnixNano: endTime,
      status: 'error',
      attributes: {
        'langchain.run_id': runId,
        'error.message': err.message,
        'proofmesh.capture_method': 'captured',
        ...run.metadata
      }
    });
  }

  public handleToolStart(
    tool: { name?: string },
    _input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>
  ): void {
    this.activeRuns.set(runId, {
      name: tool.name ?? 'Tool',
      kind: 'tool',
      startTimeUnixNano: Date.now() * 1_000_000,
      parentRunId,
      metadata
    });
  }

  public handleToolEnd(_output: string, runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);

    const endTime = Date.now() * 1_000_000;
    this.client.telemetry.recordSpan({
      id: runId.replace(/-/g, '').substring(0, 16),
      name: `langchain.tool:${run.name}`,
      kind: 'INTERNAL',
      startTimeUnixNano: run.startTimeUnixNano,
      endTimeUnixNano: endTime,
      status: 'ok',
      attributes: {
        'langchain.run_id': runId,
        'proofmesh.capture_method': 'captured',
        ...run.metadata
      }
    });
  }

  public handleToolError(err: Error, runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);

    const endTime = Date.now() * 1_000_000;
    this.client.telemetry.recordSpan({
      id: runId.replace(/-/g, '').substring(0, 16),
      name: `langchain.tool:${run.name}`,
      kind: 'INTERNAL',
      startTimeUnixNano: run.startTimeUnixNano,
      endTimeUnixNano: endTime,
      status: 'error',
      attributes: {
        'langchain.run_id': runId,
        'error.message': err.message,
        'proofmesh.capture_method': 'captured',
        ...run.metadata
      }
    });
  }

  public handleLLMStart(
    llm: { name?: string },
    _prompts: string[],
    runId: string,
    parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>
  ): void {
    this.activeRuns.set(runId, {
      name: llm.name ?? 'LLM',
      kind: 'llm',
      startTimeUnixNano: Date.now() * 1_000_000,
      parentRunId,
      metadata
    });
  }

  public handleLLMEnd(_output: unknown, runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);

    const endTime = Date.now() * 1_000_000;
    this.client.telemetry.recordSpan({
      id: runId.replace(/-/g, '').substring(0, 16),
      name: `langchain.llm:${run.name}`,
      kind: 'INTERNAL',
      startTimeUnixNano: run.startTimeUnixNano,
      endTimeUnixNano: endTime,
      status: 'ok',
      attributes: {
        'langchain.run_id': runId,
        'proofmesh.capture_method': 'captured',
        ...run.metadata
      }
    });
  }

  public handleLLMError(err: Error, runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);

    const endTime = Date.now() * 1_000_000;
    this.client.telemetry.recordSpan({
      id: runId.replace(/-/g, '').substring(0, 16),
      name: `langchain.llm:${run.name}`,
      kind: 'INTERNAL',
      startTimeUnixNano: run.startTimeUnixNano,
      endTimeUnixNano: endTime,
      status: 'error',
      attributes: {
        'langchain.run_id': runId,
        'error.message': err.message,
        'proofmesh.capture_method': 'captured',
        ...run.metadata
      }
    });
  }
}
