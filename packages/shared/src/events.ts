export type RealtimeEventName =
  | "conversation.created"
  | "conversation.updated"
  | "message.created"
  | "agent.join_request.created"
  | "agent.join_request.accepted"
  | "agent.join_request.rejected"
  | "agent.joined"
  | "agent.removed"
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
