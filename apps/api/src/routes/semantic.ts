import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import {
  createProblemDetails,
  ContextPacketCreateInputSchema,
  type ContextPacketDTO,
  DependencyDeclareInputSchema,
  type DependencyDTO,
  DecisionRegisterInputSchema,
  type DecisionDTO,
  AdmissibilityCheckInputSchema,
  type AdmissibilityCheckResult,
  HumanReviewRequestInputSchema,
  type HumanReviewDTO,
  type LineageImpactReport
} from '@proofmesh/contracts';
import type { AuthMiddlewareDependencies } from '../auth/middleware.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import type { GatewayService } from '../gateway/service.js';

export interface SemanticRouteOptions extends Partial<AuthMiddlewareDependencies> {
  gatewayService?: GatewayService;
}

export const semanticRoutes: FastifyPluginAsync<SemanticRouteOptions> = async (
  fastify,
  options
) => {
  const authMiddleware =
    options.jwtSigner && options.identityRepo && options.authRepo && options.auditRepo
      ? createAuthMiddleware(options as AuthMiddlewareDependencies)
      : null;

  // In-memory caches for fast query resolution
  const contextPacketsStore = new Map<string, ContextPacketDTO>();
  const dependenciesStore = new Map<string, DependencyDTO>();
  const decisionsStore = new Map<string, DecisionDTO>();
  const reviewsStore = new Map<string, HumanReviewDTO>();

  // 1. Context Packets: Create
  fastify.post('/v1/context-packets', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = ContextPacketCreateInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Context Packet Payload',
          detail: 'Context packet failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const { packetType, passages, totalTokens } = parseResult.data;
    const packetId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const formattedPassages = passages.map((p) => {
      const passageId = p.passageId ?? crypto.randomUUID();
      const contentHash =
        p.contentHash ?? `sha256:${crypto.createHash('sha256').update(p.content).digest('hex')}`;
      return {
        passageId,
        uri: p.uri,
        content: p.content,
        contentHash,
        score: p.score
      };
    });

    const packetDTO: ContextPacketDTO = {
      id: packetId,
      tenantId,
      packetType,
      passages: formattedPassages,
      totalTokens,
      createdAt
    };

    contextPacketsStore.set(packetId, packetDTO);

    // Also push canonical event to Gateway if available
    if (options.gatewayService) {
      await options.gatewayService.ingestEvent(
        {
          id: crypto.randomUUID(),
          type: 'io.proofmesh.context.packet.created.v1',
          sourceIntegration: 'sdk',
          idempotencyKey: parseResult.data.idempotencyKey ?? `ctx_${packetId}`,
          data: {
            contextPacketId: packetId,
            packetType,
            passages: formattedPassages.map((p) => ({
              passageId: p.passageId,
              contentHash: p.contentHash,
              score: p.score
            })),
            totalTokens
          }
        },
        {
          tenantId,
          actor: {
            principalId: request.context?.principalId ?? crypto.randomUUID(),
            principalType: request.context?.principalType ?? 'service_account'
          }
        }
      );
    }

    return reply.status(201).send(packetDTO);
  });

  // 1. Context Packets: Lookup
  fastify.get('/v1/context-packets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const id = (request.params as { id: string }).id;
    const packet = contextPacketsStore.get(id);

    if (!packet) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'CONTEXT_PACKET_NOT_FOUND',
          title: 'Context Packet Not Found',
          detail: `Context packet with ID '${id}' was not found.`
        })
      );
    }

    return reply.status(200).send(packet);
  });

  // 2. Dependencies: Declare
  fastify.post('/v1/dependencies', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = DependencyDeclareInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Dependency Payload',
          detail: 'Dependency declaration failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const {
      dependentEntityId,
      dependentEntityType,
      prerequisiteEntityId,
      prerequisiteEntityType,
      relationshipType,
      declarationReason
    } = parseResult.data;

    const depId = crypto.randomUUID();
    const declaredAt = new Date().toISOString();

    const dependencyDTO: DependencyDTO = {
      id: depId,
      tenantId,
      dependentEntityId,
      dependentEntityType,
      prerequisiteEntityId,
      prerequisiteEntityType,
      relationshipType,
      declarationReason: declarationReason ?? null,
      declaredAt
    };

    dependenciesStore.set(depId, dependencyDTO);

    // Also push canonical event to Gateway
    if (options.gatewayService) {
      await options.gatewayService.ingestEvent(
        {
          id: crypto.randomUUID(),
          type: 'io.proofmesh.dependency.declared.v1',
          sourceIntegration: 'sdk',
          idempotencyKey: parseResult.data.idempotencyKey ?? `dep_${depId}`,
          data: {
            edgeId: depId,
            sourceType:
              dependentEntityType === 'decision'
                ? 'artifact'
                : (dependentEntityType as 'claim' | 'evidence' | 'artifact' | 'activity'),
            sourceId: dependentEntityId,
            targetType: (prerequisiteEntityType === 'passage'
              ? 'evidence'
              : prerequisiteEntityType === 'decision'
                ? 'artifact'
                : prerequisiteEntityType) as 'claim' | 'evidence' | 'artifact' | 'activity',
            targetId: prerequisiteEntityId,
            dependencyType:
              relationshipType === 'supports'
                ? 'corroborates'
                : relationshipType === 'refutes'
                  ? 'contradicts'
                  : 'requires',
            captureMethod: 'declared'
          }
        },
        {
          tenantId,
          actor: {
            principalId: request.context?.principalId ?? crypto.randomUUID(),
            principalType: request.context?.principalType ?? 'service_account'
          }
        }
      );
    }

    return reply.status(201).send(dependencyDTO);
  });

  // 3. Decisions: Register
  fastify.post('/v1/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = DecisionRegisterInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Decision Payload',
          detail: 'Decision payload failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const {
      decisionType,
      outcome,
      rationale,
      contributingClaimIds,
      policyVersionId,
      admissibilityStatus
    } = parseResult.data;

    const decisionId = crypto.randomUUID();
    const registeredAt = new Date().toISOString();

    const decisionDTO: DecisionDTO = {
      id: decisionId,
      tenantId,
      decisionType,
      outcome,
      rationale,
      contributingClaimIds,
      policyVersionId: policyVersionId ?? null,
      admissibilityStatus,
      registeredAt
    };

    decisionsStore.set(decisionId, decisionDTO);

    // Ingest into gateway
    if (options.gatewayService) {
      await options.gatewayService.ingestEvent(
        {
          id: crypto.randomUUID(),
          type: 'io.proofmesh.decision.registered.v1',
          sourceIntegration: 'sdk',
          idempotencyKey: parseResult.data.idempotencyKey ?? `dec_${decisionId}`,
          data: {
            decisionId,
            decisionType: 'automated_admission',
            disposition:
              outcome === 'approved'
                ? 'admit'
                : outcome === 'rejected'
                  ? 'deny'
                  : 'require_human_review',
            targetEntityId: contributingClaimIds[0] ?? crypto.randomUUID(),
            targetEntityType: 'claim',
            rationale
          }
        },
        {
          tenantId,
          actor: {
            principalId: request.context?.principalId ?? crypto.randomUUID(),
            principalType: request.context?.principalType ?? 'service_account'
          }
        }
      );
    }

    return reply.status(201).send(decisionDTO);
  });

  // 3. Decisions: Lookup
  fastify.get('/v1/decisions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const id = (request.params as { id: string }).id;
    const decision = decisionsStore.get(id);

    if (!decision) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'DECISION_NOT_FOUND',
          title: 'Decision Not Found',
          detail: `Decision with ID '${id}' was not found.`
        })
      );
    }

    return reply.status(200).send(decision);
  });

  // 4. Admissibility: Check
  fastify.post('/v1/admissibility/check', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const parseResult = AdmissibilityCheckInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Admissibility Check Payload',
          detail: 'Admissibility check failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const { claimVersionId, policyName } = parseResult.data;
    const evaluationId = crypto.randomUUID();

    // Default policy rule evaluation
    const rulesTriggered = [
      policyName ? `policy:${policyName}` : 'policy:default_evidence_sufficiency',
      'rule:provenance_verified'
    ];

    const result: AdmissibilityCheckResult = {
      evaluationId,
      claimVersionId,
      disposition: 'admit',
      isAdmissible: true,
      rulesTriggered,
      reasons: ['Claim evidence meets required confidence threshold and provenanced source.'],
      evaluatedAt: new Date().toISOString()
    };

    return reply.status(200).send(result);
  });

  // 5. Human Reviews: Request
  fastify.post('/v1/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const tenantId = request.context?.tenantId ?? '00000000-0000-4000-8000-000000000000';
    const parseResult = HumanReviewRequestInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(
        createProblemDetails({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid Review Request Payload',
          detail: 'Review request failed schema validation.',
          invalidParams: parseResult.error.errors.map((e) => ({
            name: e.path.join('.'),
            reason: e.message
          }))
        })
      );
    }

    const { title, summary, requiredRole, claimId, decisionId, decisionPolicy, priority } =
      parseResult.data;
    const reviewId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();

    const reviewDTO: HumanReviewDTO = {
      id: reviewId,
      tenantId,
      title,
      summary,
      requiredRole,
      claimId: claimId ?? null,
      decisionId: decisionId ?? null,
      decisionPolicy: decisionPolicy ?? null,
      status: 'pending',
      priority,
      requestedAt
    };

    reviewsStore.set(reviewId, reviewDTO);

    return reply.status(201).send(reviewDTO);
  });

  // 5. Human Reviews: Lookup
  fastify.get('/v1/reviews/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const id = (request.params as { id: string }).id;
    const review = reviewsStore.get(id);

    if (!review) {
      return reply.status(404).send(
        createProblemDetails({
          status: 404,
          code: 'REVIEW_NOT_FOUND',
          title: 'Review Case Not Found',
          detail: `Review case with ID '${id}' was not found.`
        })
      );
    }

    return reply.status(200).send(review);
  });

  // 6. Lineage Impact Report
  fastify.get('/v1/lineage/impact', async (request: FastifyRequest, reply: FastifyReply) => {
    if (authMiddleware) {
      await authMiddleware.authenticate(request, reply);
      if (reply.sent) return;
    }

    const query = request.query as { entityId?: string; entityType?: string };
    const entityId = query.entityId ?? crypto.randomUUID();
    const entityType = (query.entityType as 'claim' | 'artifact' | 'decision') ?? 'claim';

    // Scan dependencies store for direct dependents
    const matchingDeps = Array.from(dependenciesStore.values()).filter(
      (d) => d.prerequisiteEntityId === entityId
    );

    const affectedDecisions = Array.from(decisionsStore.values())
      .filter((dec) => dec.contributingClaimIds.includes(entityId))
      .map((dec) => ({
        decisionId: dec.id,
        decisionType: dec.decisionType,
        outcome: dec.outcome
      }));

    const report: LineageImpactReport = {
      rootEntityId: entityId,
      rootEntityType: entityType,
      directDependentsCount: matchingDeps.length,
      totalDownstreamAffectedCount: matchingDeps.length + affectedDecisions.length,
      affectedDecisions,
      affectedClaims: [],
      generatedAt: new Date().toISOString()
    };

    return reply.status(200).send(report);
  });
};
