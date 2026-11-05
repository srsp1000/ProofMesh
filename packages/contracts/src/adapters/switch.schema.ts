import { z } from 'zod';

export const SwitchIntegrationProfileSchema = z.object({
  connection_model: z.enum(['always_on', 'session_addressable', 'auto_session', 'session_passive']),
  message_exchange: z.boolean().default(true),
  pre_invocation_mediation: z.array(z.string()).default([]),
  post_invocation_mediation: z.array(z.string()).default([]),
  event_reporting: z.array(z.string()).default([]),
  command_capabilities: z.array(z.string()).optional()
});
export type SwitchIntegrationProfile = z.infer<typeof SwitchIntegrationProfileSchema>;

export const SwitchAgentRegistrationInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      'Agent name must start with a letter/digit and contain only lowercase letters, digits, dots, underscores, or dashes'
    ),
  description: z.string().min(1),
  connector_type: z.string().min(1),
  integration_profile: SwitchIntegrationProfileSchema,
  display_name: z.string().optional(),
  icon_url: z.string().url().optional(),
  tools: z.array(z.record(z.unknown())).optional(),
  models: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  overwrite: z.boolean().optional()
});
export type SwitchAgentRegistrationInput = z.infer<typeof SwitchAgentRegistrationInputSchema>;

export const SwitchAgentRegistrationResponseSchema = z.object({
  id: z.string(),
  api_key: z.string()
});
export type SwitchAgentRegistrationResponse = z.infer<typeof SwitchAgentRegistrationResponseSchema>;

export const SwitchAttachmentGroupMarkerSchema = z.object({
  id: z.string(),
  index: z.number().int().min(0),
  total: z.number().int().min(1)
});
export type SwitchAttachmentGroupMarker = z.infer<typeof SwitchAttachmentGroupMarkerSchema>;

export const SwitchAttachmentReferenceSchema = z.object({
  filename: z.string(),
  mimetype: z.string(),
  size: z.number().int().min(0),
  mxc: z.string(),
  msgtype: z.string()
});
export type SwitchAttachmentReference = z.infer<typeof SwitchAttachmentReferenceSchema>;

export const SwitchMessagePayloadSchema = z.object({
  addressed: z.boolean(),
  sender: z.string(),
  sender_name: z.string().optional(),
  message_id: z.string(),
  body: z.string(),
  timestamp: z.number(),
  thread_id: z.string().nullable().optional(),
  attachments: z.array(SwitchAttachmentReferenceSchema).default([]),
  attachment_group: SwitchAttachmentGroupMarkerSchema.optional()
});
export type SwitchMessagePayload = z.infer<typeof SwitchMessagePayloadSchema>;

export const SwitchMessageEventFrameSchema = z.object({
  event: z.literal('message'),
  id: z.number(),
  data: z.object({
    type: z.literal('message'),
    room_id: z.string(),
    bridge_id: z.string().nullable().optional(),
    channel_type: z.string().nullable().optional(),
    payload: SwitchMessagePayloadSchema,
    sequence: z.number()
  })
});
export type SwitchMessageEventFrame = z.infer<typeof SwitchMessageEventFrameSchema>;

export const SwitchCommandPayloadSchema = z.object({
  command: z.string(),
  args: z.string().default(''),
  user_id: z.string(),
  user_name: z.string().optional(),
  thread_id: z.string().nullable().optional()
});
export type SwitchCommandPayload = z.infer<typeof SwitchCommandPayloadSchema>;

export const SwitchCommandEventFrameSchema = z.object({
  event: z.literal('command'),
  id: z.number(),
  data: z.object({
    type: z.literal('command'),
    room_id: z.string(),
    payload: SwitchCommandPayloadSchema,
    sequence: z.number()
  })
});
export type SwitchCommandEventFrame = z.infer<typeof SwitchCommandEventFrameSchema>;

export const SwitchRoomJoinPayloadSchema = z.object({
  member: z.string(),
  member_name: z.string().optional(),
  timestamp: z.number(),
  listening: z.boolean()
});
export type SwitchRoomJoinPayload = z.infer<typeof SwitchRoomJoinPayloadSchema>;

