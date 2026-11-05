import crypto from 'node:crypto';
import type {
  RegisterSourceArtifactInput,
  SourceArtifactDTO,
  IngestSourceVersionInput,
  SourceVersionDTO,
  SourcePassageInput,
  SourcePassageDTO,
  SourceSnapshotDTO,
  SourceRetentionState
} from '@proofmesh/contracts';

export class SourceRegistryService {
  // In-memory backing stores for local operations & testing
  private readonly artifacts = new Map<string, SourceArtifactDTO>();
  private readonly versions = new Map<string, SourceVersionDTO>();
  private readonly passages = new Map<string, SourcePassageDTO>();
  private readonly snapshots = new Map<string, SourceSnapshotDTO>();
  private readonly contentStore = new Map<string, Buffer>(); // Content-Addressable Storage (CAS)

  /**
   * Registers a new source artifact in the registry.
   */
  public registerArtifact(
    tenantId: string,
    projectId: string,
    input: RegisterSourceArtifactInput
  ): SourceArtifactDTO {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const artifact: SourceArtifactDTO = {
      id,
      tenantId,
      projectId,
      originalUri: input.originalUri,
      resolvedUri: input.originalUri,
      sourceType: input.sourceType,
      title: input.title,
      issuer: input.issuer ?? null,
      mimeType: input.mimeType,
      permissionContext: input.permissionContext,
      retentionState: input.retentionState,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.artifacts.set(id, artifact);
    return artifact;
  }

  /**
   * Retrieves a source artifact by ID, ensuring tenant isolation.
   */
  public getArtifact(tenantId: string, artifactId: string): SourceArtifactDTO | null {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.tenantId !== tenantId) {
      return null;
    }
    return artifact;
  }

  /**
   * Ingests a new immutable source version with cryptographic content hash.
   */
  public createSourceVersion(
    tenantId: string,
    input: IngestSourceVersionInput,
    rawContent?: Buffer
  ): SourceVersionDTO {
    const artifact = this.getArtifact(tenantId, input.sourceArtifactId);
    if (!artifact) {
      throw new Error(
        `Source artifact '${input.sourceArtifactId}' not found for tenant '${tenantId}'`
      );
    }

    // Verify content hash if raw content is provided
    if (rawContent) {
      const computedHash = `sha256:${crypto.createHash('sha256').update(rawContent).digest('hex')}`;
      if (computedHash !== input.contentHash) {
        throw new Error(
          `Content hash mismatch: expected '${input.contentHash}', calculated '${computedHash}'`
        );
      }
      this.contentStore.set(computedHash, rawContent);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const version: SourceVersionDTO = {
      id,
      tenantId,
      sourceArtifactId: input.sourceArtifactId,
      versionHash: input.contentHash,
      byteSize: input.byteSize,
      storageLocation: input.storageLocation,
      versionIdentifiers: input.versionIdentifiers ?? {},
      publicationDate: input.publicationDate ?? null,
      retrievalTimestamp: input.retrievalTimestamp,
      httpValidators: input.httpValidators ?? null,
      extractionStatus: 'completed',
      parserMetadata: input.parserMetadata ?? {},
      capturedAt: input.retrievalTimestamp,
      recordedAt: now
    };

    this.versions.set(id, version);
    return version;
  }

  /**
   * Retrieves a source version by ID with tenant isolation.
   */
  public getVersion(tenantId: string, versionId: string): SourceVersionDTO | null {
    const version = this.versions.get(versionId);
    if (!version || version.tenantId !== tenantId) {
      return null;
    }
    return version;
  }

  /**
   * Ingests an addressable passage within a source version.
   */
  public createPassage(
    tenantId: string,
    sourceVersionId: string,
    input: SourcePassageInput
  ): SourcePassageDTO {
    const version = this.getVersion(tenantId, sourceVersionId);
    if (!version) {
      throw new Error(`Source version '${sourceVersionId}' not found for tenant '${tenantId}'`);
    }

    const id = crypto.randomUUID();
    const contentHash =
      input.contentHash ??
      `sha256:${crypto.createHash('sha256').update(input.contentText).digest('hex')}`;

    const passage: SourcePassageDTO = {
      id,
      tenantId,
      sourceVersionId,
      passageIndex: input.passageIndex,
      contentText: input.contentText,
      contentHash,
      charStart: input.charStart ?? null,
      charEnd: input.charEnd ?? null,
      locator: input.locator,
      extractionMethod: input.extractionMethod,
      ocrConfidence: input.ocrConfidence ?? null,
      createdAt: new Date().toISOString()
    };

    this.passages.set(id, passage);
    return passage;
  }

  /**
   * Retrieves passages for a source version.
   */
  public getPassagesForVersion(tenantId: string, sourceVersionId: string): SourcePassageDTO[] {
    const version = this.getVersion(tenantId, sourceVersionId);
    if (!version) {
      return [];
    }
    return Array.from(this.passages.values()).filter(
      (p) => p.tenantId === tenantId && p.sourceVersionId === sourceVersionId
    );
  }

  /**
   * Creates an immutable source snapshot representing an evaluation manifest.
   */
  public createSnapshot(tenantId: string, sourceVersionIds: string[]): SourceSnapshotDTO {
    const validVersions: SourceVersionDTO[] = [];
    let totalBytes = 0;

    for (const vid of sourceVersionIds) {
      const v = this.getVersion(tenantId, vid);
      if (!v) {
        throw new Error(`Cannot include version '${vid}' in snapshot: not found or unauthorized`);
      }
      validVersions.push(v);
      totalBytes += v.byteSize;
    }

    // Compute canonical snapshot hash from sorted version hashes
    const sortedHashes = validVersions
      .map((v) => v.versionHash)
      .sort()
      .join(';');
    const snapshotHash = `sha256:${crypto.createHash('sha256').update(sortedHashes).digest('hex')}`;

    const id = crypto.randomUUID();
    const snapshot: SourceSnapshotDTO = {
      id,
      tenantId,
      snapshotHash,
      sourceVersionIds,
      totalByteSize: totalBytes,
      manifest: {
        versionCount: validVersions.length,
        versionDetails: validVersions.map((v) => ({
          id: v.id,
          sourceArtifactId: v.sourceArtifactId,
          hash: v.versionHash,
          size: v.byteSize
        }))
      },
      createdAt: new Date().toISOString()
    };

    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  /**
   * Updates retention state for a source artifact (soft deletion, legal hold, purge).
   */
  public updateRetentionState(
    tenantId: string,
    artifactId: string,
    newState: SourceRetentionState,
    _reason: string
  ): SourceArtifactDTO {
    const artifact = this.getArtifact(tenantId, artifactId);
    if (!artifact) {
      throw new Error(`Source artifact '${artifactId}' not found for tenant '${tenantId}'`);
    }

    // Legal hold prevents purging or soft-deletion
    if (artifact.retentionState === 'legal_hold' && newState !== 'legal_hold') {
      throw new Error(
        `Cannot change retention state of artifact under 'legal_hold' without formal release`
      );
    }

    artifact.retentionState = newState;
    artifact.updatedAt = new Date().toISOString();
    this.artifacts.set(artifactId, artifact);
    return artifact;
  }

  /**
   * Retrieves raw content from Content-Addressable Storage (CAS).
   */
  public getRawContent(contentHash: string): Buffer | null {
    return this.contentStore.get(contentHash) ?? null;
  }
}
