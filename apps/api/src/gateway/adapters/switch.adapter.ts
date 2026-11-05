import crypto from 'node:crypto';
import type {
  CanonicalEventEnvelope,
  MessageObservedV1,
  SwitchMessageEventFrame,
  SwitchCommandEventFrame,
  SwitchRoomJoinEventFrame,
  SwitchConnectionStateFrame,
  SwitchPingFrame,
  SwitchPongFrame,
  SwitchGapFrame,
  SwitchEvictedFrame,
  SwitchReviewCasePost,
  SwitchRemediationSummaryPost,
  SwitchPostMessageInput
} from '@proofmesh/contracts';
import {
  SwitchMessageEventFrameSchema,
  SwitchCommandEventFrameSchema,
  SwitchRoomJoinEventFrameSchema,
  SwitchConnectionStateFrameSchema,
  SwitchPingFrameSchema,
  SwitchGapFrameSchema,
  SwitchEvictedFrameSchema,
  createCanonicalEnvelope
} from '@proofmesh/contracts';
import type { ProtocolAdapter, AdapterContext } from './adapter.interface.js';
import { ensureUuid } from './adapter.interface.js';
import { AdapterHealthService } from './adapter-health.service.js';

export interface SwitchAdapterConfig {
  adapterId: string;
  agentId: string;
  serverAddress: string;
  connectionId: string;
  initialRooms?: string[];
  allowUnaddressedObservation?: boolean;
}

export interface SwitchConnectionSnapshot {
  connectionId: string;
  agentId: string;
  cursor: number;
  generation: string | null;
  coveredRooms: string[];
  status: 'connected' | 'disconnected' | 'reconnecting' | 'lapsed';
  lastPingAt: string | null;
}

export type SwitchIncomingFrame =
  | SwitchConnectionStateFrame
  | SwitchPingFrame
  | SwitchGapFrame
  | SwitchEvictedFrame
  | SwitchMessageEventFrame
  | SwitchCommandEventFrame
  | SwitchRoomJoinEventFrame
  | Record<string, unknown>;

export class SwitchAdapter implements ProtocolAdapter<SwitchIncomingFrame, MessageObservedV1> {
  readonly protocolName = 'switch';
  private readonly healthService = AdapterHealthService.getInstance();

  private cursor = 0;
  private generation: string | null = null;
  private coveredRooms: Set<string>;
  private status: 'connected' | 'disconnected' | 'reconnecting' | 'lapsed' = 'disconnected';
  private lastPingAt: string | null = null;
  private readonly processedMessageIds = new Set<string>();

  constructor(private readonly config: SwitchAdapterConfig) {
    this.coveredRooms = new Set(config.initialRooms ?? []);
    this.healthService.registerAdapter(config.adapterId, 'switch', 'disconnected');
  }

  public getSnapshot(): SwitchConnectionSnapshot {
    return {
      connectionId: this.config.connectionId,
      agentId: this.config.agentId,
      cursor: this.cursor,
      generation: this.generation,
      coveredRooms: Array.from(this.coveredRooms),
      status: this.status,
      lastPingAt: this.lastPingAt
    };
  }

