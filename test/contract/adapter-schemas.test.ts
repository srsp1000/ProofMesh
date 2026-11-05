import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  SwitchAgentRegistrationInputSchema,
  SwitchConnectionStateFrameSchema,
  SwitchPingFrameSchema,
  SwitchPongFrameSchema,
  SwitchGapFrameSchema,
  SwitchEvictedFrameSchema,
  SwitchMessageEventFrameSchema,
  SwitchReviewCasePostSchema,
  SwitchRemediationSummaryPostSchema,
  WebhookHeadersSchema,
  WebhookIngestPayloadSchema,
  OTLPTracesPayloadSchema,
  AdapterHealthStatusSchema,
  AdapterHealthSummaryResponseSchema
} from '../../packages/contracts/src/index.js';

describe('Adapter Schemas & Contracts (Contract)', () => {
  it('validates Switch agent registration input schema', () => {
    const validRegistration = {
      name: 'kyc-compliance-agent',
      description: 'Reviews KYC transactions',
      connector_type: 'langchain_runtime',
      integration_profile: {
        connection_model: 'always_on',
        message_exchange: true,
        pre_invocation_mediation: [],
        post_invocation_mediation: [],
        event_reporting: []
      }
    };

    const parsed = SwitchAgentRegistrationInputSchema.parse(validRegistration);
    expect(parsed.name).toBe('kyc-compliance-agent');
    expect(parsed.integration_profile.connection_model).toBe('always_on');

    // Invalid agent name regex (uppercase letters not allowed)
    expect(() =>
      SwitchAgentRegistrationInputSchema.parse({
        ...validRegistration,
        name: 'INVALID_UPPERCASE_NAME'
      })
    ).toThrow();
  });

  it('validates Switch WebSocket control frames', () => {
    // 1. connection_state
    const connState = SwitchConnectionStateFrameSchema.parse({
      type: 'connection_state',
      connection_id: crypto.randomUUID(),
      agent_id: 'agent-123',
      generation: 'gen_456',
      scope: 'all',
      filter: 'all',
      rooms: ['room_alpha', 'room_beta'],
      cursor: 500,
      protocol: 6
    });
    expect(connState.rooms).toHaveLength(2);
    expect(connState.cursor).toBe(500);

    // 2. ping & pong
    expect(SwitchPingFrameSchema.parse({ type: 'ping' })).toBeDefined();
    const pong = SwitchPongFrameSchema.parse({ type: 'pong', cursor: 501 });
    expect(pong.cursor).toBe(501);

    // 3. gap
    const gap = SwitchGapFrameSchema.parse({
      type: 'gap',
      from_sequence: 500,
      resumed_at: 750,
      rooms: ['room_alpha'],
      all_rooms: false
    });
    expect(gap.resumed_at).toBe(750);

    // 4. evicted
    const evicted = SwitchEvictedFrameSchema.parse({
      type: 'evicted',
      code: 'taken_over',
      reason: 'Another connection opened with same ID'
    });
    expect(evicted.code).toBe('taken_over');

    // 5. message event frame
    const msgFrame = SwitchMessageEventFrameSchema.parse({
      event: 'message',
      id: 601,
      data: {
        type: 'message',
        room_id: 'room_audit',
        sequence: 601,
        payload: {
          message_id: 'msg_001',
          sender: '@user:alice',
          sender_name: 'Alice',
          body: 'Audit verification in progress',
          timestamp: Date.now(),
          addressed: true
        }
      }
    });
    expect(msgFrame.id).toBe(601);
  });

  it('validates Webhook headers and payload schema', () => {
    const validHeaders = {
      signature: `sha256:${'a'.repeat(64)}`,
      timestamp: String(Date.now()),
      source: 'github' as const,
      idempotencyKey: 'idemp-001'
    };
    const parsedHeaders = WebhookHeadersSchema.parse(validHeaders);
    expect(parsedHeaders.source).toBe('github');

    const validPayload = {
      eventType: 'io.proofmesh.review.approval.v1',
      source: 'github_actions',
      occurredAt: new Date().toISOString(),
      data: {
        reviewCaseId: crypto.randomUUID(),
        decision: 'approved'
      }
    };
    const parsedPayload = WebhookIngestPayloadSchema.parse(validPayload);
    expect(parsedPayload.eventType).toBe('io.proofmesh.review.approval.v1');
  });

  it('validates standard OTLP Traces payload schema', () => {
    const validOtlp = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'audit-svc' } }]
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: '1234567890abcdef1234567890abcdef',
                  spanId: '1234567890abcdef',
                  name: 'GET /verify',
                  kind: 2,
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000500000000'
                }
              ]
            }
          ]
        }
      ]
    };
    const parsed = OTLPTracesPayloadSchema.parse(validOtlp);
    expect(parsed.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe('GET /verify');
  });

  it('validates Adapter Health diagnostics schemas', () => {
    const validHealth = {
      adapterId: 'switch_compliance_agent',
      protocol: 'switch' as const,
      connectionStatus: 'connected' as const,
      lastEventAt: new Date().toISOString(),
      queueLag: 5,
      eventRejectionCount: 0,
      schemaIncompatibilityCount: 0,
      cursorStatus: {
        cursor: 120,
        head: 125,
        generation: 'gen_100',
        gapCount: 0
      },
      droppedEventsCount: 0,
      permissionErrorsCount: 0
    };

    const parsed = AdapterHealthStatusSchema.parse(validHealth);
    expect(parsed.connectionStatus).toBe('connected');

    const summary = AdapterHealthSummaryResponseSchema.parse({
      status: 'healthy',
      adapters: [parsed],
      timestamp: new Date().toISOString()
    });
    expect(summary.status).toBe('healthy');
  });

  it('validates Switch outbound post schemas for reviews and remediations', () => {
    const validReview = SwitchReviewCasePostSchema.parse({
      room_id: 'room_101',
      review_case_id: crypto.randomUUID(),
      title: 'Suspicious Activity Detected',
      summary: 'Transaction exceeds anomaly threshold',
      claim_statement: 'User transferred $500k to offshore account',
      decision_policy: 'policy_aml_v1',
      required_role: 'compliance_manager'
    });
    expect(validReview.title).toBe('Suspicious Activity Detected');

    const validRemediation = SwitchRemediationSummaryPostSchema.parse({
      room_id: 'room_101',
      remediation_id: crypto.randomUUID(),
      action_type: 'freeze_account',
      status: 'completed',
      summary: 'Account temporarily frozen pending KYC interview'
    });
    expect(validRemediation.status).toBe('completed');
  });
});
