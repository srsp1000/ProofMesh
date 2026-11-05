export interface ProofMeshClientOptions {
  apiKey: string;
  baseUrl: string;
  tenantId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  failOpen?: boolean;
  logger?: {
    debug: (msg: string, ...args: unknown[]) => void;
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface WorkflowContext {
  workflowId: string;
  correlationId: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  metadata?: Record<string, unknown>;
}

export class ProofMeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofMeshError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProofMeshApiError extends ProofMeshError {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(`[${code}] ${message} (HTTP ${status})`);
    this.name = 'ProofMeshApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProofMeshTimeoutError extends ProofMeshError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, operation: string) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`);
    this.name = 'ProofMeshTimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProofMeshValidationError extends ProofMeshError {
  public readonly issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = 'ProofMeshValidationError';
    this.issues = issues;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
