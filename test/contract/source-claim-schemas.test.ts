import { describe, it, expect } from 'vitest';
import {
  RegisterSourceArtifactInputSchema,
  SourceArtifactDTOSchema,
  IngestSourceVersionInputSchema,
  SourceVersionDTOSchema,
  SourcePassageInputSchema,
  SourcePassageDTOSchema,
  SourceSnapshotDTOSchema,
  WebSourceIngestInputSchema,
  MaterialPropositionSchema,
  ClaimExtractionInputSchema,
  ClaimExtractionResultSchema,
  ClaimOccurrenceInputSchema,
  ClaimOccurrenceDTOSchema,
  ClaimCorrectionInputSchema,
  ClaimCorrectionDTOSchema,
  DuplicateConceptCandidateSchema
} from '../../packages/contracts/src/index.js';

describe('Source & Claim Intelligence Contracts (Contract)', () => {
  it('validates RegisterSourceArtifactInputSchema', () => {
    const valid = {
      originalUri: 'https://docs.proofmesh.io/arch.pdf',
      sourceType: 'pdf',
      title: 'ProofMesh Architecture',
      issuer: 'ProofMesh',
      mimeType: 'application/pdf',
      permissionContext: 'internal',
      retentionState: 'active',
      metadata: { release: '2026.1' }
    };

    const parsed = RegisterSourceArtifactInputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);

    const invalid = {
      originalUri: '', // min 1
      sourceType: 'unsupported_type',
      title: 'Doc'
    };
    expect(RegisterSourceArtifactInputSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates IngestSourceVersionInputSchema', () => {
    const valid = {
      sourceArtifactId: '00000000-0000-4000-8000-000000000001',
      contentHash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteSize: 1024,
      storageLocation: 'cas://e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      versionIdentifiers: { commit: '1a2b3c' },
      retrievalTimestamp: new Date().toISOString()
    };

    expect(IngestSourceVersionInputSchema.safeParse(valid).success).toBe(true);

    const invalidHash = {
      ...valid,
      contentHash: 'not-a-sha256'
    };
    expect(IngestSourceVersionInputSchema.safeParse(invalidHash).success).toBe(false);
  });

  it('validates SourcePassageInputSchema and SourcePassageDTOSchema', () => {
    const validPassage = {
      passageIndex: 0,
      contentText: 'This is the first extracted section.',
      contentHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      locator: { type: 'section', value: 'Overview' },
      extractionMethod: 'native_text'
    };

    expect(SourcePassageInputSchema.safeParse(validPassage).success).toBe(true);

    const validDTO = {
      ...validPassage,
      id: '00000000-0000-4000-8000-000000000002',
      tenantId: '00000000-0000-4000-8000-000000000003',
      sourceVersionId: '00000000-0000-4000-8000-000000000004',
      charStart: 0,
      charEnd: 36,
      ocrConfidence: null,
      createdAt: new Date().toISOString()
    };
    expect(SourcePassageDTOSchema.safeParse(validDTO).success).toBe(true);
  });

  it('validates SourceSnapshotDTOSchema', () => {
    const validSnapshot = {
      id: '00000000-0000-4000-8000-000000000005',
      tenantId: '00000000-0000-4000-8000-000000000006',
      snapshotHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      sourceVersionIds: ['00000000-0000-4000-8000-000000000007'],
      totalByteSize: 4096,
      manifest: { count: 1 },
      createdAt: new Date().toISOString()
    };
    expect(SourceSnapshotDTOSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it('validates ClaimExtractionInputSchema and ResultSchema', () => {
    const input = {
      sourceVersionId: '00000000-0000-4000-8000-000000000001',
      text: 'ProofMesh operates on PostgreSQL 16.',
      modelMetadata: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        version: '20241022'
      },
      promptTemplateVersion: 'v1.0.0'
    };
    expect(ClaimExtractionInputSchema.safeParse(input).success).toBe(true);

    const result = {
      extractionId: '00000000-0000-4000-8000-000000000008',
      sourceVersionId: '00000000-0000-4000-8000-000000000001',
      propositions: [
        {
          id: '00000000-0000-4000-8000-000000000009',
          propositionType: 'factual_claim',
          rawStatement: 'ProofMesh operates on PostgreSQL 16.',
          normalizedSubject: 'ProofMesh',
          normalizedPredicate: 'operates on',
          normalizedObject: 'PostgreSQL 16',
          normalizedUnit: null,
          qualifiers: { product: 'ProofMesh' },
          sourcePassageId: null,
          confidenceScore: 0.95,
          confidenceCategory: 'high'
        }
      ],
      coverageScore: 1.0,
      rejectedSegments: [],
      modelMetadata: input.modelMetadata,
      promptTemplateVersion: 'v1.0.0',
      extractedAt: new Date().toISOString()
    };
    expect(ClaimExtractionResultSchema.safeParse(result).success).toBe(true);
  });

  it('validates ClaimOccurrence and ClaimCorrection schemas', () => {
    const occInput = {
      claimVersionId: '00000000-0000-4000-8000-000000000010',
      exactPassageText: 'ProofMesh is certified SOC 2 Type II.'
    };
    expect(ClaimOccurrenceInputSchema.safeParse(occInput).success).toBe(true);

    const corrInput = {
      claimVersionId: '00000000-0000-4000-8000-000000000010',
      fieldName: 'normalizedUnit',
      originalValue: 'USD',
      correctedValue: 'EUR',
      correctionReason: 'Original text was EUR'
    };
    expect(ClaimCorrectionInputSchema.safeParse(corrInput).success).toBe(true);

    // Verify DTO and supporting schemas exist and parse valid types
    expect(SourceArtifactDTOSchema).toBeDefined();
    expect(SourceVersionDTOSchema).toBeDefined();
    expect(WebSourceIngestInputSchema).toBeDefined();
    expect(MaterialPropositionSchema).toBeDefined();
    expect(ClaimOccurrenceDTOSchema).toBeDefined();
    expect(ClaimCorrectionDTOSchema).toBeDefined();
    expect(DuplicateConceptCandidateSchema).toBeDefined();
  });
});
