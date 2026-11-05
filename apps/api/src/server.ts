import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { claimRoutes } from './routes/claims.js';
import { authRoutes } from './routes/auth.js';
import { tenantRoutes } from './routes/tenants.js';
import { auditRoutes } from './routes/audit.js';
import { createProblemDetails } from '@proofmesh/contracts';
import {
  type DatabasePool,
  IdentityRepository,
  AuthRepository,
  AuditRepository
} from '@proofmesh/db';
import { JwtSigner } from './auth/jwt.js';

export interface BuildServerOptions {
  pool?: DatabasePool;
  jwtSecret?: string;
  jwtSigner?: JwtSigner;
  identityRepo?: IdentityRepository;
  authRepo?: AuthRepository;
  auditRepo?: AuditRepository;
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

  const authDeps =
    identityRepo && authRepo && auditRepo
      ? { jwtSigner, identityRepo, authRepo, auditRepo }
      : undefined;

  if (authDeps) {
    await fastify.register(authRoutes, { prefix: '/v1/auth', ...authDeps });
    await fastify.register(tenantRoutes, { prefix: '/v1/tenants', ...authDeps });
    await fastify.register(auditRoutes, { prefix: '/v1/audit', ...authDeps });
  }

  await fastify.register(claimRoutes, authDeps ?? {});

  return fastify;
}
