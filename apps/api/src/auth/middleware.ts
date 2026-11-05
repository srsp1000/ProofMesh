import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { createProblemDetails, type Permission } from '@proofmesh/contracts';
import { RBACPolicy, TenantLifecycle } from '@proofmesh/domain';
import type { RequestContext } from './context.js';
import { runWithContext } from './context.js';
import type { JwtSigner } from './jwt.js';
import type { IdentityRepository, AuthRepository, AuditRepository } from '@proofmesh/db';

export interface AuthMiddlewareDependencies {
  jwtSigner: JwtSigner;
  identityRepo: IdentityRepository;
  authRepo: AuthRepository;
  auditRepo: AuditRepository;
}

declare module 'fastify' {
  interface FastifyRequest {
    context?: RequestContext;
  }
}

export function createAuthMiddleware(deps: AuthMiddlewareDependencies) {
  const { jwtSigner, identityRepo, authRepo, auditRepo } = deps;

  /**
   * Fastify preHandler hook to authenticate incoming requests via OIDC JWT or API Key.
   * Derives tenant context server-side and binds it to AsyncLocalStorage.
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    const rawToken = authHeader || (apiKeyHeader ? `ApiKey ${apiKeyHeader}` : undefined);

    if (!rawToken) {
      const problem = createProblemDetails({
        status: 401,
        code: 'UNAUTHENTICATED',
        title: 'Authentication Required',
        detail: 'Missing Authorization header or X-API-Key.',
        instance: request.url
      });
      return reply.status(401).send(problem);
    }

    const correlationId = (request.headers['x-correlation-id'] as string) || crypto.randomUUID();

    try {
      let context: RequestContext;

      if (rawToken.startsWith('Bearer ')) {
        // --- 1. Human OIDC JWT Authentication ---
        const token = rawToken.slice('Bearer '.length).trim();
        const claims = jwtSigner.verify(token);

        // Derive tenant: If token has tenant_id, verify tenant exists; otherwise query membership
        const userIdentifier = claims.email || claims.sub;
        let tenantId = claims.tenant_id;

        // If client specified an optional target tenant, verify membership before trusting
        const requestedTenantId = request.headers['x-tenant-id'] as string | undefined;
        if (requestedTenantId) {
          tenantId = requestedTenantId;
        }

        if (!tenantId) {
          const problem = createProblemDetails({
            status: 403,
            code: 'TENANT_NOT_DERIVABLE',
            title: 'Forbidden',
            detail: 'Unable to derive tenant from authenticated user credentials.',
            instance: request.url
          });
          return reply.status(403).send(problem);
        }

        // Validate tenant status
        const tenant = await identityRepo.getTenantById(tenantId);
        if (!tenant) {
          const problem = createProblemDetails({
            status: 404,
            code: 'TENANT_NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant does not exist.',
            instance: request.url
          });
          return reply.status(404).send(problem);
        }
        TenantLifecycle.assertAccessible(tenant.status, tenant.id);

        // Fetch or create human principal in this tenant
        let principal = await identityRepo.getPrincipalByIdentifier(tenant.id, userIdentifier);
        if (!principal) {
          principal = await identityRepo.createPrincipal(tenant.id, {
            type: 'human_user',
            identifier: userIdentifier,
            displayName: claims.name || userIdentifier
          });
          await identityRepo.createMembership(tenant.id, {
            userPrincipalId: principal.id,
            status: 'active'
          });
        }

        if (!principal.isActive) {
          const problem = createProblemDetails({
            status: 403,
            code: 'PRINCIPAL_INACTIVE',
            title: 'Forbidden',
            detail: 'User principal account is inactive.',
            instance: request.url
          });
          return reply.status(403).send(problem);
        }

        // Resolve assigned permissions
        const permissions = await authRepo.getPrincipalPermissions(tenant.id, principal.id);

        context = {
          tenantId: tenant.id,
          principalId: principal.id,
          principalType: principal.type,
          identifier: principal.identifier,
          displayName: principal.displayName,
          permissions,
          correlationId
        };
      } else if (rawToken.startsWith('ApiKey ') || rawToken.startsWith('pm_live_')) {
        // --- 2. Machine / Agent API Key Authentication ---
        const token = rawToken.startsWith('ApiKey ')
          ? rawToken.slice('ApiKey '.length).trim()
          : rawToken.trim();
        const keyHash = createHash('sha256').update(token, 'utf8').digest('hex');

        const keyRecord = await authRepo.getApiKeyByHash(keyHash);
        if (!keyRecord) {
          const problem = createProblemDetails({
            status: 401,
            code: 'INVALID_CREDENTIALS',
            title: 'Unauthorized',
            detail: 'The provided API key is invalid or unrecognized.',
            instance: request.url
          });
          return reply.status(401).send(problem);
        }

        if (keyRecord.revokedAt) {
          const problem = createProblemDetails({
            status: 401,
            code: 'CREDENTIAL_REVOKED',
            title: 'Unauthorized',
            detail: 'The provided API key has been revoked.',
            instance: request.url
          });
          return reply.status(401).send(problem);
        }

        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt).getTime() < Date.now()) {
          const problem = createProblemDetails({
            status: 401,
            code: 'CREDENTIAL_EXPIRED',
            title: 'Unauthorized',
            detail: 'The provided API key has expired.',
            instance: request.url
          });
          return reply.status(401).send(problem);
        }

        // Validate tenant status
        const tenant = await identityRepo.getTenantById(keyRecord.tenantId);
        if (!tenant) {
          const problem = createProblemDetails({
            status: 404,
            code: 'TENANT_NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant does not exist.',
            instance: request.url
          });
          return reply.status(404).send(problem);
        }
        TenantLifecycle.assertAccessible(tenant.status, tenant.id);

        // Fetch associated principal
        const principal = await identityRepo.getPrincipalById(tenant.id, keyRecord.principalId);
        if (!principal || !principal.isActive) {
          const problem = createProblemDetails({
            status: 403,
            code: 'PRINCIPAL_INACTIVE',
            title: 'Forbidden',
            detail: 'Associated principal account is inactive or not found.',
            instance: request.url
          });
          return reply.status(403).send(problem);
        }

        context = {
          tenantId: tenant.id,
          principalId: principal.id,
          principalType: principal.type,
          identifier: principal.identifier,
          displayName: principal.displayName,
          permissions: keyRecord.scopes,
          correlationId
        };
      } else {
        const problem = createProblemDetails({
          status: 401,
          code: 'UNSUPPORTED_AUTH_SCHEME',
          title: 'Unauthorized',
          detail: "Unsupported authentication scheme. Use 'Bearer <jwt>' or 'ApiKey <token>'.",
          instance: request.url
        });
        return reply.status(401).send(problem);
      }

      request.context = context;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication verification failed.';
      const problem = createProblemDetails({
        status: 401,
        code: 'AUTHENTICATION_FAILED',
        title: 'Unauthorized',
        detail: message,
        instance: request.url
      });
      return reply.status(401).send(problem);
    }
  }

  /**
   * Fastify preHandler hook to enforce required RBAC permission and agent boundaries.
   */
  function requirePermission(requiredPermission: Permission) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const context = request.context;
      if (!context) {
        const problem = createProblemDetails({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Unauthorized',
          detail: 'Authentication context is missing.',
          instance: request.url
        });
        return reply.status(401).send(problem);
      }

      // Check agent impersonation guard
      if (
        context.principalType === 'agent_identity' &&
        RBACPolicy.isHumanOnly(requiredPermission)
      ) {
        // Record security denial in audit ledger
        await auditRepo.appendAuditEvent({
          tenantId: context.tenantId,
          principalId: context.principalId,
          action: 'security.permission_denied',
          entityType: 'permission',
          entityId: crypto.randomUUID(),
          payload: {
            reason: 'Agent identity attempted to exercise human-restricted permission',
            attemptedPermission: requiredPermission,
            url: request.url,
            method: request.method
          },
          correlationId: context.correlationId,
          policyDecision: 'deny'
        });

        const problem = createProblemDetails({
          status: 403,
          code: 'AGENT_HUMAN_IMPERSONATION_PROHIBITED',
          title: 'Forbidden',
          detail: `Security Violation: Automated agent identities cannot execute human-only action '${requiredPermission}'.`,
          instance: request.url
        });
        return reply.status(403).send(problem);
      }

      const hasPerm = RBACPolicy.hasPermission(
        context.principalType,
        context.permissions,
        requiredPermission
      );
      if (!hasPerm) {
        await auditRepo.appendAuditEvent({
          tenantId: context.tenantId,
          principalId: context.principalId,
          action: 'security.permission_denied',
          entityType: 'permission',
          entityId: crypto.randomUUID(),
          payload: {
            reason: 'Insufficient permissions',
            missingPermission: requiredPermission,
            grantedPermissions: context.permissions,
            url: request.url
          },
          correlationId: context.correlationId,
          policyDecision: 'deny'
        });

        const problem = createProblemDetails({
          status: 403,
          code: 'INSUFFICIENT_PERMISSIONS',
          title: 'Forbidden',
          detail: `User does not possess required permission '${requiredPermission}'.`,
          instance: request.url
        });
        return reply.status(403).send(problem);
      }
    };
  }

  /**
   * Fastify preHandler hook requiring human principal (rejects agents and service accounts).
   */
  async function requireHumanPrincipal(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const context = request.context;
    if (!context || context.principalType !== 'human_user') {
      const problem = createProblemDetails({
        status: 403,
        code: 'HUMAN_PRINCIPAL_REQUIRED',
        title: 'Forbidden',
        detail: 'This operation strictly requires an authenticated human user.',
        instance: request.url
      });
      return reply.status(403).send(problem);
    }
  }

  return {
    authenticate,
    requirePermission,
    requireHumanPrincipal,
    runWithContext
  };
}
