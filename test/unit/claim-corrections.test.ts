import { describe, it, expect } from 'vitest';
import { ClaimCorrectionService } from '../../packages/domain/src/claims/claim-corrections.js';

describe('ClaimCorrectionService (Unit)', () => {
  const service = new ClaimCorrectionService();
  const tenantA = '11111111-1111-4000-8000-111111111111';
  const tenantB = '22222222-2222-4000-8000-222222222222';
  const claimVersionId = 'aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa';
  const principalId = 'pppppppp-pppp-4000-8000-pppppppppppp';

  describe('Claim Occurrences', () => {
    it('records immutable claim occurrence in a source passage', () => {
      const occurrence = service.recordOccurrence(tenantA, {
        claimVersionId,
        sourceVersionId: 'sv-1111',
        sourcePassageId: 'sp-2222',
        exactPassageText: 'The platform costs $500 monthly.',
        charStart: 10,
        charEnd: 42
      });

      expect(occurrence.id).toBeDefined();
      expect(occurrence.tenantId).toBe(tenantA);
      expect(occurrence.claimVersionId).toBe(claimVersionId);
      expect(occurrence.exactPassageText).toBe('The platform costs $500 monthly.');
      expect(occurrence.recordedAt).toBeDefined();

      const occurrences = service.getOccurrences(tenantA, claimVersionId);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]?.id).toBe(occurrence.id);
    });

    it('enforces tenant isolation when retrieving claim occurrences', () => {
      // Querying with tenantB should return empty
      const occurrencesB = service.getOccurrences(tenantB, claimVersionId);
      expect(occurrencesB).toHaveLength(0);
    });
  });

  describe('Human Corrections & Audit Trail', () => {
    it('submits a valid human correction for normalizedUnit', () => {
      const correction = service.submitCorrection(tenantA, principalId, {
        claimVersionId,
        fieldName: 'normalizedUnit',
        originalValue: 'USD',
        correctedValue: 'EUR',
        correctionReason: 'Original passage explicitly listed pricing in Euros.'
      });

      expect(correction.id).toBeDefined();
      expect(correction.correctedByPrincipalId).toBe(principalId);
      expect(correction.fieldName).toBe('normalizedUnit');
      expect(correction.originalValue).toBe('USD');
      expect(correction.correctedValue).toBe('EUR');
      expect(correction.correctionReason).toBe(
        'Original passage explicitly listed pricing in Euros.'
      );

      const auditTrail = service.getCorrections(tenantA, claimVersionId);
      expect(auditTrail).toHaveLength(1);
      expect(auditTrail[0]?.id).toBe(correction.id);
    });

    it('rejects correction if field is not allowed for manual correction', () => {
      expect(() =>
        service.submitCorrection(tenantA, principalId, {
          claimVersionId,
          fieldName: 'arbitraryInternalField',
          originalValue: 'foo',
          correctedValue: 'bar',
          correctionReason: 'test'
        })
      ).toThrow(/not eligible for manual correction/);
    });

    it('rejects correction if original and corrected values are identical', () => {
      expect(() =>
        service.submitCorrection(tenantA, principalId, {
          claimVersionId,
          fieldName: 'normalizedSubject',
          originalValue: 'ProofMesh',
          correctedValue: 'ProofMesh',
          correctionReason: 'no-op edit'
        })
      ).toThrow(/Corrected value must differ from the original value/);
    });

    it('rejects correction if rationale is missing or whitespace', () => {
      expect(() =>
        service.submitCorrection(tenantA, principalId, {
          claimVersionId,
          fieldName: 'normalizedPredicate',
          originalValue: 'is',
          correctedValue: 'provides',
          correctionReason: '   '
        })
      ).toThrow(/Correction reason is mandatory/);
    });
  });
});
