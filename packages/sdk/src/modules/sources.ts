import type { HttpClient } from '../http.js';
import type {
  RegisterSourceArtifactInput,
  SourceArtifactDTO,
  IngestSourceVersionInput,
  SourceVersionDTO,
  SourcePassageInput,
  SourcePassageDTO,
  SourceSnapshotDTO,
  SourceRetentionState,
  WebSourceIngestInput
} from '@proofmesh/contracts';

export interface IngestFileInput {
  filename: string;
  contentBase64: string;
  permissionContext?: 'public' | 'internal' | 'confidential' | 'restricted';
  projectId?: string;
  originalUri?: string;
}

export interface IngestFileResponse {
  artifact: SourceArtifactDTO;
  version: SourceVersionDTO;
  passages: SourcePassageDTO[];
  extractedTextLength: number;
  warnings: string[];
}

export interface IngestWebResponse {
  artifact: SourceArtifactDTO;
  version: SourceVersionDTO;
  passages: SourcePassageDTO[];
  resolvedUrl: string;
  httpValidators: {
    etag?: string;
    lastModified?: string;
    cacheControl?: string;
  };
}

export class SourcesModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Registers a source artifact in the registry.
   */
  public async registerArtifact(input: RegisterSourceArtifactInput): Promise<SourceArtifactDTO> {
    return this.http.request<SourceArtifactDTO>('/v1/sources/artifacts', 'POST', input);
  }

  /**
   * Retrieves a source artifact by ID.
   */
  public async getArtifact(artifactId: string): Promise<SourceArtifactDTO> {
    return this.http.request<SourceArtifactDTO>(`/v1/sources/artifacts/${artifactId}`, 'GET');
  }

  /**
   * Updates retention state for a source artifact (soft delete, legal hold, purge).
   */
  public async updateRetention(
    artifactId: string,
    retentionState: SourceRetentionState,
    reason: string
  ): Promise<SourceArtifactDTO> {
    return this.http.request<SourceArtifactDTO>(
      `/v1/sources/artifacts/${artifactId}/retention`,
      'PATCH',
      { retentionState, reason }
    );
  }

  /**
   * Ingests a new source version.
   */
  public async createVersion(input: IngestSourceVersionInput): Promise<SourceVersionDTO> {
    return this.http.request<SourceVersionDTO>('/v1/sources/versions', 'POST', input);
  }

  /**
   * Retrieves a source version by ID.
   */
  public async getVersion(versionId: string): Promise<SourceVersionDTO> {
    return this.http.request<SourceVersionDTO>(`/v1/sources/versions/${versionId}`, 'GET');
  }

  /**
   * Ingests an addressable passage for a source version.
   */
  public async createPassage(
    versionId: string,
    input: SourcePassageInput
  ): Promise<SourcePassageDTO> {
    return this.http.request<SourcePassageDTO>(
      `/v1/sources/versions/${versionId}/passages`,
      'POST',
      input
    );
  }

  /**
   * Retrieves all passages for a source version.
   */
  public async getPassages(
    versionId: string
  ): Promise<{ passages: SourcePassageDTO[]; count: number }> {
    return this.http.request<{ passages: SourcePassageDTO[]; count: number }>(
      `/v1/sources/versions/${versionId}/passages`,
      'GET'
    );
  }

  /**
   * Uploads and safely ingests a binary or text document with magic-bytes detection and parsing.
   */
  public async ingestFile(input: IngestFileInput): Promise<IngestFileResponse> {
    return this.http.request<IngestFileResponse>('/v1/sources/ingest/file', 'POST', input);
  }

  /**
   * Ingests a web URL with SSRF protection, DNS rebinding defense, and HTTP validator tracking.
   */
  public async ingestWeb(input: WebSourceIngestInput): Promise<IngestWebResponse> {
    return this.http.request<IngestWebResponse>('/v1/sources/ingest/web', 'POST', input);
  }

  /**
   * Creates an immutable source snapshot manifest across multiple source versions.
   */
  public async createSnapshot(sourceVersionIds: string[]): Promise<SourceSnapshotDTO> {
    return this.http.request<SourceSnapshotDTO>('/v1/sources/snapshots', 'POST', {
      sourceVersionIds
    });
  }
}
