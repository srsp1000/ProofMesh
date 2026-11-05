import type { FastifyPluginAsync } from 'fastify';
import {
  SubmitClaimSchema,
  TransitionClaimSchema,
  createProblemDetails
} from '@proofmesh/contracts';
import { ClaimStateMachine, InvalidStateTransitionError } from '@proofmesh/domain';

export const claimRoutes: FastifyPluginAsync = async (fastify) => {
  // Ingestion: submit a claim
  fastify.post('/v1/claims', async (request, reply) => {
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

    // Return created claim version DTO
    return reply.status(201).send({
      id: 'd3b07384-d113-46fb-a0e2-df081fc7e8a9',
      conceptKey: claimConceptKey,
      versionSequence: 1,
      statement,
      status: 'submitted',
      qualifiers,
      recordedAt: new Date().toISOString()
    });
  });

  // Guarded state transition
  fastify.post('/v1/claims/:id/transition', async (request, reply) => {
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
    // Current simulated state for demonstration
    const currentStatus = 'submitted';

    try {
      ClaimStateMachine.validateTransition(currentStatus, targetState);
      return reply.status(200).send({
        claimVersionId: (request.params as { id: string }).id,
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
