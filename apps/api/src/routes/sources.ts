import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  RegisterSourceArtifactInputSchema,
  IngestSourceVersionInputSchema,
  SourcePassageInputSchema,
  WebSourceIngestInputSchema,
  SourceRetentionStateEnum,
  createProblemDetails
} from '@proofmesh/contracts';
import {
  SourceRegistryService,
  SafeDocumentIngestionService,
  WebSourceIngestionService
} from '@proofmesh/domain';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import type { GatewayService } from '../gateway/service.js';

export interface SourceRouteOptions extends Partial<AuthMiddlewareDependencies> {
  gatewayService?: GatewayService;
  sourceRegistry?: SourceRegistryService;
}

const FileIngestInputSchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1),
  sourceType: z.enum(['pdf', 'docx', 'markdown', 'text', 'structured_record']).optional(),
  permissionContext: z
    .enum(['public', 'internal', 'confidential', 'restricted'])
    .default('internal'),
  projectId: z.string().uuid().default('00000000-0000-4000-8000-000000000001'),
  originalUri: z.string().optional()
});

const UpdateRetentionSchema = z.object({
  retentionState: SourceRetentionStateEnum,
  reason: z.string().min(1).max(500)
});

const CreateSnapshotSchema = z.object({
  sourceVersionIds: z.array(z.string().uuid()).min(1)
});

