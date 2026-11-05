import type { HttpClient } from '../http.js';
import type { AdmissibilityCheckInput, AdmissibilityCheckResult } from '@proofmesh/contracts';

export class AdmissibilityModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Checks whether a claim version satisfies admissibility policies for downstream consumption.
   */
  public async check(input: AdmissibilityCheckInput): Promise<AdmissibilityCheckResult> {
    return this.http.request<AdmissibilityCheckResult>('/v1/admissibility/check', 'POST', input);
  }
}
