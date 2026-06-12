export type RealtimeEventName =
  | "connected"
  | "error"
  | "project.created"
  | "project.updated"
  | "conversation.created"
  | "conversation.updated"
  | "message.created"
  | "document.updated"
  | "membership.created"
  | "membership.updated"
  | "agent.join_request.created"
  | "agent.join_request.accepted"
  | "agent.join_request.rejected"
  | "agent.join_request.timed_out"
  | "agent.join_request.cancelled"
  | "agent.joined"
  | "agent.left"
  | "agent.presence.updated"
  | "agent.activity.started"
  | "agent.activity.finished"
  | "agent.event.created"
  | "agent.event.acknowledged"
  | "memory.indexed";

export type RealtimeEnvelope<TPayload = unknown> = {
  event: RealtimeEventName;
  payload: TPayload;
  // Scope hints used for server-side fanout filtering.
  projectId?: string | null;
  conversationId?: string | null;
  createdAt: string;
};

export const REALTIME_REDIS_CHANNEL = "centragent:events";

export const joinRequestRedisChannel = (joinRequestId: string) =>
  `centragent:join-request:${joinRequestId}`;

export const agentEventsRedisChannel = (agentId: string) =>
  `centragent:agent-events:${agentId}`;
