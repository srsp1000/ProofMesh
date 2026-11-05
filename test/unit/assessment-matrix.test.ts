import { describe, it, expect } from 'vitest';
import { AssessmentMatrix } from '../../packages/domain/src/evidence/assessment-matrix.js';

describe('AssessmentMatrix (Unit)', () => {
  it('returns evaluating with zero confidence when no supporting evidence exists', () => {
    const result = AssessmentMatrix.evaluateAssessments([]);
    expect(result.recommendedClaimStatus).toBe('evaluating');
    expect(result.hasSupportingEvidence).toBe(false);
    expect(result.hasRefutingEvidence).toBe(false);
  });

  it('immediately flags claim as disputed when active refuting evidence is present', () => {
    const result = AssessmentMatrix.evaluateAssessments([
      {
        evidenceItemId: 'e-1',
        outcome: 'supports',
        applicability: 'direct',
        confidenceScore: 0.95
      },
      {
        evidenceItemId: 'e-2',
        outcome: 'refutes',
        applicability: 'direct',
        confidenceScore: 0.9
      }
    ]);

    expect(result.hasRefutingEvidence).toBe(true);
    expect(result.recommendedClaimStatus).toBe('disputed');
    expect(result.effectiveConfidence).toBe(0.0);
    expect(result.disputeReasons[0]).toContain('contested by 1 active refuting evidence');
  });

  it('calculates weighted confidence and recommends attested when threshold is met', () => {
    const result = AssessmentMatrix.evaluateAssessments([
      {
        evidenceItemId: 'e-1',
        outcome: 'supports',
        applicability: 'direct', // weight 1.0
        confidenceScore: 0.9
      },
      {
        evidenceItemId: 'e-2',
        outcome: 'supports',
        applicability: 'analogous', // weight 0.7
        confidenceScore: 0.85
      }
    ]);

    expect(result.hasRefutingEvidence).toBe(false);
    expect(result.hasSupportingEvidence).toBe(true);
    expect(result.effectiveConfidence).toBeGreaterThanOrEqual(0.85);
    expect(result.recommendedClaimStatus).toBe('attested');
  });

  it('ignores stale evidence assessments', () => {
    const result = AssessmentMatrix.evaluateAssessments([
      {
        evidenceItemId: 'e-old',
        outcome: 'refutes',
        applicability: 'direct',
        confidenceScore: 0.99,
        isStale: true // Should be ignored
      },
      {
        evidenceItemId: 'e-valid',
        outcome: 'supports',
        applicability: 'direct',
        confidenceScore: 0.92,
        isStale: false
      }
    ]);

    expect(result.hasRefutingEvidence).toBe(false);
    expect(result.recommendedClaimStatus).toBe('attested');
  });
});
