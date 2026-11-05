import { describe, it, expect } from 'vitest';
import {
  SubmitClaimSchema,
  TransitionClaimSchema,
  createProblemDetails,
  ProblemDetailsSchema
} from '../../packages/contracts/src/index.js';

describe('Claim Schemas & Error Envelope (Contract)', () => {
  it('validates a correct SubmitClaim payload', () => {
    const payload = {
      claimConceptKey: 'risk-assessment',
      statement: 'Low default risk.',
      qualifiers: { score: 98 }
    };

    const result = SubmitClaimSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects an empty statement in SubmitClaim', () => {
    const result = SubmitClaimSchema.safeParse({
      claimConceptKey: 'risk-assessment',
      statement: ''
    });

    expect(result.success).toBe(false);
  });

  it('validates RFC 7807 problem details structure', () => {
    const problem = createProblemDetails({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      title: 'Invalid State Transition',
      detail: 'Cannot transition from rejected to attested.',
      instance: '/v1/claims/c-123/transition'
    });

    expect(problem.status).toBe(409);
    expect(problem.code).toBe('INVALID_STATE_TRANSITION');
    expect(problem.type).toBe('https://proofmesh.io/errors/invalid-state-transition');

    const parsed = ProblemDetailsSchema.safeParse(problem);
    expect(parsed.success).toBe(true);
  });

  it('validates TransitionClaimSchema payload', () => {
    const valid = TransitionClaimSchema.safeParse({
      targetState: 'attested',
      transitionReason: 'Dual review passed.'
    });
    expect(valid.success).toBe(true);

    const invalid = TransitionClaimSchema.safeParse({
      targetState: 'non_existent_status',
      transitionReason: 'Testing'
    });
    expect(invalid.success).toBe(false);
  });
});
