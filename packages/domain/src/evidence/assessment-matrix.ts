import type { EvidenceOutcome, EvidenceApplicability } from '@proofmesh/contracts';

export interface AssessmentItem {
  evidenceItemId: string;
  outcome: EvidenceOutcome;
  applicability: EvidenceApplicability;
  confidenceScore: number;
  isStale?: boolean;
}

export interface AssessmentMatrixResult {
  hasRefutingEvidence: boolean;
  hasSupportingEvidence: boolean;
  effectiveConfidence: number;
  recommendedClaimStatus: 'evaluating' | 'attested' | 'disputed';
  disputeReasons: string[];
}

export class AssessmentMatrix {
  public static evaluateAssessments(assessments: AssessmentItem[]): AssessmentMatrixResult {
    const active = assessments.filter((a) => !a.isStale && a.applicability !== 'inapplicable');
    const refutations = active.filter((a) => a.outcome === 'refutes');
    const supports = active.filter((a) => a.outcome === 'supports');

    const hasRefuting = refutations.length > 0;
    const hasSupporting = supports.length > 0;

    const disputeReasons: string[] = [];

    if (hasRefuting) {
      disputeReasons.push(
        `Claim contested by ${refutations.length} active refuting evidence item(s).`
      );
      return {
        hasRefutingEvidence: true,
        hasSupportingEvidence: hasSupporting,
        effectiveConfidence: 0.0,
        recommendedClaimStatus: 'disputed',
        disputeReasons
      };
    }

    if (!hasSupporting) {
      return {
        hasRefutingEvidence: false,
        hasSupportingEvidence: false,
        effectiveConfidence: 0.0,
        recommendedClaimStatus: 'evaluating',
        disputeReasons: ['Insufficient supporting evidence.']
      };
    }

    // Weighted confidence calculation: direct evidence has weight 1.0, analogous 0.7, contextual 0.4
    const weights: Record<EvidenceApplicability, number> = {
      direct: 1.0,
      analogous: 0.7,
      contextual: 0.4,
      inapplicable: 0.0
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const item of supports) {
      const w = weights[item.applicability];
      totalWeight += w;
      weightedSum += item.confidenceScore * w;
    }

    const effectiveConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
      hasRefutingEvidence: false,
      hasSupportingEvidence: true,
      effectiveConfidence: Number(effectiveConfidence.toFixed(4)),
      recommendedClaimStatus: effectiveConfidence >= 0.85 ? 'attested' : 'evaluating',
      disputeReasons
    };
  }
}
