export const DEFAULT_MASTER_USER_ID = "00000000-0000-4000-8000-000000000001";

export const AGENT_PROVIDERS = [
  "claude_code",
  "codex",
  "antigravity",
  "gemini_cli",
  "custom"
] as const;

export const AGENT_ROLES = [
  "coder",
  "reviewer",
  "planner",
  "observer",
  "assistant",
  "custom"
] as const;

export const JOIN_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "timed_out"
] as const;

export const CONVERSATION_AGENT_STATUSES = [
  "pending",
  "active",
  "rejected",
  "removed",
  "timed_out"
] as const;

export const AGENT_PRESENCE_STATUSES = [
  "available",
  "working",
  "listening",
  "needs_attention",
  "offline"
] as const;

export const AGENT_ACTIVITY_STATUSES = [
  "working",
  "completed",
  "failed",
  "cancelled"
] as const;

export const AGENT_EVENT_TYPES = [
  "mention",
  "message",
  "task_assigned",
  "handoff_requested",
  "system"
] as const;

export const AGENT_EVENT_DELIVERY_STATUSES = [
  "pending",
  "delivered",
  "acknowledged"
] as const;

export const MESSAGE_SENDER_TYPES = ["user", "agent", "system", "tool"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export const MESSAGE_STATUSES = ["complete", "streaming", "failed"] as const;

export const RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const;

export const RUN_EVENT_TYPES = [
  "token",
  "log",
  "tool_call",
  "tool_result",
  "file_change",
  "error",
  "done"
] as const;

export const MEMORY_SCOPE_TYPES = [
  "conversation",
  "agent",
  "conversation_agent",
  "message",
  "run",
  "global"
] as const;
