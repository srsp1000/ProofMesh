import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { SwitchAdapter } from '../../apps/api/src/gateway/adapters/switch.adapter.js';
import { MockSwitchServer } from '../fixtures/mock-switch-server.js';
import { AdapterHealthService } from '../../apps/api/src/gateway/adapters/adapter-health.service.js';

describe('SwitchAdapter (Unit)', () => {
  const tenantId = crypto.randomUUID();
  const agentId = 'agent_pm_001';
  const connectionId = crypto.randomUUID();
  const context = {
    tenantId,
    actor: {
      principalId: 'agent://switch/test',
      principalType: 'agent_identity' as const
    }
  };

  beforeEach(() => {
    AdapterHealthService.getInstance().reset();
  });

  it('handles connection_state frame and records initial cursor and generation', () => {
    const mockServer = new MockSwitchServer(agentId, connectionId, ['room_governance']);
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId
    });

    const stateFrame = mockServer.connect();
    const res = adapter.handleFrame(stateFrame, context);

    expect(res.events).toHaveLength(0);
    const snapshot = adapter.getSnapshot();
    expect(snapshot.status).toBe('connected');
    expect(snapshot.generation).toBe(mockServer.generation);
    expect(snapshot.cursor).toBe(100);
    expect(snapshot.coveredRooms).toContain('room_governance');
  });

  it('answers ping frame immediately with pong carrying current cursor', () => {
    const mockServer = new MockSwitchServer(agentId, connectionId);
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId
    });

    adapter.handleFrame(mockServer.connect(), context);

    const pingFrame = mockServer.sendPing();
    const res = adapter.handleFrame(pingFrame, context);

    expect(res.pong).toBeDefined();
    expect(res.pong?.type).toBe('pong');
    expect(res.pong?.cursor).toBe(100);

    const ack = mockServer.receivePong(res.pong!);
    expect(ack.acknowledged).toBe(true);
    expect(ack.cursor).toBe(100);
  });

  it('updates cursor and requests history refresh when gap frame is received', () => {
    const mockServer = new MockSwitchServer(agentId, connectionId);
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId
    });

    adapter.handleFrame(mockServer.connect(), context);

    const gapFrame = mockServer.emitGap(250);
    const res = adapter.handleFrame(gapFrame, context);

    expect(res.actionRequired).toBe('gap_detected');
    const snapshot = adapter.getSnapshot();
    expect(snapshot.cursor).toBe(250);
  });

  it('handles eviction frames according to protocol specification', () => {
    const mockServer = new MockSwitchServer(agentId, connectionId);
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId
    });

    adapter.handleFrame(mockServer.connect(), context);

    // 1. Recoverable eviction: heartbeat_lapsed
    const lapsedEviction = mockServer.emitEviction('heartbeat_lapsed');
    const lapsedRes = adapter.handleFrame(lapsedEviction, context);
    expect(lapsedRes.actionRequired).toBe('reconnect');
    expect(adapter.getSnapshot().status).toBe('lapsed');

    // 2. Final eviction: taken_over
    const takeoverEviction = mockServer.emitEviction('taken_over');
    const takeoverRes = adapter.handleFrame(takeoverEviction, context);
    expect(takeoverRes.actionRequired).toBe('cease_reconnect');
    expect(adapter.getSnapshot().status).toBe('disconnected');
  });

  it('captures room messages and maps to canonical MessageObservedV1', () => {
    const mockServer = new MockSwitchServer(agentId, connectionId);
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId,
      allowUnaddressedObservation: true
    });

    adapter.handleFrame(mockServer.connect(), context);

    const msgFrame = mockServer.emitMessage({
      roomId: 'room_dev_1',
      sender: '@switch-user-alice:server.local',
      senderName: 'Alice',
      body: 'Reviewing claim proposal C-101',
      addressed: true
    });

    const res = adapter.handleFrame(msgFrame, context);
    expect(res.events).toHaveLength(1);

    const envelope = res.events[0]!;
    expect(envelope.type).toBe('io.proofmesh.message.observed.v1');
    expect(envelope.actor.principalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(envelope.actor.principalType).toBe('human_user');
    expect(envelope.data.content).toBe('Reviewing claim proposal C-101');
    expect(envelope.data.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(envelope.idempotencyKey).toBe(`switch_room_dev_1_${msgFrame.data.payload.message_id}`);
    expect(adapter.getSnapshot().cursor).toBe(msgFrame.id);
  });

  it('deduplicates identical message frames by message_id', () => {
    const mockServer = new MockSwitchServer(agentId, connectionId);
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId,
      allowUnaddressedObservation: true
    });

    adapter.handleFrame(mockServer.connect(), context);

    const msgFrame = mockServer.emitMessage({
      roomId: 'room_dev_1',
      sender: '@switch-user-alice:server.local',
      body: 'Deduplication test'
    });

    const res1 = adapter.handleFrame(msgFrame, context);
    expect(res1.events).toHaveLength(1);

    // Replay duplicate message frame
    const res2 = adapter.handleFrame(msgFrame, context);
    expect(res2.events).toHaveLength(0);
  });

  it('formats review case and remediation messages for posting back to Switch', () => {
    const adapter = new SwitchAdapter({
      adapterId: 'switch_test',
      agentId,
      serverAddress: 'http://localhost:8000',
      connectionId
    });

    const reviewCaseId = crypto.randomUUID();
    const formattedReview = adapter.formatReviewCaseMessage({
      room_id: 'room_compliance',
      review_case_id: reviewCaseId,
      title: 'High Risk Transfer Claim',
      summary: 'Claim needs human compliance approval',
      claim_statement: 'User net worth exceeds $10M',
      decision_policy: 'policy_kyc_v2',
      required_role: 'compliance_officer'
    });

    expect(formattedReview.room_id).toBe('room_compliance');
    expect(formattedReview.content).toContain('Review Case Required: High Risk Transfer Claim');
    expect(formattedReview.content).toContain(reviewCaseId);
    expect(formattedReview.metadata?.kind).toBe('review_case');

    const remediationId = crypto.randomUUID();
    const formattedRemediation = adapter.formatRemediationMessage({
      room_id: 'room_compliance',
      remediation_id: remediationId,
      review_case_id: reviewCaseId,
      action_type: 'redact_pii',
      status: 'completed',
      summary: 'Customer PII was sanitized before archival'
    });

    expect(formattedRemediation.room_id).toBe('room_compliance');
    expect(formattedRemediation.content).toContain('COMPLETED');
    expect(formattedRemediation.content).toContain(remediationId);
    expect(formattedRemediation.metadata?.kind).toBe('remediation_summary');
  });
});
