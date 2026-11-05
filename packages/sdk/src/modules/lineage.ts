import type { HttpClient } from '../http.js';
import type { LineageImpactReport } from '@proofmesh/contracts';

export class LineageModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Evaluates downstream blast radius and affected decisions for a claim, artifact, or decision.
   */
  public async getImpactReport(
    entityId: string,
    entityType: 'claim' | 'artifact' | 'decision' = 'claim'
  ): Promise<LineageImpactReport> {
    return this.http.request<LineageImpactReport>(
      `/v1/lineage/impact?entityId=${encodeURIComponent(entityId)}&entityType=${encodeURIComponent(entityType)}`,
      'GET'
    );
  }
}
