import { describe, it, expect } from 'vitest';
import {
  ContextPacketCreateInputSchema,
  ContextPacketDTOSchema,
  DependencyDeclareInputSchema,
  DependencyDTOSchema,
  DecisionRegisterInputSchema,
  DecisionDTOSchema,
  AdmissibilityCheckResultSchema,
  HumanReviewRequestInputSchema,
  HumanReviewDTOSchema,
  LineageImpactReportSchema
} from '@proofmesh/sdk';

describe('SDK Contracts & Schema Validation', () => {
  it('validates ContextPacket schemas', () => {
    const input = {
      packetType: 'rag_retrieval' as const,
      passages: [
        {
          passageId: '12345678-1234-5678-1234-567812345678',
          content: 'Verified evidence chunk',
          contentHash: `sha256:${'a'.repeat(64)}`,
          score: 0.95
        }
      ],
      totalTokens: 120
    };
    const parsedInput = ContextPacketCreateInputSchema.parse(input);
    expect(parsedInput.packetType).toBe('rag_retrieval');
    expect(parsedInput.passages).toHaveLength(1);

    const dto = {
      id: '12345678-1234-5678-1234-567812345679',
      tenantId: '12345678-1234-5678-1234-567812345680',
      packetType: 'rag_retrieval' as const,
      passages: [
        {
          passageId: '12345678-1234-5678-1234-567812345678',
          content: 'Verified evidence chunk',
          contentHash: `sha256:${'a'.repeat(64)}`,
          score: 0.95
        }
      ],
      totalTokens: 120,
      createdAt: '2026-11-05T12:00:00Z'
    };
    expect(ContextPacketDTOSchema.safeParse(dto).success).toBe(true);
  });

  it('validates Dependency schemas', () => {
    const input = {
      dependentEntityId: '12345678-1234-5678-1234-567812345678',
      dependentEntityType: 'claim' as const,
      prerequisiteEntityId: '12345678-1234-5678-1234-567812345679',
      prerequisiteEntityType: 'claim' as const,
      relationshipType: 'supports' as const,
      declarationReason: 'Grounding text citation'
    };
    const parsedInput = DependencyDeclareInputSchema.parse(input);
    expect(parsedInput.relationshipType).toBe('supports');

    const dto = {
      id: '12345678-1234-5678-1234-567812345680',
      tenantId: '12345678-1234-5678-1234-567812345681',
      dependentEntityId: input.dependentEntityId,
      dependentEntityType: 'claim' as const,
      prerequisiteEntityId: input.prerequisiteEntityId,
      prerequisiteEntityType: 'claim' as const,
      relationshipType: 'supports' as const,
      declarationReason: 'Grounding text citation',
      declaredAt: '2026-11-05T12:00:00Z'
    };
    expect(DependencyDTOSchema.safeParse(dto).success).toBe(true);
  });

  it('validates Decision and Admissibility schemas', () => {
    const decisionInput = {
      decisionType: 'credit_decision',
      outcome: 'approved' as const,
      rationale: 'All risk criteria satisfied',
      contributingClaimIds: ['12345678-1234-5678-1234-567812345678'],
      admissibilityStatus: 'admissible' as const
    };
    expect(DecisionRegisterInputSchema.safeParse(decisionInput).success).toBe(true);

    const decisionDTO = {
      id: '12345678-1234-5678-1234-567812345680',
      tenantId: '12345678-1234-5678-1234-567812345681',
      decisionType: decisionInput.decisionType,
      outcome: decisionInput.outcome,
      rationale: decisionInput.rationale,
      contributingClaimIds: decisionInput.contributingClaimIds,
      policyVersionId: null,
      admissibilityStatus: decisionInput.admissibilityStatus,
      registeredAt: '2026-11-05T12:00:00Z'
    };
    expect(DecisionDTOSchema.safeParse(decisionDTO).success).toBe(true);

    const checkResult = {
      evaluationId: '12345678-1234-5678-1234-567812345679',
      claimVersionId: '12345678-1234-5678-1234-567812345678',
      disposition: 'admit' as const,
      isAdmissible: true,
      rulesTriggered: ['rule:credit_score_above_700'],
      reasons: ['Score satisfies threshold'],
      evaluatedAt: '2026-11-05T12:00:00Z'
    };
    expect(AdmissibilityCheckResultSchema.safeParse(checkResult).success).toBe(true);
  });

  it('validates HumanReview and LineageImpact schemas', () => {
    const reviewInput = {
      title: 'Underwriting Override Request',
      summary: 'Applicant requested manual loan review',
      requiredRole: 'compliance_officer',
      priority: 'high' as const
    };
    expect(HumanReviewRequestInputSchema.safeParse(reviewInput).success).toBe(true);

    const reviewDTO = {
      id: '12345678-1234-5678-1234-567812345682',
      tenantId: '12345678-1234-5678-1234-567812345683',
      title: reviewInput.title,
      summary: reviewInput.summary,
      requiredRole: reviewInput.requiredRole,
      status: 'pending' as const,
      priority: reviewInput.priority,
      requestedAt: '2026-11-05T12:00:00Z'
    };
    expect(HumanReviewDTOSchema.safeParse(reviewDTO).success).toBe(true);

    const impact = {
      rootEntityId: '12345678-1234-5678-1234-567812345678',
      rootEntityType: 'claim' as const,
      directDependentsCount: 1,
      totalDownstreamAffectedCount: 1,
      affectedDecisions: [
        {
          decisionId: '12345678-1234-5678-1234-567812345679',
          decisionType: 'credit_decision',
          outcome: 'approved' as const
        }
      ],
      affectedClaims: [],
      generatedAt: '2026-11-05T12:00:00Z'
    };
    expect(LineageImpactReportSchema.safeParse(impact).success).toBe(true);
  });
});