export const sourceRoutes: FastifyPluginAsync<SourceRouteOptions> = async (fastify, options) => {
  const authMiddleware =
    options.jwtSigner && options.identityRepo && options.authRepo && options.auditRepo
      ? createAuthMiddleware(options as AuthMiddlewareDependencies)
      : null;

  const registry = options.sourceRegistry ?? new SourceRegistryService();
  const safeParser = new SafeDocumentIngestionService();
  const webIngester = new WebSourceIngestionService();

  // 1. Register Source Artifact
  fastify.post('/v1/sources/artifacts', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = RegisterSourceArtifactInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Source Artifact Payload',
          detail: 'Source artifact registration failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const projectId =
      (request.body as { projectId?: string }).projectId ?? '00000000-0000-4000-8000-000000000001';
    const artifact = registry.registerArtifact(tenantId, projectId, parseResult.data);
    return reply.status(201).send(artifact);
  });

  // 2. Lookup Source Artifact
  fastify.get(
    '/v1/sources/artifacts/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const artifact = registry.getArtifact(tenantId, request.params.id);
      if (!artifact) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'SOURCE_ARTIFACT_NOT_FOUND',
            title: 'Source Artifact Not Found',
            detail: `Source artifact '${request.params.id}' does not exist or belongs to another tenant.`
          })
        );
      }

      return reply.status(200).send(artifact);
    }
  );

  // 3. Update Retention State
  fastify.patch(
    '/v1/sources/artifacts/:id/retention',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const parseResult = UpdateRetentionSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Invalid Retention Update Payload',
            detail: 'Retention update failed schema validation.'
          })
        );
      }

      try {
        const updated = registry.updateRetentionState(
          tenantId,
          request.params.id,
          parseResult.data.retentionState,
          parseResult.data.reason
        );
        return reply.status(200).send(updated);
      } catch (err) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'RETENTION_UPDATE_FAILED',
            title: 'Retention Update Failed',
            detail: (err as Error).message
          })
        );
      }
    }
  );

  // 4. Ingest Source Version
  fastify.post('/v1/sources/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = IngestSourceVersionInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Source Version Payload',
          detail: 'Source version ingestion failed schema validation.'
        })
      );
    }

    try {
      const version = registry.createSourceVersion(tenantId, parseResult.data);
      return reply.status(201).send(version);
    } catch (err) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'SOURCE_VERSION_FAILED',
          title: 'Failed to Ingest Source Version',
          detail: (err as Error).message
        })
      );
    }
  });

  // 5. Lookup Source Version
  fastify.get(
    '/v1/sources/versions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const version = registry.getVersion(tenantId, request.params.id);
      if (!version) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'SOURCE_VERSION_NOT_FOUND',
            title: 'Source Version Not Found',
            detail: `Source version '${request.params.id}' does not exist or is unauthorized.`
          })
        );
      }

      return reply.status(200).send(version);
    }
  );

  // 6. Ingest Single Passage
  fastify.post(
    '/v1/sources/versions/:id/passages',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const parseResult = SourcePassageInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Invalid Source Passage Payload',
            detail: 'Source passage registration failed schema validation.'
          })
        );
      }

      try {
        const passage = registry.createPassage(tenantId, request.params.id, parseResult.data);
        return reply.status(201).send(passage);
      } catch (err) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'PASSAGE_CREATION_FAILED',
            title: 'Failed to Create Passage',
            detail: (err as Error).message
          })
        );
      }
    }
  );

  // 7. Get Passages for Source Version
  fastify.get(
    '/v1/sources/versions/:id/passages',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const passages = registry.getPassagesForVersion(tenantId, request.params.id);
      return reply.status(200).send({ passages, count: passages.length });
    }
  );

  // 8. Safe Document File Ingestion (Binary/Base64 with magic bytes & safe parsing)
  fastify.post('/v1/sources/ingest/file', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = FileIngestInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid File Ingestion Payload',
          detail: 'File ingestion failed schema validation.'
        })
      );
    }

    const { filename, contentBase64, permissionContext, projectId, originalUri } = parseResult.data;
    const fileBuffer = Buffer.from(contentBase64, 'base64');

    try {
      // 1. Safe Document Parse
      const parsed = safeParser.parseDocument(fileBuffer, filename);

      // 2. Register Artifact
      const artifact = registry.registerArtifact(tenantId, projectId, {
        originalUri: originalUri ?? `file://${filename}`,
        sourceType: parsed.detectedType,
        title: filename,
        mimeType: parsed.mimeType,
        permissionContext,
        retentionState: 'active',
        metadata: {}
      });

      // 3. Create Version
      const version = registry.createSourceVersion(
        tenantId,
        {
          sourceArtifactId: artifact.id,
          contentHash: parsed.contentHash,
          byteSize: parsed.byteSize,
          storageLocation: `cas://${parsed.contentHash}`,
          versionIdentifiers: {},
          retrievalTimestamp: new Date().toISOString(),
          parserMetadata: parsed.parserMetadata
        },
        fileBuffer
      );

      // 4. Ingest Extracted Passages
      const registeredPassages = parsed.passages.map((p) =>
        registry.createPassage(tenantId, version.id, p)
      );

      return reply.status(201).send({
        artifact,
        version,
        passages: registeredPassages,
        extractedTextLength: parsed.extractedText.length,
        warnings: parsed.parserMetadata.warnings
      });
    } catch (err) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'DOCUMENT_INGESTION_FAILED',
          title: 'Document Ingestion Failed',
          detail: (err as Error).message
        })
      );
    }
  });

  // 9. Safe Web Source Ingestion (SSRF defense, canonicalization, non-infer publication date)
  fastify.post('/v1/sources/ingest/web', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = WebSourceIngestInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Web Ingest Payload',
          detail: 'Web ingest failed schema validation.'
        })
      );
    }

    const projectId =
      (request.body as { projectId?: string }).projectId ?? '00000000-0000-4000-8000-000000000001';

    try {
      // 1. Fetch web document safely
      const webDoc = await webIngester.ingestWebUrl(parseResult.data);

      // 2. Parse extracted content safely
      const parsed = safeParser.parseDocument(webDoc.content, 'index.html');

      // 3. Register Artifact
      const artifact = registry.registerArtifact(tenantId, projectId, {
        originalUri: webDoc.originalUrl,
        sourceType: 'web_page',
        title: parseResult.data.title ?? parseResult.data.url,
        mimeType: webDoc.mimeType,
        permissionContext: parseResult.data.permissionContext,
        retentionState: 'active',
        metadata: {}
      });

      // 4. Create Version (Publication date is ONLY explicit HTTP Last-Modified or null - NEVER retrievalTimestamp)
      const version = registry.createSourceVersion(
        tenantId,
        {
          sourceArtifactId: artifact.id,
          contentHash: parsed.contentHash,
          byteSize: parsed.byteSize,
          storageLocation: `cas://${parsed.contentHash}`,
          versionIdentifiers: {},
          publicationDate: webDoc.publicationDate,
          retrievalTimestamp: webDoc.retrievalTimestamp,
          httpValidators: webDoc.httpValidators,
          parserMetadata: {
            resolvedUrl: webDoc.resolvedUrl,
            statusCode: webDoc.statusCode,
            ...parsed.parserMetadata
          }
        },
        webDoc.content
      );

      // 5. Ingest Passages
      const registeredPassages = parsed.passages.map((p) =>
        registry.createPassage(tenantId, version.id, p)
      );

      return reply.status(201).send({
        artifact,
        version,
        passages: registeredPassages,
        resolvedUrl: webDoc.resolvedUrl,
        httpValidators: webDoc.httpValidators
      });
    } catch (err) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'WEB_INGESTION_FAILED',
          title: 'Web Ingestion Failed',
          detail: (err as Error).message
        })
      );
    }
  });

  // 10. Create Source Snapshot
  fastify.post('/v1/sources/snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = CreateSnapshotSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Snapshot Payload',
          detail: 'Snapshot creation failed schema validation.'
        })
      );
    }

    try {
      const snapshot = registry.createSnapshot(tenantId, parseResult.data.sourceVersionIds);
      return reply.status(201).send(snapshot);
    } catch (err) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'SNAPSHOT_CREATION_FAILED',
          title: 'Snapshot Creation Failed',
          detail: (err as Error).message
        })
      );
    }
  });
};
