import { describe, it, expect, vi } from 'vitest';
import {
  ProofMeshClient,
  ProofMeshLangChainCallback,
  type TelemetrySpanItem
} from '@proofmesh/sdk';

describe('LangChain Framework Instrumentation Callback', () => {
  it('records chain execution telemetry with captured captureMethod', () => {
    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000'
    });

    const recordedSpans: Array<Omit<TelemetrySpanItem, 'workflowContext'> & { id?: string }> = [];
    vi.spyOn(client.telemetry, 'recordSpan').mockImplementation((span) => {
      recordedSpans.push(span);
    });

    const callback = new ProofMeshLangChainCallback(client);
    const runId = '12345678-1234-5678-1234-567812345678';

    callback.handleChainStart(
      { name: 'RetrievalQAChain' },
      { query: 'What is ProofMesh?' },
      runId
    );

    callback.handleChainEnd({ output: 'ProofMesh is an AI governance platform' }, runId);

    expect(recordedSpans).toHaveLength(1);
    expect(recordedSpans[0].name).toBe('langchain.chain:RetrievalQAChain');
    expect(recordedSpans[0].status).toBe('ok');
    expect(recordedSpans[0].attributes?.['proofmesh.capture_method']).toBe('captured');
  });

  it('records tool execution lifecycle and parent run correlation', () => {
    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000'
    });

    const recordedSpans: Array<Omit<TelemetrySpanItem, 'workflowContext'> & { id?: string }> = [];
    vi.spyOn(client.telemetry, 'recordSpan').mockImplementation((span) => {
      recordedSpans.push(span);
    });

    const callback = new ProofMeshLangChainCallback(client);
    const chainRunId = '12345678-1234-5678-1234-567812345678';
    const toolRunId = '12345678-1234-5678-1234-567812345679';

    callback.handleToolStart({ name: 'vector_search' }, 'search query', toolRunId, chainRunId);

    callback.handleToolEnd('results: [doc1, doc2]', toolRunId);

    expect(recordedSpans).toHaveLength(1);
    expect(recordedSpans[0].name).toBe('langchain.tool:vector_search');
    expect(recordedSpans[0].status).toBe('ok');
    expect(recordedSpans[0].attributes?.['proofmesh.capture_method']).toBe('captured');
  });

  it('captures errors accurately during chain failure', () => {
    const client = new ProofMeshClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000'
    });

    const recordedSpans: Array<Omit<TelemetrySpanItem, 'workflowContext'> & { id?: string }> = [];
    vi.spyOn(client.telemetry, 'recordSpan').mockImplementation((span) => {
      recordedSpans.push(span);
    });

    const callback = new ProofMeshLangChainCallback(client);
    const runId = '12345678-1234-5678-1234-567812345678';

    callback.handleChainStart({ name: 'FailingChain' }, {}, runId);
    callback.handleChainError(new Error('Rate limit exceeded from model provider'), runId);

    expect(recordedSpans).toHaveLength(1);
    expect(recordedSpans[0].status).toBe('error');
    expect(recordedSpans[0].attributes?.['error.message']).toContain('Rate limit exceeded');
    expect(recordedSpans[0].attributes?.['proofmesh.capture_method']).toBe('captured');
  });
});
