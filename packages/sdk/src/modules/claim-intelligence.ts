import type { HttpClient } from '../http.js';
import type {
  ClaimExtractionInput,
  ClaimExtractionResult,
  ClaimOccurrenceInput,
  ClaimOccurrenceDTO,
  ClaimCorrectionInput,
  ClaimCorrectionDTO,
  MaterialProposition,
  DuplicateConceptCandidate
} from '@proofmesh/contracts';

export class ClaimIntelligenceModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Extracts atomic material propositions from source text and normalizes them.
   */
  public async extract(input: ClaimExtractionInput): Promise<ClaimExtractionResult> {
    return this.http.request<ClaimExtractionResult>('/v1/claims/extract', 'POST', input);
  }

  /**
   * Records an immutable occurrence of a claim in a source passage, document, or agent activity.
   */
  public async recordOccurrence(input: ClaimOccurrenceInput): Promise<ClaimOccurrenceDTO> {
    return this.http.request<ClaimOccurrenceDTO>('/v1/claims/occurrences', 'POST', input);
  }

  /**
   * Retrieves occurrences for a specific claim version.
   */
  public async getOccurrences(
    claimVersionId: string
  ): Promise<{ occurrences: ClaimOccurrenceDTO[]; count: number }> {
    return this.http.request<{ occurrences: ClaimOccurrenceDTO[]; count: number }>(
      `/v1/claims/${claimVersionId}/occurrences`,
      'GET'
    );
  }

  /**
   * Submits a human correction for a claim proposition with an immutable audit log.
   */
  public async submitCorrection(
    claimVersionId: string,
    correction: Omit<ClaimCorrectionInput, 'claimVersionId'>
  ): Promise<ClaimCorrectionDTO> {
    return this.http.request<ClaimCorrectionDTO>(
      `/v1/claims/${claimVersionId}/corrections`,
      'POST',
      correction
    );
  }

  /**
   * Retrieves all human corrections recorded for a claim version.
   */
  public async getCorrections(
    claimVersionId: string
  ): Promise<{ corrections: ClaimCorrectionDTO[]; count: number }> {
    return this.http.request<{ corrections: ClaimCorrectionDTO[]; count: number }>(
      `/v1/claims/${claimVersionId}/corrections`,
      'GET'
    );
  }

  /**
   * Evaluates potential duplicate concepts while strictly preserving scope separation.
   */
  public async detectDuplicates(
    proposition: MaterialProposition,
    existingConcepts: Array<{
      id: string;
      conceptKey: string;
      qualifiers?: Record<string, unknown>;
    }>
  ): Promise<{ candidates: DuplicateConceptCandidate[]; count: number }> {
    return this.http.request<{ candidates: DuplicateConceptCandidate[]; count: number }>(
      '/v1/claims/concepts/detect-duplicates',
      'POST',
      { proposition, existingConcepts }
    );
  }
}
