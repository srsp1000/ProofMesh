import type { HttpClient } from '../http.js';
import type { HumanReviewRequestInput, HumanReviewDTO } from '@proofmesh/contracts';

export class ReviewsModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Submits a formal human review case for manual sign-off or escalation.
   */
  public async request(input: HumanReviewRequestInput): Promise<HumanReviewDTO> {
    return this.http.request<HumanReviewDTO>('/v1/reviews', 'POST', input);
  }

  /**
   * Retrieves a human review case by ID.
   */
  public async get(reviewId: string): Promise<HumanReviewDTO> {
    return this.http.request<HumanReviewDTO>(`/v1/reviews/${reviewId}`, 'GET');
  }
}
