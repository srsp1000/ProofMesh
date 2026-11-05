export { ProofMeshClient } from './client.js';
export {
  WorkflowContextManager,
  withWorkflow,
  getWorkflowContext,
  createWorkflowContext
} from './context.js';
export {
  ProofMeshError,
  ProofMeshApiError,
  ProofMeshTimeoutError,
  ProofMeshValidationError
} from './types.js';
export type { ProofMeshClientOptions, WorkflowContext } from './types.js';
export { TelemetryBuffer } from './telemetry.js';
export type { TelemetrySpanItem } from './telemetry.js';
export { HttpClient } from './http.js';
export {
  observeWorkflow,
  observeTool,
  ObserveWorkflow,
  ObserveTool,
  setGlobalProofMeshClient,
  getGlobalProofMeshClient
} from './decorators.js';
export { ProofMeshLangChainCallback } from './integrations/langchain.js';

// Re-export core contract types and schemas for SDK consumers
export * from '@proofmesh/contracts';