  /**
   * Processes a raw incoming text frame from the Switch WebSocket connection.
   * Returns a pong frame if a ping was received, or an array of canonical events.
   */
  public handleFrame(
    frameRaw: string | Record<string, unknown>,
    context: AdapterContext
  ): {
    pong?: SwitchPongFrame;
    events: CanonicalEventEnvelope<MessageObservedV1>[];
    actionRequired?: 'reconnect' | 'cease_reconnect' | 'gap_detected';
  } {
    let frame: Record<string, unknown>;
    try {
      frame = typeof frameRaw === 'string' ? JSON.parse(frameRaw) : frameRaw;
    } catch {
      this.healthService.recordEventRejection(this.config.adapterId);
      return { events: [] };
    }

    // 1. Control Frame: connection_state
    if (frame.type === 'connection_state') {
      const parsed = SwitchConnectionStateFrameSchema.safeParse(frame);
      if (parsed.success) {
        this.generation = parsed.data.generation;
        this.cursor = parsed.data.cursor;
        this.coveredRooms = new Set(parsed.data.rooms);
        this.status = 'connected';
        this.healthService.recordConnectionStatus(this.config.adapterId, 'connected', {
          generation: this.generation,
          rooms: parsed.data.rooms
        });
        this.healthService.recordCursor(this.config.adapterId, this.cursor, this.generation);
      } else {
        this.healthService.recordSchemaIncompatibility(this.config.adapterId);
      }
      return { events: [] };
    }

    // 2. Control Frame: ping -> generate immediate pong with current cursor
    if (frame.type === 'ping') {
      SwitchPingFrameSchema.parse(frame);
      this.lastPingAt = new Date().toISOString();
      const pong: SwitchPongFrame = {
        type: 'pong',
        cursor: this.cursor
      };
      return { pong, events: [] };
    }

    // 3. Control Frame: gap -> update cursor to resumed_at
    if (frame.type === 'gap') {
      const parsed = SwitchGapFrameSchema.safeParse(frame);
      if (parsed.success) {
        this.cursor = parsed.data.resumed_at;
        this.healthService.recordGap(this.config.adapterId, parsed.data.resumed_at);
        return { events: [], actionRequired: 'gap_detected' };
      }
      return { events: [] };
    }

    // 4. Control Frame: evicted
    if (frame.type === 'evicted') {
      const parsed = SwitchEvictedFrameSchema.safeParse(frame);
      if (parsed.success) {
        if (parsed.data.code === 'taken_over') {
          // Final eviction: another client took over. Cease reconnecting permanently.
          this.status = 'disconnected';
          this.healthService.recordConnectionStatus(this.config.adapterId, 'disconnected', {
            evictionCode: 'taken_over',
            reason: parsed.data.reason
          });
          return { events: [], actionRequired: 'cease_reconnect' };
        } else if (parsed.data.code === 'heartbeat_lapsed') {
          // Recoverable: reconnect and resume from cursor
          this.status = 'lapsed';
          this.healthService.recordConnectionStatus(this.config.adapterId, 'lapsed', {
            evictionCode: 'heartbeat_lapsed',
            reason: parsed.data.reason
          });
          return { events: [], actionRequired: 'reconnect' };
        }
      }
      return { events: [] };
    }

    // 5. Domain Events (message, command, room_join)
    const envelopes = this.transform(frame, context);
    return { events: envelopes };
  }

