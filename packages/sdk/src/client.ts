import type { ProofMeshClientOptions, WorkflowContext } from './types.js';
import { HttpClient } from './http.js';
import { TelemetryBuffer } from './telemetry.js';
import { ClaimsModule } from './modules/claims.js';
import { ContextPacketsModule } from './modules/context-packets.js';
import { DependenciesModule } from './modules/dependencies.js';
import { DecisionsModule } from './modules/decisions.js';
import { AdmissibilityModule } from './modules/admissibility.js';
import { ReviewsModule } from './modules/reviews.js';
import { LineageModule } from './modules/lineage.js';
import { SourcesModule } from './modules/sources.js';
import { ClaimIntelligenceModule } from './modules/claim-intelligence.js';
import { WorkflowContextManager } from './context.js';
import { randomUUID } from 'node:crypto';

export class ProofMeshClient {
  public readonly options: ProofMeshClientOptions;
  public readonly claims: ClaimsModule;
  public readonly sources: SourcesModule;
  public readonly claimIntelligence: ClaimIntelligenceModule;
  public readonly contextPackets: ContextPacketsModule;
  public readonly dependencies: DependenciesModule;
  public readonly decisions: DecisionsModule;
  public readonly admissibility: AdmissibilityModule;
  public readonly reviews: ReviewsModule;
  public readonly lineage: LineageModule;
  public readonly telemetry: TelemetryBuffer;
  private readonly http: HttpClient;

  constructor(options: ProofMeshClientOptions) {
    if (!options.apiKey) {
      throw new Error('ProofMeshClient requires an apiKey');
    }
    if (!options.baseUrl) {
      throw new Error('ProofMeshClient requires a baseUrl');
    }

    this.options = {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 200,
      failOpen: false,
      ...options
    };

    this.http = new HttpClient(this.options);
    this.telemetry = new TelemetryBuffer(this.options);
    this.claims = new ClaimsModule(this.http);
    this.sources = new SourcesModule(this.http);
    this.claimIntelligence = new ClaimIntelligenceModule(this.http);
    this.contextPackets = new ContextPacketsModule(this.http);
    this.dependencies = new DependenciesModule(this.http);
    this.decisions = new DecisionsModule(this.http);
    this.admissibility = new AdmissibilityModule(this.http);
    this.reviews = new ReviewsModule(this.http);
    this.lineage = new LineageModule(this.http);
  }

  /**
   * Scopes execution within a workflow context.
   */
  public async withWorkflow<T>(
    contextOrWorkflowId: WorkflowContext | string,
    fn: () => Promise<T> | T
  ): Promise<T> {
    const context: WorkflowContext =
      typeof contextOrWorkflowId === 'string'
        ? WorkflowContextManager.createWorkflowContext({
            workflowId: contextOrWorkflowId,
            correlationId: randomUUID()
          })
        : contextOrWorkflowId;

    return WorkflowContextManager.withWorkflow(context, fn);
  }

  /**
   * Helper to create a new root workflow context.
   */
  public createWorkflowContext(initial?: Partial<WorkflowContext>): WorkflowContext {
    return WorkflowContextManager.createWorkflowContext(initial);
  }

  /**
   * Flushes all pending telemetry spans.
   */
  public async flush(): Promise<void> {
    await this.telemetry.flush();
  }

  /**
   * Shuts down telemetry flusher and releases client resources.
   */
  public async close(): Promise<void> {
    await this.telemetry.stop();
  }
}
