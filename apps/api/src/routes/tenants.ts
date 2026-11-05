import type { FastifyPluginAsync } from 'fastify';
import {
  CreateTenantSchema,
  UpdateTenantSchema,
  CreateWorkspaceSchema,
  CreateProjectSchema,
  CreatePrincipalSchema,
  AssignRoleInputSchema,
  createProblemDetails
} from '@proofmesh/contracts';
import { TenantLifecycle, RBACPolicy } from '@proofmesh/domain';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';

export const tenantRoutes: FastifyPluginAsync<AuthMiddlewareDependencies> = async (
  fastify,
  options
) => {
  const { identityRepo, authRepo, auditRepo } = options;
  const { authenticate, requirePermission, requireHumanPrincipal } = createAuthMiddleware(options);

  // 1. Create Tenant (Bootstrap / Admin)
  fastify.post('/', async (request, reply) => {
    const parsed = CreateTenantSchema.safeParse(request.body);
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

    const tenant = await identityRepo.createTenant(parsed.data);

    // Record audit event (tenant context equals the created tenant)
    await auditRepo.appendAuditEvent({
      tenantId: tenant.id,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      payload: {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug
      }
    });

    return reply.status(201).send(tenant);
  });

  // 2. Get Tenant
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ctx = request.context!;

    // Anti-IDOR: Prevent Tenant A from reading Tenant B
    if (ctx.tenantId !== id) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'Requested tenant was not found.',
          instance: request.url
        })
      );
    }

    const tenant = await identityRepo.getTenantById(id);
    if (!tenant) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'Tenant not found.',
          instance: request.url
        })
      );
    }

    return reply.status(200).send(tenant);
  });

  // 3. Transition Tenant Lifecycle (e.g. suspend or deprovision)
  fastify.post(
    '/:id/transition',
    { preHandler: [authenticate, requirePermission('tenants:manage'), requireHumanPrincipal] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.context!;

      if (ctx.tenantId !== id) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant not found.',
            instance: request.url
          })
        );
      }

      const parsed = UpdateTenantSchema.safeParse(request.body);
      if (!parsed.success || !parsed.data.status) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_ERROR',
            title: 'Validation Error',
            detail: 'Target status must be provided.',
            instance: request.url
          })
        );
      }

      const existing = await identityRepo.getTenantById(id);
      if (!existing) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'NOT_FOUND',
            title: 'Not Found',
            detail: 'Tenant not found.',
            instance: request.url
          })
        );
      }

      const nextStatus = TenantLifecycle.transition(existing.status, parsed.data.status);
      const updated = await identityRepo.updateTenant(id, { status: nextStatus });

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'tenant.transitioned',
        entityType: 'tenant',
        entityId: id,
        payload: {
          previousStatus: existing.status,
          newStatus: nextStatus
        },
        correlationId: ctx.correlationId
      });

      return reply.status(200).send(updated);
    }
  );

  // 4. Create Workspace
  fastify.post(
    '/:id/workspaces',
    { preHandler: [authenticate, requirePermission('workspaces:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.context!;

      if (ctx.tenantId !== id) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant not found.',
            instance: request.url
          })
        );
      }

      const parsed = CreateWorkspaceSchema.safeParse(request.body);
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

      const workspace = await identityRepo.createWorkspace(id, parsed.data.name);

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'workspace.created',
        entityType: 'workspace',
        entityId: workspace.id,
        payload: workspace,
        correlationId: ctx.correlationId
      });

      return reply.status(201).send(workspace);
    }
  );

  // 5. List Workspaces
  fastify.get('/:id/workspaces', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ctx = request.context!;

    if (ctx.tenantId !== id) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'Target tenant not found.',
          instance: request.url
        })
      );
    }

    const workspaces = await identityRepo.getWorkspaces(id);
    return reply.status(200).send({ workspaces });
  });

  // 6. Create Project
  fastify.post(
    '/:id/projects',
    { preHandler: [authenticate, requirePermission('projects:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.context!;

      if (ctx.tenantId !== id) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant not found.',
            instance: request.url
          })
        );
      }

      const parsed = CreateProjectSchema.safeParse(request.body);
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

      const project = await identityRepo.createProject(
        id,
        parsed.data.workspaceId,
        parsed.data.key,
        parsed.data.name
      );

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'project.created',
        entityType: 'project',
        entityId: project.id,
        payload: project,
        correlationId: ctx.correlationId
      });

      return reply.status(201).send(project);
    }
  );

  // 7. Create Principal
  fastify.post(
    '/:id/principals',
    { preHandler: [authenticate, requirePermission('principals:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.context!;

      if (ctx.tenantId !== id) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant not found.',
            instance: request.url
          })
        );
      }

      const parsed = CreatePrincipalSchema.safeParse(request.body);
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

      const principal = await identityRepo.createPrincipal(id, parsed.data);

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'principal.created',
        entityType: 'principal',
        entityId: principal.id,
        payload: principal,
        correlationId: ctx.correlationId
      });

      return reply.status(201).send(principal);
    }
  );

  // 8. Assign Role
  fastify.post(
    '/:id/roles/assign',
    { preHandler: [authenticate, requirePermission('roles:assign'), requireHumanPrincipal] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ctx = request.context!;

      if (ctx.tenantId !== id) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'NOT_FOUND',
            title: 'Not Found',
            detail: 'Target tenant not found.',
            instance: request.url
          })
        );
      }

      const parsed = AssignRoleInputSchema.safeParse(request.body);
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

      // 1. Verify principal
      const principal = await identityRepo.getPrincipalById(id, parsed.data.principalId);
      if (!principal) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'PRINCIPAL_NOT_FOUND',
            title: 'Not Found',
            detail: 'Target principal not found.',
            instance: request.url
          })
        );
      }

      // 2. Verify role
      const roleToAssign = await authRepo.getRoleById(id, parsed.data.roleId);
      if (!roleToAssign) {
        return reply.status(404).send(
          createProblemDetails({
            status: 404,
            code: 'ROLE_NOT_FOUND',
            title: 'Not Found',
            detail: 'Target role not found.',
            instance: request.url
          })
        );
      }

      // 3. Domain Check: Prevent agent from being assigned human role
      try {
        RBACPolicy.assertRoleAssignable(
          principal.type,
          roleToAssign.name,
          roleToAssign.allowsAgents
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Agent role escalation prohibited';
        return reply.status(403).send(
          createProblemDetails({
            status: 403,
            code: 'AGENT_PRIVILEGE_ESCALATION_PROHIBITED',
            title: 'Forbidden',
            detail: msg,
            instance: request.url
          })
        );
      }

      const assignment = await authRepo.assignRole(id, parsed.data, ctx.principalId);

      await auditRepo.appendAuditEvent({
        tenantId: ctx.tenantId,
        principalId: ctx.principalId,
        action: 'role.assigned',
        entityType: 'role_assignment',
        entityId: assignment.id,
        payload: {
          assignmentId: assignment.id,
          principalId: principal.id,
          roleId: roleToAssign.id,
          roleName: roleToAssign.name
        },
        correlationId: ctx.correlationId
      });

      return reply.status(201).send(assignment);
    }
  );
};
