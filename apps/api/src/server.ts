import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { claimRoutes } from './routes/claims.js';
import { createProblemDetails } from '@proofmesh/contracts';
import type { DatabasePool } from '@proofmesh/db';

export interface BuildServerOptions {
  pool?: DatabasePool;
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
  await fastify.register(claimRoutes);

  return fastify;
}
