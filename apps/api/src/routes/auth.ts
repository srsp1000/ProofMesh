import type { FastifyPluginAsync } from 'fastify';
import { randomBytes, createHash } from 'node:crypto';
import {
  CreateApiKeyInputSchema,
  RevokeApiKeyInputSchema,
  RotateApiKeyInputSchema,
  createProblemDetails
} from '@proofmesh/contracts';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import { InMemoryRateLimiter } from '../middleware/rate-limiter.js';

export const authRoutes: FastifyPluginAsync<AuthMiddlewareDependencies> = async (
  fastify,
  options
) => {
  const { jwtSigner, authRepo, auditRepo, identityRepo } = options;
  const { authenticate, requirePermission } = createAuthMiddleware(options);
  const rateLimiter = new InMemoryRateLimiter(60_000, 20); // 20 requests per minute

  // Rate-limited Token Issue Route (Dev / Test / IdP integration)
  fastify.post(
    '/tokens/issue',
    { preHandler: [rateLimiter.createPreHandler()] },
    async (request, reply) => {
      const body = request.body as {
        sub: string;
        tenant_id?: string;
        email?: string;
        name?: string;
        roles?: string[];
      };

      if (!body.sub) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'INVALID_REQUEST',
            title: 'Bad Request',
            detail: 'Subject (sub) is required.',
            instance: request.url
          })
        );
      }

      const token = jwtSigner.sign({
        sub: body.sub,
        tenant_id: body.tenant_id,
        email: body.email,
        name: body.name,
        roles: body.roles
      });

      return reply.status(200).send({
        token,
        tokenType: 'Bearer',
        expiresIn: 3600
      });
    }
  );

  // Authenticated Context Inspection
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.status(200).send({
      context: request.context
    });
  });

  // Create API Key (Requires credentials:manage)
  fastify.post(
    '/api-keys',
    { preHandler: [authenticate, requirePermission('credentials:manage')] },
    async (request, reply) => {
      const parsed = CreateApiKeyInputSchema.safeParse(request.body);
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

      const ctx = request.context!;
      const data = parsed.data;

      // Ensure target principal belongs to current tenant
      const principal = await identityRepo.getPrincipalById(ctx.tenantId, data.principalId);
      if (!principal) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'PRINCIPAL_NOT_FOUND',
            title: 'Not Found',
            detail: 'Target principal not found in this tenant.',
            instance: request.url
          })
        );
      }

      // Generate secure random secret token
      const randomSecret = randomBytes(24).toString('hex');
      const secretToken = `pm_live_${randomSecret}`;
      const keyPrefix = secretToken.slice(0, 12);
      const keyHash = createHash('sha256').update(secretToken, 'utf8').digest('hex');

      const expiresAt = new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000);

      const apiKey = await authRepo.createApiKey(
        ctx.tenantId,
        data.principalId,
        data.name,
        keyPrefix,
        keyHash,
        data.scopes,
        expiresAt
      );

      // Record audit event
      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'credentials.api_key_created',
        entityType: 'api_key',
        entityId: apiKey.id,
        payload: {
          keyId: apiKey.id,
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt
        },
        correlationId: ctx.correlationId
      });

      return reply.status(201).send({
        ...apiKey,
        secretToken // Returned strictly once
      });
    }
  );

  // Revoke API Key (Requires credentials:manage)
  fastify.post(
    '/api-keys/:id/revoke',
    { preHandler: [authenticate, requirePermission('credentials:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = RevokeApiKeyInputSchema.safeParse(request.body || {});
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

      const ctx = request.context!;
      const revoked = await authRepo.revokeApiKey(ctx.tenantId, id);

      if (!revoked) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'API_KEY_NOT_FOUND',
            title: 'Not Found',
            detail: 'API key not found or already revoked.',
            instance: request.url
          })
        );
      }

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'credentials.api_key_revoked',
        entityType: 'api_key',
        entityId: id,
        payload: {
          keyId: id,
          reason: parsed.data.reason
        },
        correlationId: ctx.correlationId
      });

      return reply.status(200).send({
        status: 'revoked',
        keyId: id
      });
    }
  );

  // Rotate API Key (Requires credentials:manage)
  fastify.post(
    '/api-keys/:id/rotate',
    { preHandler: [authenticate, requirePermission('credentials:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = RotateApiKeyInputSchema.safeParse(request.body || {});
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

      const ctx = request.context!;

      // 1. Revoke old key
      const revoked = await authRepo.revokeApiKey(ctx.tenantId, id);
      if (!revoked) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'API_KEY_NOT_FOUND',
            title: 'Not Found',
            detail: 'API key not found or already revoked.',
            instance: request.url
          })
        );
      }

      // 2. Issue new key under same principal and scopes
      const randomSecret = randomBytes(24).toString('hex');
      const secretToken = `pm_live_${randomSecret}`;
      const keyPrefix = secretToken.slice(0, 12);
      const keyHash = createHash('sha256').update(secretToken, 'utf8').digest('hex');
      const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);

      const newKey = await authRepo.createApiKey(
        ctx.tenantId,
        ctx.principalId,
        `Rotated from ${id}`,
        keyPrefix,
        keyHash,
        ctx.permissions,
        expiresAt
      );

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'credentials.api_key_rotated',
        entityType: 'api_key',
        entityId: newKey.id,
        payload: {
          oldKeyId: id,
          newKeyId: newKey.id,
          newKeyPrefix: newKey.keyPrefix
        },
        correlationId: ctx.correlationId
      });

      return reply.status(200).send({
        ...newKey,
        secretToken
      });
    }
  );
};
