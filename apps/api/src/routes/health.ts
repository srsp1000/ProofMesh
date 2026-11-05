import type { FastifyPluginAsync } from 'fastify';
import type { DatabasePool } from '@proofmesh/db';

export interface HealthRouteOptions {
  pool?: DatabasePool;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, options) => {
  // Liveness probe: verifies process is alive and accepting events
  fastify.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'pass',
      service: 'proofmesh-api',
      timestamp: new Date().toISOString()
    });
  });

  // Readiness probe: verifies downstream database connectivity
  fastify.get('/readyz', async (_request, reply) => {
    if (!options.pool) {
      // In standalone or test mode without pool, consider ready
      return reply.status(200).send({
        status: 'pass',
        checks: {
          database: 'skipped_no_pool'
        },
        timestamp: new Date().toISOString()
      });
    }

    try {
      const client = await options.pool.connect();
      try {
        await client.query('SELECT 1');
        return reply.status(200).send({
          status: 'pass',
          checks: {
            database: 'connected'
          },
          timestamp: new Date().toISOString()
        });
      } finally {
        client.release();
      }
    } catch (err) {
      fastify.log.error(err, 'Database readiness check failed');
      return reply.status(503).send({
        status: 'fail',
        checks: {
          database: 'disconnected'
        },
        timestamp: new Date().toISOString()
      });
    }
  });
};
