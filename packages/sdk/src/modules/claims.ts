import type { HttpClient } from '../http.js';
import type { WorkflowContext } from '../types.js';
import { WorkflowContextManager } from '../context.js';
import type {
  SubmitClaimInput,
  ClaimVersionDTO,
  TransitionClaimInput,
  ClaimStatus
} from '@proofmesh/contracts';

export class ClaimsModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Registers a semantic claim with ProofMesh.
   * Semantic calls default to 'declared' captureMethod to distinguish from automatic telemetry.
   */
  public async register(
    input: SubmitClaimInput & { captureMethod?: 'declared' | 'attested' | 'captured' }
  ): Promise<ClaimVersionDTO> {
    const activeContext: WorkflowContext | undefined = WorkflowContextManager.getWorkflowContext();

    const payload: SubmitClaimInput = {
      ...input,
      qualifiers: {
        ...(input.qualifiers ?? {}),
        proofmesh_capture_method: input.captureMethod ?? 'declared',
        ...(activeContext?.workflowId ? { proofmesh_workflow_id: activeContext.workflowId } : {}),
        ...(activeContext?.correlationId
          ? { proofmesh_correlation_id: activeContext.correlationId }
          : {})
      }
    };

    return this.http.request<ClaimVersionDTO>('/v1/claims', 'POST', payload);
  }

  /**
   * Retrieves an existing claim by ID.
   */
  public async get(claimId: string): Promise<ClaimVersionDTO> {
    return this.http.request<ClaimVersionDTO>(`/v1/claims/${claimId}`, 'GET');
  }

  /**
   * Transitions a claim's lifecycle state via the authoritative domain service.
   */
  public async transition(
    claimId: string,
    targetState: ClaimStatus,
    reason: string,
    evidenceAssessmentIds: string[] = []
  ): Promise<ClaimVersionDTO> {
    const payload: TransitionClaimInput = {
      targetState,
      transitionReason: reason,
      evidenceAssessmentIds
    };
    return this.http.request<ClaimVersionDTO>(`/v1/claims/${claimId}/transition`, 'POST', payload);
  }
}
