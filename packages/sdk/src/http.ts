import type { ProofMeshClientOptions } from './types.js';
import { ProofMeshApiError, ProofMeshTimeoutError } from './types.js';
import { WorkflowContextManager } from './context.js';

export class HttpClient {
  constructor(private readonly options: ProofMeshClientOptions) {}

  public async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: unknown,
    customHeaders?: Record<string, string>
  ): Promise<T> {
    const maxRetries = this.options.maxRetries ?? 3;
    const baseDelay = this.options.retryDelayMs ?? 200;
    const timeoutMs = this.options.timeoutMs ?? 5000;

    const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}`;
    const activeContext = WorkflowContextManager.getWorkflowContext();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.apiKey}`,
      ...customHeaders
    };

    if (this.options.tenantId) {
      headers['X-Tenant-ID'] = this.options.tenantId;
    }
    if (activeContext?.correlationId) {
      headers['X-Correlation-ID'] = activeContext.correlationId;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });

        clearTimeout(timer);

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            return (await response.json()) as T;
          }
          return {} as T;
        }

        // Handle error responses
        const status = response.status;
        let errorData: Record<string, unknown> = {};
        try {
          errorData = (await response.json()) as Record<string, unknown>;
        } catch {
          errorData = { title: response.statusText };
        }

        const code = typeof errorData.code === 'string' ? errorData.code : 'API_ERROR';
        const detail =
          typeof errorData.detail === 'string'
            ? errorData.detail
            : typeof errorData.title === 'string'
              ? errorData.title
              : `Request failed with status ${status}`;

        const apiError = new ProofMeshApiError(status, code, detail, errorData);

        // Do not retry 4xx errors (client faults)
        if (status >= 400 && status < 500) {
          throw apiError;
        }

        lastError = apiError;
      } catch (err: unknown) {
        clearTimeout(timer);

        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new ProofMeshTimeoutError(timeoutMs, `${method} ${path}`);
        } else if (err instanceof ProofMeshApiError && err.status >= 400 && err.status < 500) {
          throw err;
        } else {
          lastError = err;
        }

        // If last attempt, break
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const jitter = Math.random() * 50;
        const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, 5000);
        this.options.logger?.warn?.(
          `Request to ${method} ${path} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${Math.round(delay)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (this.options.failOpen) {
      this.options.logger?.warn?.(
        `ProofMesh operation failed and failOpen is enabled for ${method} ${path}:`,
        lastError
      );
      return null as unknown as T;
    }

    throw lastError;
  }
}
