import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import {
  createProblemDetails,
  SwitchAgentRegistrationInputSchema,
  SwitchReviewCasePostSchema,
  SwitchRemediationSummaryPostSchema,
  OTLPTracesPayloadSchema
} from '@proofmesh/contracts';
import { type SecretManager, EnvelopeSecretManager } from '@proofmesh/db';
import type { IAdapterConnectionRepository } from '@proofmesh/db';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import {
  SchemaValidationError,
  UnsupportedEventTypeError,
  UnsupportedSchemaVersionError
} from '@proofmesh/domain';
import type { GatewayService } from '../gateway/service.js';
import { SwitchAdapter } from '../gateway/adapters/switch.adapter.js';
import { WebhookAdapter } from '../gateway/adapters/webhook.adapter.js';
import { OpenTelemetryAdapter } from '../gateway/adapters/opentelemetry.adapter.js';
import { AdapterHealthService } from '../gateway/adapters/adapter-health.service.js';
import { ensureUuid } from '../gateway/adapters/adapter.interface.js';

export interface AdapterRouteOptions extends Partial<AuthMiddlewareDependencies> {
  gatewayService?: GatewayService;
  secretManager?: SecretManager;
  adapterConnectionRepo?: IAdapterConnectionRepository;
  maxPayloadBytes?: number;
  webhookSecret?: string;
}