export const SwitchRoomJoinEventFrameSchema = z.object({
  event: z.literal('room_join'),
  id: z.number(),
  data: z.object({
    type: z.literal('room_join'),
    room_id: z.string(),
    payload: SwitchRoomJoinPayloadSchema,
    sequence: z.number()
  })
});
export type SwitchRoomJoinEventFrame = z.infer<typeof SwitchRoomJoinEventFrameSchema>;

export const SwitchConnectionStateFrameSchema = z.object({
  type: z.literal('connection_state'),
  connection_id: z.string(),
  agent_id: z.string(),
  generation: z.string(),
  scope: z.enum(['single', 'all']),
  filter: z.enum(['all', 'addressed']),
  spawn_capable: z.boolean().optional(),
  rooms: z.array(z.string()),
  cursor: z.number(),
  protocol: z.number().optional(),
  heartbeat_interval_seconds: z.number().optional(),
  server: z.record(z.unknown()).optional(),
  client: z.record(z.unknown()).optional()
});
export type SwitchConnectionStateFrame = z.infer<typeof SwitchConnectionStateFrameSchema>;

export const SwitchPingFrameSchema = z.object({
  type: z.literal('ping')
});
export type SwitchPingFrame = z.infer<typeof SwitchPingFrameSchema>;

export const SwitchPongFrameSchema = z.object({
  type: z.literal('pong'),
  cursor: z.number()
});
export type SwitchPongFrame = z.infer<typeof SwitchPongFrameSchema>;

export const SwitchGapFrameSchema = z.object({
  type: z.literal('gap'),
  from_sequence: z.number(),
  resumed_at: z.number(),
  resumed_position: z.string().optional(),
  rooms: z.array(z.string()),
  all_rooms: z.boolean(),
  reason: z.string().optional()
});
export type SwitchGapFrame = z.infer<typeof SwitchGapFrameSchema>;

export const SwitchEvictedFrameSchema = z.object({
  type: z.literal('evicted'),
  code: z.enum([
    'taken_over',
    'heartbeat_lapsed',
    'no_stream',
    'unfenced',
    'connection_error',
    'closed'
  ]),
  reason: z.string().optional()
});
export type SwitchEvictedFrame = z.infer<typeof SwitchEvictedFrameSchema>;

export const SwitchSubscriptionChangedFrameSchema = z.object({
  type: z.literal('subscription_changed'),
  rooms: z.array(z.string()),
  reason: z.string().optional()
});
export type SwitchSubscriptionChangedFrame = z.infer<typeof SwitchSubscriptionChangedFrameSchema>;

export const SwitchRoomReleasedFrameSchema = z.object({
  type: z.literal('room_released'),
  room_id: z.string(),
  session_id: z.string().nullable().optional()
});
export type SwitchRoomReleasedFrame = z.infer<typeof SwitchRoomReleasedFrameSchema>;

export const SwitchRefusedFrameSchema = z.object({
  type: z.literal('refused'),
  status: z.number(),
  detail: z.string()
});
export type SwitchRefusedFrame = z.infer<typeof SwitchRefusedFrameSchema>;

export const SwitchPostMessageInputSchema = z.object({
  room_id: z.string(),
  content: z.string().min(1),
  thread_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type SwitchPostMessageInput = z.infer<typeof SwitchPostMessageInputSchema>;

export const SwitchReviewCasePostSchema = z.object({
  room_id: z.string(),
  review_case_id: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().min(1),
  claim_statement: z.string().min(1),
  decision_policy: z.string().min(1),
  required_role: z.string().min(1)
});
export type SwitchReviewCasePost = z.infer<typeof SwitchReviewCasePostSchema>;

export const SwitchRemediationSummaryPostSchema = z.object({
  room_id: z.string(),
  remediation_id: z.string().uuid(),
  review_case_id: z.string().uuid().optional(),
  action_type: z.string().min(1),
  status: z.string().min(1),
  summary: z.string().min(1)
});
export type SwitchRemediationSummaryPost = z.infer<typeof SwitchRemediationSummaryPostSchema>;
