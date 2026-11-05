import type { HttpClient } from '../http.js';
import type { DecisionRegisterInput, DecisionDTO } from '@proofmesh/contracts';

export class DecisionsModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Registers an authoritative business or policy decision with its rationale and contributing claims.
   */
  public async register(input: DecisionRegisterInput): Promise<DecisionDTO> {
    return this.http.request<DecisionDTO>('/v1/decisions', 'POST', input);
  }

  /**
   * Retrieves a decision by ID.
   */
  public async get(decisionId: string): Promise<DecisionDTO> {
    return this.http.request<DecisionDTO>(`/v1/decisions/${decisionId}`, 'GET');
  }
}
