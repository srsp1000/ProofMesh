import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ClaimExtractionInputSchema,
  ClaimOccurrenceInputSchema,
  ClaimCorrectionInputSchema,
  MaterialPropositionSchema,
  createProblemDetails
} from '@proofmesh/contracts';
import { ClaimIntelligenceService, ClaimCorrectionService } from '@proofmesh/domain';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import type { GatewayService } from '../gateway/service.js';

export interface ClaimIntelligenceRouteOptions extends Partial<AuthMiddlewareDependencies> {
  gatewayService?: GatewayService;
  claimIntelligence?: ClaimIntelligenceService;
  claimCorrections?: ClaimCorrectionService;
}

const DetectDuplicatesSchema = z.object({
  proposition: MaterialPropositionSchema,
  existingConcepts: z.array(
    z.object({
      id: z.string().uuid(),
      conceptKey: z.string(),
      qualifiers: z.record(z.unknown()).optional()
    })
  )
});

export const claimIntelligenceRoutes: FastifyPluginAsync<ClaimIntelligenceRouteOptions> = async (
  fastify,
  options
) => {
  const authMiddleware =
    options.jwtSigner && options.identityRepo && options.authRepo && options.auditRepo
      ? createAuthMiddleware(options as AuthMiddlewareDependencies)
      : null;

  const intelligenceService = options.claimIntelligence ?? new ClaimIntelligenceService();
  const correctionService = options.claimCorrections ?? new ClaimCorrectionService();

  // 1. Extract Material Propositions from Text
  fastify.post('/v1/claims/extract', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const parseResult = ClaimExtractionInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Claim Extraction Payload',
          detail: 'Extraction payload failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    try {
      const result = intelligenceService.extractPropositions(parseResult.data);
      return reply.status(200).send(result);
    } catch (err) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'EXTRACTION_FAILED',
          title: 'Proposition Extraction Failed',
          detail: (err as Error).message
        })
      );
    }
  });

  // 2. Record Claim Occurrence
  fastify.post('/v1/claims/occurrences', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = ClaimOccurrenceInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Claim Occurrence Payload',
          detail: 'Occurrence payload failed schema validation.'
        })
      );
    }

    try {
      const occurrence = correctionService.recordOccurrence(tenantId, parseResult.data);
      return reply.status(201).send(occurrence);
    } catch (err) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'OCCURRENCE_CREATION_FAILED',
          title: 'Failed to Record Claim Occurrence',
          detail: (err as Error).message
        })
      );
    }
  });

  // 3. Get Occurrences for Claim Version
  fastify.get(
    '/v1/claims/:id/occurrences',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const occurrences = correctionService.getOccurrences(tenantId, request.params.id);
      return reply.status(200).send({ occurrences, count: occurrences.length });
    }
  );

  // 4. Submit Human Correction for Claim Version
  fastify.post(
    '/v1/claims/:id/corrections',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const principalId = request.context?.principalId ?? '00000000-0000-4000-8000-000000000002';

      const bodyWithId = {
        ...(request.body as object),
        claimVersionId: request.params.id
      };

      const parseResult = ClaimCorrectionInputSchema.safeParse(bodyWithId);
      if (!parseResult.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Invalid Claim Correction Payload',
            detail: 'Correction payload failed schema validation.',
            invalidParams: parseResult.error.errors.map((e) => ({
              name: e.path.join('.'),
              reason: e.message
            }))
          })
        );
      }

      try {
        const correction = correctionService.submitCorrection(
          tenantId,
          principalId,
          parseResult.data
        );
        return reply.status(201).send(correction);
      } catch (err) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'CORRECTION_FAILED',
            title: 'Claim Correction Rejected',
            detail: (err as Error).message
          })
        );
      }
    }
  );

  // 5. Get Corrections for Claim Version
  fastify.get(
    '/v1/claims/:id/corrections',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
      const corrections = correctionService.getCorrections(tenantId, request.params.id);
      return reply.status(200).send({ corrections, count: corrections.length });
    }
  );

  // 6. Detect Duplicate Concepts
  fastify.post(
    '/v1/claims/concepts/detect-duplicates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (authMiddleware) {
        await authMiddleware.authenticate(request, reply);
        if (reply.sent) return;
      }

      const parseResult = DetectDuplicatesSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send(
          createProblemDetails({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Invalid Detect Duplicates Payload',
            detail: 'Duplicate detection payload failed schema validation.'
          })
        );
      }

      const candidates = intelligenceService.detectDuplicateConcept(
        parseResult.data.proposition,
        parseResult.data.existingConcepts
      );

      return reply.status(200).send({ candidates, count: candidates.length });
    }
  );
};
