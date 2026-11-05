import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  TelemetrySpanReceivedV1Schema,
  AgentActivityV1Schema,
  MessageObservedV1Schema,
  SourceArtifactRegisteredV1Schema,
  ClaimRegisteredV1Schema,
  ContextPacketCreatedV1Schema,
  DependencyDeclaredV1Schema,
  DecisionRegisteredV1Schema,
  ReviewApprovalV1Schema,
  RemediationEventV1Schema,
  ConnectorHealthV1Schema
} from '../../packages/contracts/src/events/event-families.schema.js';
import { EventSchemaRegistry } from '../../packages/domain/src/gateway/schema-registry.js';

describe('Typed Event Families & Schema Registry (Unit)', () => {
  const validHash = `sha256:${'a'.repeat(64)}`;

  it('validates all 11 typed event families schemas correctly', () => {
    // 1. Telemetry Span
    const span = TelemetrySpanReceivedV1Schema.parse({
      spanId: 'span-01',
      traceId: 'trace-01',
      name: 'chat_completion',
      kind: 'server',
      startTimeUnixNano: '1600000000000',
      endTimeUnixNano: '1600000001000',
      attributes: { 'llm.model': 'claude-3-5-sonnet' },
      status: { code: 'ok' }
    });
    expect(span.name).toBe('chat_completion');

    // 2. Agent Activity
    const activity = AgentActivityV1Schema.parse({
      activityId: crypto.randomUUID(),
      agentId: 'agent-auditor',
      agentRole: 'compliance_checker',
      activityType: 'tool_call',
      toolName: 'query_vector_db',
      toolParameters: { topK: 5 },
      executionStatus: 'completed',
      durationMs: 42
    });
    expect(activity.executionStatus).toBe('completed');

    // 3. Message Observed
    const message = MessageObservedV1Schema.parse({
      messageId: crypto.randomUUID(),
      conversationId: 'conv-123',
      role: 'user',
      content: 'What is the credit policy?',
      contentHash: validHash,
      tokenCount: 8
    });
    expect(message.role).toBe('user');

    // 4. Source Artifact
    const artifact = SourceArtifactRegisteredV1Schema.parse({
      artifactId: crypto.randomUUID(),
      artifactVersion: 1,
      uri: 's3://proofmesh-artifacts/kyc-policy.pdf',
      mimeType: 'application/pdf',
      contentHash: validHash,
      byteSize: 1048576,
      action: 'registered'
    });
    expect(artifact.action).toBe('registered');

    // 5. Claim Registered
    const claim = ClaimRegisteredV1Schema.parse({
      claimConceptId: crypto.randomUUID(),
      claimVersionId: crypto.randomUUID(),
      conceptKey: 'identity-verified',
      statement: 'User KYC has passed.',
      status: 'submitted'
    });
    expect(claim.conceptKey).toBe('identity-verified');

    // 6. Context Packet
    const packet = ContextPacketCreatedV1Schema.parse({
      contextPacketId: crypto.randomUUID(),
      packetType: 'rag_retrieval',
      passages: [{ passageId: crypto.randomUUID(), contentHash: validHash, score: 0.95 }]
    });
    expect(packet.passages.length).toBe(1);

    // 7. Dependency Declared
    const dep = DependencyDeclaredV1Schema.parse({
      edgeId: crypto.randomUUID(),
      sourceType: 'claim',
      sourceId: crypto.randomUUID(),
      targetType: 'evidence',
      targetId: crypto.randomUUID(),
      dependencyType: 'corroborates',
      captureMethod: 'captured'
    });
    expect(dep.dependencyType).toBe('corroborates');

    // 8. Decision Registered
    const decision = DecisionRegisteredV1Schema.parse({
      decisionId: crypto.randomUUID(),
      decisionType: 'policy_disposition',
      disposition: 'admit',
      targetEntityId: crypto.randomUUID(),
      targetEntityType: 'claim',
      rationale: 'All checks passed'
    });
    expect(decision.disposition).toBe('admit');

    // 9. Review Approval
    const approval = ReviewApprovalV1Schema.parse({
      approvalId: crypto.randomUUID(),
      reviewCaseId: crypto.randomUUID(),
      reviewerPrincipalId: crypto.randomUUID(),
      verdict: 'approved',
      statement: 'Approved by lead officer'
    });
    expect(approval.verdict).toBe('approved');

    // 10. Remediation Event
    const remediation = RemediationEventV1Schema.parse({
      remediationId: crypto.randomUUID(),
      caseId: crypto.randomUUID(),
      remediationType: 'context_filter',
      status: 'completed',
      actionsTaken: ['filtered_harmful_token']
    });
    expect(remediation.status).toBe('completed');

    // 11. Connector Health
    const health = ConnectorHealthV1Schema.parse({
      connectorId: 'otel-conn',
      connectorType: 'otel',
      status: 'healthy',
      latencyMs: 15,
      errorCount: 0,
      lastHeartbeat: new Date().toISOString()
    });
    expect(health.status).toBe('healthy');
  });

  it('rejects unsupported event types and invalid payloads via EventSchemaRegistry', () => {
    const registry = EventSchemaRegistry.getInstance();

    // Unsupported type
    const unsupportedTypeRes = registry.validate('io.proofmesh.unknown.event.v1', 'v1', {});
    expect(unsupportedTypeRes.success).toBe(false);
    expect(unsupportedTypeRes.errors[0]).toContain('Unknown or unsupported event type');

    // Unsupported version
    const unsupportedVerRes = registry.validate('io.proofmesh.claim.registered.v1', 'v99', {});
    expect(unsupportedVerRes.success).toBe(false);
    expect(unsupportedVerRes.errors[0]).toContain("Schema version 'v99' is not supported");

    // Invalid payload
    const invalidPayloadRes = registry.validate('io.proofmesh.claim.registered.v1', 'v1', {
      conceptKey: 'test'
      // missing required fields
    });
    expect(invalidPayloadRes.success).toBe(false);
    expect(invalidPayloadRes.errors.length).toBeGreaterThan(0);
  });

  it('supports deprecation lifecycle and sunset date tracking', () => {
    const registry = EventSchemaRegistry.getInstance();
    const eventType = 'io.proofmesh.claim.registered.v1';

    expect(registry.isDeprecated(eventType, 'v1').deprecated).toBe(false);

    const sunset = '2027-05-01T00:00:00Z';
    registry.markDeprecated(eventType, 'v1', sunset);

    const depStatus = registry.isDeprecated(eventType, 'v1');
    expect(depStatus.deprecated).toBe(true);
    expect(depStatus.sunsetDate).toBe(sunset);
  });
});
