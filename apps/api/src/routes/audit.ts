import type { FastifyPluginAsync } from 'fastify';
import { AuditQueryFilterSchema, createProblemDetails } from '@proofmesh/contracts';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';

export const auditRoutes: FastifyPluginAsync<AuthMiddlewareDependencies> = async (
  fastify,
  options
) => {
  const { auditRepo } = options;
  const { authenticate, requirePermission, requireHumanPrincipal } = createAuthMiddleware(options);

  // 1. Query Tenant Audit Events
  fastify.get(
    '/events',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const ctx = request.context!;
      const query = request.query as Record<string, string | undefined>;

      const parsed = AuditQueryFilterSchema.safeParse({
        tenantId: ctx.tenantId,
        principalId: query.principalId,
        entityType: query.entityType,
        entityId: query.entityId,
        action: query.action,
        fromTime: query.fromTime,
        toTime: query.toTime,
        limit: query.limit ? parseInt(query.limit, 10) : 50
      });

      if (!parsed.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_ERROR',
            title: 'Validation Error',
            detail: parsed.error.message,
            instance: request.url
          })
        );
      }

      const events = await auditRepo.queryAuditEvents(parsed.data);
      return reply.status(200).send({ events });
    }
  );

  // 2. Seal Merkle Checkpoint
  fastify.post(
    '/checkpoints',
    { preHandler: [authenticate, requirePermission('audit:checkpoint'), requireHumanPrincipal] },
    async (request, reply) => {
      const ctx = request.context!;

      const checkpoint = await auditRepo.createCheckpoint(ctx.tenantId);
      if (!checkpoint) {
        return reply.status(200).send({
          status: 'skipped',
          detail: 'No uncheckpointed events found to seal.'
        });
      }

      return reply.status(201).send(checkpoint);
    }
  );

  // 3. List Checkpoints
  fastify.get(
    '/checkpoints',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const ctx = request.context!;
      const checkpoints = await auditRepo.getCheckpoints(ctx.tenantId);
      return reply.status(200).send({ checkpoints });
    }
  );
};
