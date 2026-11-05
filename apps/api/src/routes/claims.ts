import type { FastifyPluginAsync } from 'fastify';
import {
  SubmitClaimSchema,
  TransitionClaimSchema,
  createProblemDetails
} from '@proofmesh/contracts';
import { ClaimStateMachine, InvalidStateTransitionError } from '@proofmesh/domain';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';

export const claimRoutes: FastifyPluginAsync<Partial<AuthMiddlewareDependencies>> = async (
  fastify,
  options
) => {
  const authMiddleware =
    options.jwtSigner && options.identityRepo && options.authRepo && options.auditRepo
      ? createAuthMiddleware(options as AuthMiddlewareDependencies)
      : null;

  // Ingestion: submit a claim
  fastify.post('/v1/claims', async (request, reply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
      await authMiddleware.requirePermission('claims:submit')(request, reply);
      if (reply.sent) return;
    }

    const parseResult = SubmitClaimSchema.safeParse(request.body);
    if (!parseResult.success) {
      const problem = createProblemDetails({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Invalid Claim Payload',
        detail: 'The submitted claim failed schema validation.',
        invalidParams: parseResult.error.errors.map((e) => ({
          name: e.path.join('.'),
          reason: e.message
        }))
      });
      return reply.status(400).send(problem);
    }

    const { claimConceptKey, statement, qualifiers } = parseResult.data;
    const claimId = crypto.randomUUID();
    const recordedAt = new Date().toISOString();

    if (authMiddleware && options.auditRepo && request.context) {
      await options.auditRepo.appendAuditEvent({
        tenantId: request.context.tenantId,
        principalId: request.context.principalId,
        action: 'claim.created',
        entityType: 'claim',
        entityId: claimId,
        payload: {
          conceptKey: claimConceptKey,
          statement,
          qualifiers
        },
        correlationId: request.context.correlationId
      });
    }

    // Return created claim version DTO
    return reply.status(201).send({
      id: claimId,
      conceptKey: claimConceptKey,
      versionSequence: 1,
      statement,
      status: 'submitted',
      qualifiers,
      recordedAt
    });
  });

  // Guarded state transition
  fastify.post('/v1/claims/:id/transition', async (request, reply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const parseResult = TransitionClaimSchema.safeParse(request.body);
    if (!parseResult.success) {
      const problem = createProblemDetails({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Invalid Transition Payload',
        detail: 'The transition request failed schema validation.',
        invalidParams: parseResult.error.errors.map((e) => ({
          name: e.path.join('.'),
          reason: e.message
        }))
      });
      return reply.status(400).send(problem);
    }

    const { targetState, transitionReason } = parseResult.data;
    const claimVersionId = (request.params as { id: string }).id;

    // Strict Rule: Transition to 'attested' requires 'claims:attest' AND human principal!
    if (targetState === 'attested' && authMiddleware) {
      await authMiddleware.requirePermission('claims:attest')(request, reply);
      if (reply.sent) return;
      await authMiddleware.requireHumanPrincipal(request, reply);
      if (reply.sent) return;
    }

    // Current simulated state
    const currentStatus = 'submitted';

    try {
      ClaimStateMachine.validateTransition(currentStatus, targetState);

      if (authMiddleware && options.auditRepo && request.context) {
        await options.auditRepo.appendAuditEvent({
          tenantId: request.context.tenantId,
          principalId: request.context.principalId,
          action: 'claim.transitioned',
          entityType: 'claim_version',
          entityId: claimVersionId,
          payload: {
            fromStatus: currentStatus,
            toStatus: targetState,
            transitionReason
          },
          correlationId: request.context.correlationId
        });
      }

      return reply.status(200).send({
        claimVersionId,
        fromStatus: currentStatus,
        toStatus: targetState,
        transitionReason,
        transitionedAt: new Date().toISOString()
      });
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        const problem = createProblemDetails({
          status: 409,
          code: 'INVALID_STATE_TRANSITION',
          title: 'Invalid State Transition',
          detail: err.message
        });
        return reply.status(409).send(problem);
      }
      throw err;
    }
  });
};