  /**
   * Implements ProtocolAdapter transform interface.
   */
  public transform(
    input: SwitchIncomingFrame,
    context: AdapterContext
  ): CanonicalEventEnvelope<MessageObservedV1>[] {
    // A. Message Event
    const messageResult = SwitchMessageEventFrameSchema.safeParse(input);
    if (messageResult.success) {
      const msg = messageResult.data;
      const payload = msg.data.payload;

      // Update cursor with domain sequence number
      if (msg.data.sequence > this.cursor) {
        this.cursor = msg.data.sequence;
        this.healthService.recordCursor(this.config.adapterId, this.cursor, this.generation);
      }

      // Replay / Deduplication Check
      if (this.processedMessageIds.has(payload.message_id)) {
        return [];
      }
      this.processedMessageIds.add(payload.message_id);

      // Observation filter: If unaddressed messages are not permitted and not addressed, skip
      if (!payload.addressed && !this.config.allowUnaddressedObservation) {
        return [];
      }

      this.healthService.recordEventReceived(this.config.adapterId);

      const isHuman =
        payload.sender.startsWith('@switch-user') || !payload.sender.includes('agent');
      const actorPrincipalType = isHuman ? 'human_user' : 'agent_identity';

      const messageUuid = ensureUuid(
        payload.message_id,
        `switch_msg:${context.tenantId}:${msg.data.room_id}:${payload.message_id}`
      );
      const contentHash = `sha256:${crypto.createHash('sha256').update(payload.body).digest('hex')}`;

      // Build canonical MessageObservedV1 envelope
      const canonicalData: MessageObservedV1 = {
        messageId: messageUuid,
        conversationId: msg.data.room_id,
        role: isHuman ? 'user' : 'assistant',
        content: payload.body,
        contentHash
      };

      const actorUuid = ensureUuid(
        payload.sender,
        `switch_actor:${context.tenantId}:${payload.sender}`
      );

      const envelope = createCanonicalEnvelope<MessageObservedV1>({
        id: crypto.randomUUID(),
        source: `/tenants/${context.tenantId}/integrations/switch/rooms/${msg.data.room_id}`,
        type: 'io.proofmesh.message.observed.v1',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        schemaVersion: '1.0.0',
        sourceIntegration: 'switch',
        instanceIdentity: this.config.agentId,
        actor: {
          principalId: actorUuid,
          principalType: actorPrincipalType
        },
        correlationId: crypto.randomUUID(),
        occurredAt: new Date(payload.timestamp).toISOString(),
        idempotencyKey: `switch_${msg.data.room_id}_${payload.message_id}`,
        captureMethod: 'captured',
        contentMode: 'metadata_only',
        data: canonicalData
      });

      return [envelope];
    }

    // B. Command Event (e.g. !reset, !compact)
    const commandResult = SwitchCommandEventFrameSchema.safeParse(input);
    if (commandResult.success) {
      const cmd = commandResult.data;
      if (cmd.data.sequence > this.cursor) {
        this.cursor = cmd.data.sequence;
        this.healthService.recordCursor(this.config.adapterId, this.cursor, this.generation);
      }
      this.healthService.recordEventReceived(this.config.adapterId);

      const cmdUuid = crypto.randomUUID();
      const cmdContent = `!${cmd.data.payload.command} ${cmd.data.payload.args}`.trim();
      const cmdHash = `sha256:${crypto.createHash('sha256').update(cmdContent).digest('hex')}`;

      const envelope = createCanonicalEnvelope<MessageObservedV1>({
        id: crypto.randomUUID(),
        source: `/tenants/${context.tenantId}/integrations/switch/rooms/${cmd.data.room_id}`,
        type: 'io.proofmesh.message.observed.v1',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        schemaVersion: '1.0.0',
        sourceIntegration: 'switch',
        instanceIdentity: this.config.agentId,
        actor: {
          principalId: cmd.data.payload.user_id,
          principalType: 'human_user'
        },
        correlationId: crypto.randomUUID(),
        idempotencyKey: `switch_cmd_${cmd.data.room_id}_${cmd.id}`,
        captureMethod: 'captured',
        contentMode: 'metadata_only',
        data: {
          messageId: cmdUuid,
          conversationId: cmd.data.room_id,
          role: 'user',
          content: cmdContent,
          contentHash: cmdHash
        }
      });
      return [envelope];
    }

    // C. Room Join Event
    const joinResult = SwitchRoomJoinEventFrameSchema.safeParse(input);
    if (joinResult.success) {
      const join = joinResult.data;
      if (join.data.sequence > this.cursor) {
        this.cursor = join.data.sequence;
        this.healthService.recordCursor(this.config.adapterId, this.cursor, this.generation);
      }
      this.healthService.recordEventReceived(this.config.adapterId);
      return [];
    }

    // Unrecognized or unsupported frame
    this.healthService.recordSchemaIncompatibility(this.config.adapterId);
    return [];
  }

  /**
   * Formats a Review Case into a Switch room message payload to post back.
   */
  public formatReviewCaseMessage(post: SwitchReviewCasePost): SwitchPostMessageInput {
    const content = [
      `### [ProofMesh] Review Case Required: ${post.title}`,
      `**Review Case ID:** \`${post.review_case_id}\``,
      `**Claim Statement:** "${post.claim_statement}"`,
      `**Governance Policy:** \`${post.decision_policy}\``,
      `**Required Reviewer Role:** \`${post.required_role}\``,
      '',
      `**Summary:** ${post.summary}`,
      '',
      '_Please inspect and attest or remediate through the ProofMesh Governance Console._'
    ].join('\n');

    return {
      room_id: post.room_id,
      content,
      metadata: {
        proofmeshCaseId: post.review_case_id,
        kind: 'review_case'
      }
    };
  }

  /**
   * Formats a Remediation Summary into a Switch room message payload to post back.
   */
  public formatRemediationMessage(post: SwitchRemediationSummaryPost): SwitchPostMessageInput {
    const content = [
      `### [ProofMesh] Remediation Summary`,
      `**Remediation ID:** \`${post.remediation_id}\``,
      post.review_case_id ? `**Review Case ID:** \`${post.review_case_id}\`` : '',
      `**Action Type:** \`${post.action_type}\``,
      `**Status:** **${post.status.toUpperCase()}**`,
      '',
      `**Details:** ${post.summary}`
    ]
      .filter(Boolean)
      .join('\n');

    return {
      room_id: post.room_id,
      content,
      metadata: {
        proofmeshRemediationId: post.remediation_id,
        kind: 'remediation_summary'
      }
    };
  }
}
