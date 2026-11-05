import { describe, it, expect } from 'vitest';
import { ClaimIntelligenceService } from '../../packages/domain/src/claims/claim-intelligence.js';

describe('ClaimIntelligenceService (Unit)', () => {
  const service = new ClaimIntelligenceService();

  describe('Proposition Classification', () => {
    it('classifies factual claims', () => {
      expect(service.classifyPropositionType('The database operates on PostgreSQL 16.')).toBe(
        'factual_claim'
      );
      expect(service.classifyPropositionType('ProofMesh was founded in 2024.')).toBe(
        'factual_claim'
      );
      expect(service.classifyPropositionType('The system generated 1000 audit events.')).toBe(
        'factual_claim'
      );
    });

    it('classifies opinions and subjective superlatives', () => {
      expect(
        service.classifyPropositionType('We believe our platform provides superior performance.')
      ).toBe('opinion');
      expect(
        service.classifyPropositionType('ProofMesh has the most intuitive governance dashboard.')
      ).toBe('opinion');
      expect(
        service.classifyPropositionType(
          'In our view, this approach offers delightful user experience.'
        )
      ).toBe('opinion');
    });

    it('classifies forecasts and future projections', () => {
      expect(service.classifyPropositionType('Revenue is expected to grow by 2026.')).toBe(
        'forecast'
      );
      expect(
        service.classifyPropositionType('Latency target for 2027 is projected to decrease.')
      ).toBe('forecast');
    });

    it('classifies commitments, guarantees, and SLAs', () => {
      expect(
        service.classifyPropositionType('We guarantee 99.99% uptime under our enterprise SLA.')
      ).toBe('commitment');
      expect(
        service.classifyPropositionType('ProofMesh pledges to refund unfulfilled commitments.')
      ).toBe('commitment');
    });

    it('classifies instructions and mandatory directives', () => {
      expect(service.classifyPropositionType('All administrators must enable MFA on login.')).toBe(
        'instruction'
      );
      expect(
        service.classifyPropositionType('Please ensure API keys are rotated every 90 days.')
      ).toBe('instruction');
    });
  });

  describe('Decomposition and SPO Normalization', () => {
    it('decomposes compound statements across conjunctions and sentence boundaries', () => {
      const compound =
        'ProofMesh is a governance platform; it operates on AWS; and ProofMesh guarantees high availability.';
      const clauses = service.decomposeCompoundStatements(compound);
      expect(clauses.length).toBeGreaterThanOrEqual(3);
    });

    it('normalizes Subject, Predicate, and Object accurately', () => {
      const spo = service.parseSubjectPredicateObject(
        'The platform provides real-time audit logging.'
      );
      expect(spo.subject).toBe('platform');
      expect(spo.predicate).toBe('provides');
      expect(spo.object).toBe('real-time audit logging');
    });

    it('extracts quantitative units correctly', () => {
      expect(service.extractUnit('The subscription costs $500 monthly.')).toBe('USD');
      expect(service.extractUnit('System availability exceeded 99.9 percent.')).toBe('percent');
      expect(service.extractUnit('Average latency was 45 ms per request.')).toBe('ms');
      expect(service.extractUnit('The platform currently serves 50000 users.')).toBe('users');
      expect(service.extractUnit('The policy is active indefinitely.')).toBeNull();
    });

    it('extracts qualifiers and strictly preserves null for missing dimensions', () => {
      const text = 'ProofMesh v1.2 operates in the EU region under the Enterprise tier.';
      const qualifiers = service.extractQualifiers(text);

      expect(qualifiers.product).toBe('ProofMesh');
      expect(qualifiers.version).toBe('1.2');
      expect(qualifiers.region).toBe('EU');
      expect(qualifiers.plan).toBe('enterprise');
      expect(qualifiers.temporal).toBeNull(); // null preserved!
    });
  });

  describe('Duplicate Concept Detection & Scope Separation', () => {
    const baseProposition = {
      id: 'prop-1',
      propositionType: 'factual_claim' as const,
      rawStatement: 'ProofMesh costs $100 in US for enterprise tier',
      normalizedSubject: 'proofmesh',
      normalizedPredicate: 'costs',
      normalizedObject: '$100 in US for enterprise tier',
      normalizedUnit: 'USD',
      qualifiers: {
        product: 'ProofMesh',
        version: null,
        region: 'US',
        plan: 'enterprise',
        temporal: null
      },
      sourcePassageId: null,
      confidenceScore: 0.95,
      confidenceCategory: 'high' as const
    };

    it('identifies identical concept with matching scopes as mergeable', () => {
      const existing = [
        {
          id: 'concept-1',
          conceptKey: 'proofmesh_costs_$100 in US for enterprise tier',
          qualifiers: { region: 'US', plan: 'enterprise' }
        }
      ];

      const candidates = service.detectDuplicateConcept(baseProposition, existing);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.canMerge).toBe(true);
      expect(candidates[0]?.scopeDifferences).toHaveLength(0);
    });

    it('strictly refuses to merge when scopes differ (e.g. region US vs EU)', () => {
      const existing = [
        {
          id: 'concept-2',
          conceptKey: 'proofmesh_costs_$100 in US for enterprise tier',
          qualifiers: { region: 'EU', plan: 'enterprise' } // Different region!
        }
      ];

      const candidates = service.detectDuplicateConcept(baseProposition, existing);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.canMerge).toBe(false);
      expect(candidates[0]?.scopeDifferences).toContain('region:US!=EU');
    });

    it('strictly refuses to merge when temporal qualifier differs', () => {
      const temporalProp = {
        ...baseProposition,
        qualifiers: { ...baseProposition.qualifiers, temporal: '2026' }
      };

      const existing = [
        {
          id: 'concept-3',
          conceptKey: 'proofmesh_costs_$100 in US for enterprise tier',
          qualifiers: { region: 'US', plan: 'enterprise', temporal: '2024' }
        }
      ];

      const candidates = service.detectDuplicateConcept(temporalProp, existing);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.canMerge).toBe(false);
      expect(candidates[0]?.scopeDifferences).toContain('temporal:2026!=2024');
    });
  });

  describe('End-to-End Extraction Pipeline', () => {
    it('extracts atomic material propositions with model metadata and coverage score', () => {
      const rawText =
        'ProofMesh operates in the US region. The platform costs $200 per month. ' +
        'Copyright 2026 ProofMesh Inc. All rights reserved.';

      const result = service.extractPropositions({
        text: rawText,
        sourceVersionId: '00000000-0000-4000-8000-000000000001',
        modelMetadata: {
          modelProvider: 'anthropic',
          modelName: 'claude-3-5-sonnet',
          modelVersion: '20241022',
          temperature: 0.0
        },
        promptTemplateVersion: 'v1.0.0'
      });

      expect(result.propositions.length).toBeGreaterThanOrEqual(1);
      expect(result.coverageScore).toBeGreaterThan(0);
      expect(result.rejectedSegments.some((r) => r.reason === 'disclaimer_or_boilerplate')).toBe(
        true
      );
      expect(result.modelMetadata.modelName).toBe('claude-3-5-sonnet');
    });
  });
});
