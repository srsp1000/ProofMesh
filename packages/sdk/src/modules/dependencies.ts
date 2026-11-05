import type { HttpClient } from '../http.js';
import type { DependencyDeclareInput, DependencyDTO } from '@proofmesh/contracts';

export class DependenciesModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Explicitly declares an evidence or prerequisite dependency between claims/entities.
   * This provides strong declared lineage rather than inferred telemetry correlation.
   */
  public async declare(input: DependencyDeclareInput): Promise<DependencyDTO> {
    return this.http.request<DependencyDTO>('/v1/dependencies', 'POST', input);
  }
}
