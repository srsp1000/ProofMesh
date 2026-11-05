import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { claimRoutes } from './routes/claims.js';
import { authRoutes } from './routes/auth.js';
import { tenantRoutes } from './routes/tenants.js';
import { auditRoutes } from './routes/audit.js';
import { gatewayRoutes } from './routes/gateway.js';
import { adapterRoutes } from './routes/adapters.js';
import { createProblemDetails } from '@proofmesh/contracts';
import {
  type DatabasePool,
  IdentityRepository,
  AuthRepository,
  AuditRepository,
  InboxRepository,
  OutboxRepository,
  AdapterConnectionRepository,
  type IAdapterConnectionRepository,
  type SecretManager,
  EnvelopeSecretManager,
  type EventTransport,
  InMemoryEventTransport
} from '@proofmesh/db';
import { JwtSigner } from './auth/jwt.js';
import { GatewayService } from './gateway/service.js';

export interface BuildServerOptions {
  pool?: DatabasePool;
  jwtSecret?: string;
  jwtSigner?: JwtSigner;
  identityRepo?: IdentityRepository;
  authRepo?: AuthRepository;
  auditRepo?: AuditRepository;
  inboxRepo?: InboxRepository;
  outboxRepo?: OutboxRepository;
  transport?: EventTransport;
  gatewayService?: GatewayService;
  adapterConnectionRepo?: IAdapterConnectionRepository;
  secretManager?: SecretManager;
  webhookSecret?: string;
  maxPayloadBytes?: number;
  logger?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: options.logger ?? false
  });

  await fastify.register(cors, {
    origin: true
  });

  // RFC 7807 global error handler
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    fastify.log.error(error);
    const statusCode = error.statusCode ?? 500;
    const problem = createProblemDetails({
      status: statusCode,
      code: error.code ?? 'INTERNAL_SERVER_ERROR',
      title: error.name ?? 'Internal Server Error',
      detail: error.message ?? 'An unexpected error occurred.'
    });
    return reply.status(statusCode).send(problem);
  });

  await fastify.register(healthRoutes, { pool: options.pool });

  // Initialize repositories and auth services if pool or explicit repos provided
  const pool = options.pool;
  const jwtSigner =
    options.jwtSigner ??
    new JwtSigner(options.jwtSecret ?? 'proofmesh_default_test_jwt_secret_min_16_chars');
  const identityRepo = options.identityRepo ?? (pool ? new IdentityRepository(pool) : undefined);
  const authRepo = options.authRepo ?? (pool ? new AuthRepository(pool) : undefined);
  const auditRepo = options.auditRepo ?? (pool ? new AuditRepository(pool) : undefined);
  const inboxRepo = options.inboxRepo ?? (pool ? new InboxRepository(pool) : undefined);
  const outboxRepo = options.outboxRepo ?? (pool ? new OutboxRepository(pool) : undefined);
  const transport = options.transport ?? new InMemoryEventTransport();

  const gatewayService =
    options.gatewayService ??
    (inboxRepo && outboxRepo ? new GatewayService(inboxRepo, outboxRepo, transport) : undefined);

  const authDeps =
    identityRepo && authRepo && auditRepo
      ? { jwtSigner, identityRepo, authRepo, auditRepo }
      : undefined;

  if (authDeps) {
    await fastify.register(authRoutes, { prefix: '/v1/auth', ...authDeps });
    await fastify.register(tenantRoutes, { prefix: '/v1/tenants', ...authDeps });
    await fastify.register(auditRoutes, { prefix: '/v1/audit', ...authDeps });
  }

  // Register gateway routes
  await fastify.register(gatewayRoutes, {
    ...authDeps,
    gatewayService,
    maxPayloadBytes: options.maxPayloadBytes
  });

  const secretManager = options.secretManager ?? new EnvelopeSecretManager();
  const adapterConnectionRepo =
    options.adapterConnectionRepo ?? (pool ? new AdapterConnectionRepository(pool) : undefined);

  // Register adapter routes
  await fastify.register(adapterRoutes, {
    ...authDeps,
    gatewayService,
    secretManager,
    adapterConnectionRepo,
    maxPayloadBytes: options.maxPayloadBytes,
    webhookSecret: options.webhookSecret
  });

  await fastify.register(claimRoutes, authDeps ?? {});

  return fastify;
}
