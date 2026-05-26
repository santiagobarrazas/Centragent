export type RealtimeEventName =
  | "conversation.created"
  | "conversation.updated"
  | "message.created"
  | "agent.join_request.created"
  | "agent.join_request.accepted"
  | "agent.join_request.rejected"
  | "agent.joined"
  | "agent.removed"
  | "agent.presence.updated"
  | "agent.activity.started"
  | "agent.activity.finished"
  | "agent.event.created"
  | "agent.event.acknowledged"
  | "semantic_memory.created";

export type RealtimeEnvelope<TPayload = unknown> = {
  event: RealtimeEventName;
  payload: TPayload;
  conversationId?: string | null;
  createdAt: string;
};

export const REALTIME_REDIS_CHANNEL = "centragent:events";

export const joinRequestRedisChannel = (joinRequestId: string) =>
  `centragent:join-request:${joinRequestId}`;

export const agentEventsRedisChannel = (agentId: string) =>
  `centragent:agent-events:${agentId}`;