export const adapterRoutes: FastifyPluginAsync<AdapterRouteOptions> = async (fastify, options) => {
  const authMiddleware =
    options.jwtSigner && options.identityRepo && options.authRepo && options.auditRepo
      ? createAuthMiddleware(options as AuthMiddlewareDependencies)
      : null;

  const gatewayService = options.gatewayService;
  const secretManager = options.secretManager ?? new EnvelopeSecretManager();
  const adapterConnectionRepo = options.adapterConnectionRepo;
  const healthService = AdapterHealthService.getInstance();
  const defaultWebhookSecret = options.webhookSecret ?? 'pm_default_webhook_signing_secret_test';
  const maxBytes = options.maxPayloadBytes ?? 5 * 1024 * 1024;

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

  // Instantiate standard adapters
  const otelAdapter = new OpenTelemetryAdapter({
    adapterId: 'otel_standard_receiver',
    allowContentCapture: false // Metadata-only by default
  });

  // Switch adapter instances per agent
  const switchAdapters = new Map<string, SwitchAdapter>();

  const getOrCreateSwitchAdapter = (agentId: string): SwitchAdapter => {
    let adapter = switchAdapters.get(agentId);
    if (!adapter) {
      adapter = new SwitchAdapter({
        adapterId: `switch_${agentId}`,
        agentId,
        serverAddress: 'http://localhost:8000',
        connectionId: crypto.randomUUID(),
        allowUnaddressedObservation: true
      });
      switchAdapters.set(agentId, adapter);
    }
    return adapter;
  };

  // 1. Switch Agent Registration (Secure API key generation & storage)
  fastify.post(
    '/v1/gateway/adapters/switch/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkPayloadSize(request, reply)) return;
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId;
      if (!tenantId) {
        return reply.status(401).send(
          createProblemDetails({
            status: 401,
            code: 'UNAUTHENTICATED',
            title: 'Authentication Required',
            detail: 'Authentication required for agent registration.'
          })
        );
      }

      const parseResult = SwitchAgentRegistrationInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Invalid Switch Registration Payload',
            detail: 'Payload does not conform to Switch agent registration schema.',
            invalidParams: parseResult.error.errors.map((e) => ({
              name: e.path.join('.'),
              reason: e.message
            }))
          })
        );
      }

      const agentId = crypto.randomUUID();
      const generatedApiKey = `sw_live_${crypto.randomBytes(24).toString('hex')}`;
      const connectionId = crypto.randomUUID();

      // Securely store the API key in SecretManager - never expose to browser/client
      const credentialRef = await secretManager.storeSecret(generatedApiKey);

      // Persist adapter connection state in database if repo available
      if (adapterConnectionRepo) {
        await adapterConnectionRepo.upsertConnection(tenantId, {
          adapterType: 'switch',
          instanceId: agentId,
          connectionId,
          cursorPosition: 0,
          status: 'disconnected',
          stateMetadata: {
            name: parseResult.data.name,
            connectorType: parseResult.data.connector_type,
            connectionModel: parseResult.data.integration_profile.connection_model,
            credentialRef
          }
        });
      }

      getOrCreateSwitchAdapter(agentId);

      // Return agent registration confirmation WITHOUT returning the plaintext API key to the client
      return reply.status(201).send({
        id: agentId,
        name: parseResult.data.name,
        status: 'registered',
        connectionId,
        storedSecurely: true
      });
    }
  );

  // 2. Switch Inbound Event Frame (WebSocket / HTTP stream frame)
  fastify.post(
    '/v1/gateway/adapters/switch/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkPayloadSize(request, reply)) return;
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId;
      if (!tenantId) {
        return reply.status(401).send(
          createProblemDetails({
            status: 401,
            code: 'UNAUTHENTICATED',
            title: 'Authentication Required',
            detail: 'Authentication required for Switch event ingestion.'
          })
        );
      }

      const query = request.query as { agent_id?: string };
      const agentId = query.agent_id ?? 'default_switch_agent';
      const adapter = getOrCreateSwitchAdapter(agentId);

      const adapterContext = {
        tenantId,
        actor: {
          principalId: request.context?.principalId ?? crypto.randomUUID(),
          principalType: request.context?.principalType ?? 'agent_identity'
        }
      };

      const frameResult = adapter.handleFrame(
        request.body as Record<string, unknown>,
        adapterContext
      );

      // Ingest any produced canonical events into inbox
      let batchResult = null;
      if (gatewayService && frameResult.events.length > 0) {
        batchResult = await gatewayService.ingestEnvelopes(frameResult.events, adapterContext);
      }

      // If database connection repo available, persist updated cursor
      if (adapterConnectionRepo) {
        const snapshot = adapter.getSnapshot();
        await adapterConnectionRepo.updateCursor(
          tenantId,
          snapshot.connectionId,
          snapshot.cursor,
          snapshot.generation ?? undefined
        );
      }

      return reply.status(200).send({
        success: true,
        pong: frameResult.pong,
        actionRequired: frameResult.actionRequired,
        eventsIngested: frameResult.events.length,
        batchResult
      });
    }
  );

  // 3. Switch Outbound Message Formatting (Review Case & Remediation summaries)
  fastify.post(
    '/v1/gateway/adapters/switch/messages',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId;
      if (!tenantId) {
        return reply.status(401).send(
          createProblemDetails({
            status: 401,
            code: 'UNAUTHENTICATED',
            title: 'Authentication Required',
            detail: 'Authentication required for Switch message posting.'
          })
        );
      }

      const body = request.body as Record<string, unknown>;
      const adapter = getOrCreateSwitchAdapter('default_switch_agent');

      if (body.kind === 'review_case') {
        const parsed = SwitchReviewCasePostSchema.safeParse(body);
        if (!parsed.success) {
          return reply.status(400).send(
            createProblemDetails({
              status: 400,
              code: 'VALIDATION_FAILED',
              title: 'Invalid Review Case Payload',
              detail: 'Payload does not conform to SwitchReviewCasePostSchema.'
            })
          );
        }
        const formatted = adapter.formatReviewCaseMessage(parsed.data);
        return reply.status(200).send({ success: true, formatted });
      }

      if (body.kind === 'remediation_summary') {
        const parsed = SwitchRemediationSummaryPostSchema.safeParse(body);
        if (!parsed.success) {
          return reply.status(400).send(
            createProblemDetails({
              status: 400,
              code: 'VALIDATION_FAILED',
              title: 'Invalid Remediation Summary Payload',
              detail: 'Payload does not conform to SwitchRemediationSummaryPostSchema.'
            })
          );
        }
        const formatted = adapter.formatRemediationMessage(parsed.data);
        return reply.status(200).send({ success: true, formatted });
      }

      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'UNKNOWN_MESSAGE_KIND',
          title: 'Unknown Switch Message Kind',
          detail: "Field 'kind' must be 'review_case' or 'remediation_summary'."
        })
      );
    }
  );

  // 4. Webhook Adapter Ingest (HMAC-SHA256 signature and timestamp verification)
  fastify.post(
    '/v1/gateway/adapters/webhooks/:source',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkPayloadSize(request, reply)) return;
      const { source } = request.params as { source: string };

      // Extract headers
      const signature =
        (request.headers['x-proofmesh-signature'] as string) ??
        (request.headers['x-hub-signature-256'] as string);
      const timestamp = request.headers['x-proofmesh-timestamp'] as string;
      const idempotencyKey = request.headers['idempotency-key'] as string;
      const correlationId = (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
      const tenantIdHeader = request.headers['x-tenant-id'] as string;

      // Webhooks derive or receive tenant identity
      const tenantId = request.context?.tenantId ?? tenantIdHeader;
      if (!tenantId) {
        return reply.status(401).send(
          createProblemDetails({
            status: 401,
            code: 'TENANT_NOT_DERIVABLE',
            title: 'Tenant Scope Required',
            detail: 'Webhook request must specify valid tenant scope or credential.'
          })
        );
      }

      const tenantSecret = defaultWebhookSecret;

      const webhookAdapter = new WebhookAdapter({
        adapterId: `webhook_${source}`,
        source,
        secret: tenantSecret
      });

      const rawBody =
        typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});

      const adapterContext = {
        tenantId,
        actor: {
          principalId: ensureUuid(request.context?.principalId, `webhook:${tenantId}:${source}`),
          principalType: request.context?.principalType ?? ('service_account' as const)
        }
      };

      const verifyResult = webhookAdapter.verifyAndTransform(
        {
          signature: signature ?? '',
          timestamp: timestamp ?? '',
          source: 'generic_hmac',
          idempotencyKey,
          correlationId
        },
        rawBody,
        request.body,
        adapterContext
      );

      reply.header('X-Correlation-Id', correlationId);

      if (!verifyResult.success) {
        const statusCode = verifyResult.code === 'EXPIRED_TIMESTAMP' ? 401 : 401;
        return reply.status(statusCode).send(
          createProblemDetails({
            status: statusCode,
            code: verifyResult.code ?? 'WEBHOOK_VERIFICATION_FAILED',
            title: 'Webhook Verification Failed',
            detail: verifyResult.error ?? 'Signature or timestamp verification failed.'
          })
        );
      }

      // Ingest into gateway inbox
      if (gatewayService && verifyResult.envelopes && verifyResult.envelopes.length > 0) {
        try {
          await gatewayService.ingestEnvelopes(verifyResult.envelopes, adapterContext);
        } catch (err) {
          if (err instanceof SchemaValidationError) {
            return reply.status(400).send(
              createProblemDetails({
                status: 400,
                code: 'SCHEMA_VALIDATION_FAILED',
                title: 'Payload Schema Validation Failed',
                detail: err.message,
                invalidParams: err.validationErrors.map((msg) => ({
                  name: 'data',
                  reason: msg
                }))
              })
            );
          }
          if (
            err instanceof UnsupportedEventTypeError ||
            err instanceof UnsupportedSchemaVersionError
          ) {
            return reply.status(400).send(
              createProblemDetails({
                status: 400,
                code: 'UNSUPPORTED_EVENT_TYPE',
                title: 'Unsupported Event Type Or Version',
                detail: err.message
              })
            );
          }
          throw err;
        }
      }

      return reply.status(202).send({
        accepted: true,
        correlationId,
        source,
        envelopesProcessed: verifyResult.envelopes?.length ?? 0
      });
    }
  );

  // 5. OpenTelemetry Standard OTLP Trace Endpoint
  fastify.post(
    '/v1/gateway/adapters/opentelemetry/v1/traces',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkPayloadSize(request, reply)) return;
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId;
      if (!tenantId) {
        return reply.status(401).send(
          createProblemDetails({
            status: 401,
            code: 'UNAUTHENTICATED',
            title: 'Authentication Required',
            detail: 'Authentication required for OTLP trace ingestion.'
          })
        );
      }

      const parseResult = OTLPTracesPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Invalid OTLP Traces Payload',
            detail: 'Payload does not match standard OpenTelemetry ResourceSpans schema.',
            invalidParams: parseResult.error.errors.map((e) => ({
              name: e.path.join('.'),
              reason: e.message
            }))
          })
        );
      }

      const adapterContext = {
        tenantId,
        actor: {
          principalId: request.context?.principalId ?? 'otel_collector',
          principalType: request.context?.principalType ?? 'service_account'
        }
      };

      const envelopes = otelAdapter.transform(parseResult.data, adapterContext);

      if (gatewayService && envelopes.length > 0) {
        await gatewayService.ingestEnvelopes(envelopes, adapterContext);
      }

      // Return standard OTLP HTTP success response
      return reply.status(202).send({
        partialSuccess: {}
      });
    }
  );

  // 6. Adapter Health Diagnostics (Aggregated & Single Adapter)
  fastify.get(
    '/v1/gateway/adapters/health',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const aggregateHealth = healthService.getAggregateHealth();
      const statusCode = aggregateHealth.status === 'unhealthy' ? 503 : 200;
      return reply.status(statusCode).send(aggregateHealth);
    }
  );

  fastify.get(
    '/v1/gateway/adapters/:adapterId/health',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { adapterId } = request.params as { adapterId: string };
      const health = healthService.getAdapterHealth(adapterId);

      if (!health) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'ADAPTER_NOT_FOUND',
            title: 'Adapter Not Found',
            detail: `No adapter registered with ID '${adapterId}'.`
          })
        );
      }

      return reply.status(200).send(health);
    }
  );
};
