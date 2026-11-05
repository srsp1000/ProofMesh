import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { SourceRegistryService } from '../../packages/domain/src/sources/source-registry.js';

describe('SourceRegistryService (Unit)', () => {
  const tenantA = '11111111-1111-4000-8000-111111111111';
  const tenantB = '22222222-2222-4000-8000-222222222222';
  const projectId = '33333333-3333-4000-8000-333333333333';

  it('registers source artifacts with correct properties', () => {
    const registry = new SourceRegistryService();
    const artifact = registry.registerArtifact(tenantA, projectId, {
      originalUri: 'https://proofmesh.io/security-whitepaper.pdf',
      sourceType: 'pdf',
      title: 'Security Whitepaper 2026',
      issuer: 'ProofMesh Governance',
      mimeType: 'application/pdf',
      permissionContext: 'internal',
      retentionState: 'active',
      metadata: { department: 'compliance' }
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.tenantId).toBe(tenantA);
    expect(artifact.projectId).toBe(projectId);
    expect(artifact.sourceType).toBe('pdf');
    expect(artifact.retentionState).toBe('active');
    expect(artifact.metadata).toEqual({ department: 'compliance' });

    const fetched = registry.getArtifact(tenantA, artifact.id);
    expect(fetched).toEqual(artifact);
  });

  it('enforces multi-tenant isolation on artifact retrieval', () => {
    const registry = new SourceRegistryService();
    const artifact = registry.registerArtifact(tenantA, projectId, {
      originalUri: 'https://acme.org/report.pdf',
      sourceType: 'pdf',
      title: 'Acme Report',
      mimeType: 'application/pdf',
      permissionContext: 'restricted',
      retentionState: 'active',
      metadata: {}
    });

    // Cross-tenant access must return null
    const crossTenant = registry.getArtifact(tenantB, artifact.id);
    expect(crossTenant).toBeNull();
  });

  it('verifies cryptographic content hash on version creation and stores in CAS', () => {
    const registry = new SourceRegistryService();
    const artifact = registry.registerArtifact(tenantA, projectId, {
      originalUri: 'https://proofmesh.io/doc.txt',
      sourceType: 'plain_text',
      title: 'Test Doc',
      mimeType: 'text/plain',
      permissionContext: 'internal',
      retentionState: 'active',
      metadata: {}
    });

    const rawBuffer = Buffer.from('ProofMesh Authoritative Baseline Content');
    const correctHash = `sha256:${crypto.createHash('sha256').update(rawBuffer).digest('hex')}`;

    const version = registry.createSourceVersion(
      tenantA,
      {
        sourceArtifactId: artifact.id,
        contentHash: correctHash,
        byteSize: rawBuffer.length,
        storageLocation: `cas://${correctHash}`,
        versionIdentifiers: { gitCommit: 'abcdef1' },
        retrievalTimestamp: new Date().toISOString(),
        parserMetadata: {}
      },
      rawBuffer
    );

    expect(version.id).toBeDefined();
    expect(version.versionHash).toBe(correctHash);

    // Verify raw CAS storage
    const stored = registry.getRawContent(correctHash);
    expect(stored).toBeDefined();
    expect(stored?.toString('utf-8')).toBe('ProofMesh Authoritative Baseline Content');

    // Content hash mismatch must throw error
    expect(() =>
      registry.createSourceVersion(
        tenantA,
        {
          sourceArtifactId: artifact.id,
          contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          byteSize: rawBuffer.length,
          storageLocation: 'cas://tampered',
          versionIdentifiers: {},
          retrievalTimestamp: new Date().toISOString(),
          parserMetadata: {}
        },
        rawBuffer
      )
    ).toThrow(/Content hash mismatch/);
  });

  it('manages addressable passages with page and section locators', () => {
    const registry = new SourceRegistryService();
    const artifact = registry.registerArtifact(tenantA, projectId, {
      originalUri: 'https://example.com/guide.md',
      sourceType: 'markdown',
      title: 'Guide',
      mimeType: 'text/markdown',
      permissionContext: 'public',
      retentionState: 'active',
      metadata: {}
    });

    const version = registry.createSourceVersion(tenantA, {
      sourceArtifactId: artifact.id,
      contentHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      byteSize: 500,
      storageLocation: 'cas://dummy',
      versionIdentifiers: {},
      retrievalTimestamp: new Date().toISOString(),
      parserMetadata: {}
    });

    const passage1 = registry.createPassage(tenantA, version.id, {
      passageIndex: 0,
      contentText: 'First section of the document.',
      locator: { type: 'section', value: 'Introduction' },
      extractionMethod: 'native_text'
    });

    const passage2 = registry.createPassage(tenantA, version.id, {
      passageIndex: 1,
      contentText: 'Second section detailing specifications.',
      locator: { type: 'page', value: 2 },
      extractionMethod: 'ocr',
      ocrConfidence: 0.94
    });

    const passages = registry.getPassagesForVersion(tenantA, version.id);
    expect(passage1.id).toBeDefined();
    expect(passage2.id).toBeDefined();
    expect(passages).toHaveLength(2);
    expect(passages[0]?.locator).toEqual({ type: 'section', value: 'Introduction' });
    expect(passages[1]?.ocrConfidence).toBe(0.94);
  });

  it('creates deterministic source snapshot manifest', () => {
    const registry = new SourceRegistryService();
    const artifact = registry.registerArtifact(tenantA, projectId, {
      originalUri: 'https://example.com/data.json',
      sourceType: 'structured_record',
      title: 'Data',
      mimeType: 'application/json',
      permissionContext: 'internal',
      retentionState: 'active',
      metadata: {}
    });

    const v1 = registry.createSourceVersion(tenantA, {
      sourceArtifactId: artifact.id,
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      byteSize: 1024,
      storageLocation: 'cas://v1',
      versionIdentifiers: { version: '1.0' },
      retrievalTimestamp: new Date().toISOString(),
      parserMetadata: {}
    });

    const v2 = registry.createSourceVersion(tenantA, {
      sourceArtifactId: artifact.id,
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      byteSize: 2048,
      storageLocation: 'cas://v2',
      versionIdentifiers: { version: '2.0' },
      retrievalTimestamp: new Date().toISOString(),
      parserMetadata: {}
    });

    const snapshot = registry.createSnapshot(tenantA, [v1.id, v2.id]);
    expect(snapshot.id).toBeDefined();
    expect(snapshot.totalByteSize).toBe(3072);
    expect(snapshot.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Creating another snapshot with reversed version order produces identical snapshotHash
    const snapshotReversed = registry.createSnapshot(tenantA, [v2.id, v1.id]);
    expect(snapshotReversed.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it('enforces legal hold protection on retention state changes', () => {
    const registry = new SourceRegistryService();
    const artifact = registry.registerArtifact(tenantA, projectId, {
      originalUri: 'https://example.com/financials.pdf',
      sourceType: 'pdf',
      title: 'Financials',
      mimeType: 'application/pdf',
      permissionContext: 'confidential',
      retentionState: 'active',
      metadata: {}
    });

    // Place on legal hold
    registry.updateRetentionState(tenantA, artifact.id, 'legal_hold', 'Pending subpoena');
    const onHold = registry.getArtifact(tenantA, artifact.id);
    expect(onHold?.retentionState).toBe('legal_hold');

    // Attempting to purge or soft_delete while on legal hold must throw
    expect(() =>
      registry.updateRetentionState(tenantA, artifact.id, 'purged', 'Routine cleanup')
    ).toThrow(/legal_hold/);

    expect(() =>
      registry.updateRetentionState(tenantA, artifact.id, 'soft_deleted', 'User requested delete')
    ).toThrow(/legal_hold/);
  });
});
