import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import type {
  SwitchConnectionStateFrame,
  SwitchPingFrame,
  SwitchPongFrame,
  SwitchGapFrame,
  SwitchEvictedFrame,
  SwitchMessageEventFrame
} from '@proofmesh/contracts';

export class MockSwitchServer extends EventEmitter {
  public isConnected = false;
  public lastPongCursor = 0;
  public pingsSent = 0;
  public connectionId: string;
  public agentId: string;
  public generation: string;
  public currentSequence = 100;
  public rooms: string[];

  constructor(agentId: string, connectionId: string, rooms: string[] = ['room_dev_1']) {
    super();
    this.agentId = agentId;
    this.connectionId = connectionId;
    this.rooms = rooms;
    this.generation = `gen_${crypto.randomBytes(8).toString('hex')}`;
  }

  public connect(): SwitchConnectionStateFrame {
    this.isConnected = true;
    const stateFrame: SwitchConnectionStateFrame = {
      type: 'connection_state',
      connection_id: this.connectionId,
      agent_id: this.agentId,
      generation: this.generation,
      scope: 'all',
      filter: 'all',
      spawn_capable: false,
      rooms: this.rooms,
      cursor: this.currentSequence,
      protocol: 6,
      heartbeat_interval_seconds: 2,
      server: { version: '0.9.4' },
      client: { version: '1.0.0' }
    };
    return stateFrame;
  }

  public sendPing(): SwitchPingFrame {
    this.pingsSent += 1;
    return { type: 'ping' };
  }

  public receivePong(pong: SwitchPongFrame): { acknowledged: boolean; cursor: number } {
    this.lastPongCursor = pong.cursor;
    return { acknowledged: true, cursor: this.lastPongCursor };
  }

  public emitMessage(options: {
    roomId: string;
    sender: string;
    senderName?: string;
    body: string;
    addressed?: boolean;
    threadId?: string;
    attachments?: Array<{
      filename: string;
      mimetype: string;
      size: number;
      mxc: string;
      msgtype: string;
    }>;
  }): SwitchMessageEventFrame {
    this.currentSequence += 1;
    const messageId = `msg_${crypto.randomUUID()}`;

    return {
      event: 'message',
      id: this.currentSequence,
      data: {
        type: 'message',
        room_id: options.roomId,
        bridge_id: 'bridge_slack',
        channel_type: 'channel_public',
        sequence: this.currentSequence,
        payload: {
          message_id: messageId,
          sender: options.sender,
          sender_name: options.senderName ?? 'User',
          body: options.body,
          timestamp: Date.now(),
          addressed: options.addressed ?? false,
          threadId: options.threadId ?? null,
          attachments: options.attachments ?? []
        }
      }
    };
  }

  public emitGap(resumedAt: number, reason = 'retention_window_elapsed'): SwitchGapFrame {
    return {
      type: 'gap',
      from_sequence: this.lastPongCursor,
      resumed_at: resumedAt,
      resumed_position: 'head',
      rooms: this.rooms,
      all_rooms: true,
      reason
    };
  }

  public emitEviction(code: 'taken_over' | 'heartbeat_lapsed' | 'closed'): SwitchEvictedFrame {
    this.isConnected = false;
    return {
      type: 'evicted',
      code,
      reason: `Evicted by test supervisor: ${code}`
    };
  }
}
