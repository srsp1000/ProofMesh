import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  IngestEventInputSchema,
  IngestBatchInputSchema,
  OpenTelemetryIngestInputSchema,
  FrameworkCallbackInputSchema,
  createProblemDetails
} from '@proofmesh/contracts';
import {
  UnsupportedEventTypeError,
  UnsupportedSchemaVersionError,
  SchemaValidationError
} from '@proofmesh/domain';
import { TransportUnavailableError } from '@proofmesh/db';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import type { GatewayService } from '../gateway/service.js';

export interface GatewayRouteOptions extends Partial<AuthMiddlewareDependencies> {
  gatewayService?: GatewayService;
  maxPayloadBytes?: number;
}

export const gatewayRoutes: FastifyPluginAsync<GatewayRouteOptions> = async (fastify, options) => {
  const authMiddleware =
    options.jwtSigner && options.identityRepo && options.authRepo && options.auditRepo
      ? createAuthMiddleware(options as AuthMiddlewareDependencies)
      : null;

  const gatewayService = options.gatewayService;
  const maxBytes = options.maxPayloadBytes ?? 5 * 1024 * 1024; // 5MB default

  // Helper: check payload size limit
  const checkPayloadSize = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const headerLen = parseInt(request.headers['content-length'] ?? '0', 10);
    const bodyLen = request.body
      ? Buffer.byteLength(
          typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
          'utf8'
        )
      : 0;
    const contentLength = Math.max(headerLen, bodyLen);

    if (contentLength > maxBytes) {
      const problem = createProblemDetails({
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        title: 'Payload Too Large',
        detail: `Request payload size (${contentLength} bytes) exceeds maximum allowed limit of ${maxBytes} bytes.`
      });
      reply.status(413).send(problem);
      return false;
    }
    return true;
  };

  // Helper: enforce zero trust on caller-supplied tenant ID
  const assertTenantScope = (
    callerTenantId: string,
    requestedTenantId?: string,
    reply?: FastifyReply
  ): boolean => {
    if (requestedTenantId && requestedTenantId !== callerTenantId) {
      if (reply) {
        const problem = createProblemDetails({
          status: 403,
          code: 'FORBIDDEN_TENANT_MISMATCH',
          title: 'Forbidden Tenant Mismatch',
          detail:
            'Cross-tenant event ingestion or mismatch with authenticated tenant context is strictly prohibited.'
        });
        reply.status(403).send(problem);
      }
      return false;
    }
    return true;
  };

  // 1. Ingest Single Canonical Event
  fastify.post('/v1/gateway/events', async (request, reply) => {
    if (!checkPayloadSize(request, reply)) return;

    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    if (!gatewayService) {
      return reply.status(503).send(
        createProblemDetails({
          status: 503,
          code: 'GATEWAY_SERVICE_UNAVAILABLE',
          title: 'Gateway Service Unavailable',
          detail: 'The Gateway service is not configured on this instance.'
        })
      );
    }

    const tenantId =
      request.context?.tenantId ??
      ((request.body as Record<string, unknown> | null)?.['tenantId'] as string | undefined);

    if (!tenantId) {
      return reply.status(401).send(
        createProblemDetails({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Authentication Required',
          detail: 'A valid authenticated tenant session or API key is required.'
        })
      );
    }

    // Verify tenant mismatch if tenantId was passed in payload body
    const bodyObj = request.body as Record<string, unknown>;
    if (bodyObj.tenantId && !assertTenantScope(tenantId, bodyObj.tenantId as string, reply)) {
      return;
    }

    const parseResult = IngestEventInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      const problem = createProblemDetails({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Invalid Ingestion Payload',
        detail: 'The event payload failed schema validation.',
        invalidParams: parseResult.error.errors.map((e) => ({
          name: e.path.join('.'),
          reason: e.message
        }))
      });
      return reply.status(400).send(problem);
    }

    try {
      const response = await gatewayService.ingestEvent(parseResult.data, {
        tenantId,
        actor: {
          principalId: request.context?.principalId ?? crypto.randomUUID(),
          principalType: request.context?.principalType ?? 'service_account'
        }
      });
      return reply.status(202).send(response);
    } catch (err: unknown) {
      if (err instanceof UnsupportedEventTypeError) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'UNSUPPORTED_EVENT_TYPE',
            title: 'Unsupported Event Type',
            detail: err.message
          })
        );
      }
      if (err instanceof UnsupportedSchemaVersionError) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'UNSUPPORTED_SCHEMA_VERSION',
            title: 'Unsupported Schema Version',
            detail: err.message
          })
        );
      }
      if (err instanceof SchemaValidationError) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'SCHEMA_VALIDATION_FAILED',
            title: 'Schema Validation Failed',
            detail: err.message
          })
        );
      }
      if (err instanceof TransportUnavailableError) {
        return reply.status(503).send(
          createProblemDetails({
            status: 503,
            code: 'TRANSPORT_UNAVAILABLE',
            title: 'Transport Unavailable',
            detail: err.message
          })
        );
      }
      throw err;
    }
  });

  // 2. Ingest Batch of Events
  fastify.post('/v1/gateway/batch', async (request, reply) => {
    if (!checkPayloadSize(request, reply)) return;

    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    if (!gatewayService) {
      return reply.status(503).send(
        createProblemDetails({
          status: 503,
          code: 'GATEWAY_SERVICE_UNAVAILABLE',
          title: 'Gateway Service Unavailable',
          detail: 'Gateway service is not configured.'
        })
      );
    }

    const tenantId = request.context?.tenantId;
    if (!tenantId) {
      return reply.status(401).send(
        createProblemDetails({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Authentication Required',
          detail: 'Authentication required for batch ingestion.'
        })
      );
    }

    const parseResult = IngestBatchInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Batch Ingestion Payload',
          detail: 'Batch payload failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    try {
      const response = await gatewayService.ingestBatch(parseResult.data, {
        tenantId,
        actor: {
          principalId: request.context?.principalId ?? crypto.randomUUID(),
          principalType: request.context?.principalType ?? 'service_account'
        }
      });
      return reply.status(202).send(response);
    } catch (err: unknown) {
      if (
        err instanceof UnsupportedEventTypeError ||
        err instanceof UnsupportedSchemaVersionError ||
        err instanceof SchemaValidationError
      ) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Event Validation Failed',
            detail: err.message
          })
        );
      }
      throw err;
    }
  });

  // 3. OpenTelemetry Trace/Span Ingest Adapter
  fastify.post('/v1/gateway/adapters/opentelemetry', async (request, reply) => {
    if (!checkPayloadSize(request, reply)) return;

    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    if (!gatewayService) {
      return reply.status(503).send(
        createProblemDetails({
          status: 503,
          code: 'GATEWAY_SERVICE_UNAVAILABLE',
          title: 'Gateway Service Unavailable',
          detail: 'Gateway service is not configured.'
        })
      );
    }

    const tenantId = request.context?.tenantId;
    if (!tenantId) {
      return reply.status(401).send(
        createProblemDetails({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Authentication Required',
          detail: 'Authentication required for OpenTelemetry ingestion.'
        })
      );
    }

    const parseResult = OpenTelemetryIngestInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid OpenTelemetry Payload',
          detail: 'Payload does not match OpenTelemetry ResourceSpans schema.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const response = await gatewayService.ingestOpenTelemetry(parseResult.data, {
      tenantId,
      actor: {
        principalId: request.context?.principalId ?? crypto.randomUUID(),
        principalType: request.context?.principalType ?? 'service_account'
      }
    });

    return reply.status(202).send(response);
  });

  // 4. Framework / MCP Callback Adapter
  fastify.post('/v1/gateway/adapters/callbacks', async (request, reply) => {
    if (!checkPayloadSize(request, reply)) return;

    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    if (!gatewayService) {
      return reply.status(503).send(
        createProblemDetails({
          status: 503,
          code: 'GATEWAY_SERVICE_UNAVAILABLE',
          title: 'Gateway Service Unavailable',
          detail: 'Gateway service is not configured.'
        })
      );
    }

    const tenantId = request.context?.tenantId;
    if (!tenantId) {
      return reply.status(401).send(
        createProblemDetails({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Authentication Required',
          detail: 'Authentication required for callback ingestion.'
        })
      );
    }

    const parseResult = FrameworkCallbackInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Framework Callback Payload',
          detail: 'Payload does not match Framework Callback schema.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const response = await gatewayService.ingestFrameworkCallback(parseResult.data, {
      tenantId,
      actor: {
        principalId: request.context?.principalId ?? crypto.randomUUID(),
        principalType: request.context?.principalType ?? 'service_account'
      }
    });

    return reply.status(202).send(response);
  });

  // 5. Gateway Health Diagnostics & Queue Lag
  fastify.get('/v1/gateway/health', async (request, reply) => {
    if (!gatewayService) {
      return reply.status(503).send(
        createProblemDetails({
          status: 503,
          code: 'GATEWAY_SERVICE_UNAVAILABLE',
          title: 'Gateway Service Unavailable',
          detail: 'Gateway service is not configured.'
        })
      );
    }

    const tenantId = request.context?.tenantId;
    const diagnostics = await gatewayService.getDiagnostics(tenantId);
    return reply.status(200).send(diagnostics);
  });

  // 6. Dead Letter Replay (Requires Human Principal)
  fastify.post('/v1/gateway/dead-letter/:id/replay', async (request, reply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
      await authMiddleware.requireHumanPrincipal(request, reply);
      if (reply.sent) return;
    }

    if (!gatewayService) {
      return reply.status(503).send(
        createProblemDetails({
          status: 503,
          code: 'GATEWAY_SERVICE_UNAVAILABLE',
          title: 'Gateway Service Unavailable',
          detail: 'Gateway service is not configured.'
        })
      );
    }

    const { id } = request.params as { id: string };
    const tenantId = request.context?.tenantId;
    if (!tenantId) {
      return reply.status(401).send(
        createProblemDetails({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Authentication Required',
          detail: 'Authentication required for dead-letter replay.'
        })
      );
    }

    const result = await gatewayService.replayDeadLetter(
      tenantId,
      id,
      request.context?.principalId
    );

    if (!result.replayed) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'DEAD_LETTER_NOT_FOUND',
          title: 'Dead Letter Record Not Found',
          detail: `No dead-letter event found with identifier '${id}'.`
        })
      );
    }

    return reply.status(200).send({
      replayed: true,
      eventId: result.eventId
    });
  });
};
