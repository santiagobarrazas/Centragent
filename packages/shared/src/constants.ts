// Stable enum/constant vocabulary shared across api, mcp, web, and db. Postgres
// enums in schema.prisma mirror these; Zod schemas validate against them.

export const DEFAULT_MASTER_USER_ID = "00000000-0000-4000-8000-000000000001";

// Environment variable each installed tool reads to send its bearer token.
export const TOKEN_ENV_VAR = "CENTRAGENT_TOKEN";
export const TOKEN_PREFIX_USER = "ctg_user_";
export const TOKEN_PREFIX_AGENT = "ctg_agent_";
export const TOKEN_HEADER = "authorization";
export const SESSION_COOKIE = "centragent_session";

// The agent tools Centragent can impersonate / install MCP config into.
export const AGENT_PROVIDERS = [
  "claude_code",
  "codex",
  "kimi_cli",
  "cursor",
  "antigravity",
  "antigravity_cli",
  "gemini_cli",
  "opencode",
  "custom"
] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

// Display-only label for an agent's role in a conversation.
export const AGENT_ROLES = [
  "coder",
  "reviewer",
  "planner",
  "researcher",
  "observer",
  "assistant",
  "custom"
] as const;

export const PRINCIPAL_TYPES = ["user", "agent"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const PROJECT_KINDS = ["workspace", "agent_workspace"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const MEMBERSHIP_STATUSES = [
  "active",
  "pending",
  "invited",
  "removed"
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const DOCUMENT_KINDS = [
  "project_overview",
  "project_asset",
  "conversation_summary",
  "agent_profile",
  "agent_notes"
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const EDIT_SOURCES = ["manual", "agent", "system", "auto_summary"] as const;
export type EditSource = (typeof EDIT_SOURCES)[number];

export const VISIBILITIES = ["shared", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const TOKEN_KINDS = ["user", "agent"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const INVITE_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired"
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const JOIN_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
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

// --- autonomy runtime -------------------------------------------------------

export const AUTONOMY_STATES = [
  "active",
  "paused",
  "requires_approval",
  "disabled"
] as const;
export type AutonomyState = (typeof AUTONOMY_STATES)[number];

export const AGENT_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted"
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_TRIGGERS = [
  "mention",
  "handoff_requested",
  "task_assigned",
  "manual"
] as const;

// Event types that should wake a runner and trigger an agent reaction.
export const AUTONOMY_TRIGGER_EVENT_TYPES = [
  "mention",
  "handoff_requested",
  "task_assigned"
] as const;

export const SYSTEM_FLAG_AUTONOMY = "autonomy_enabled";

export const MESSAGE_SENDER_TYPES = ["user", "agent", "system", "tool"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export const MESSAGE_STATUSES = ["complete", "streaming", "failed"] as const;

// Vector-memory point scope types (Qdrant payload `scopeType`).
export const MEMORY_SCOPE_TYPES = [
  "message",
  "conversation_summary",
  "agent_note",
  "project_asset",
  "fact"
] as const;
export type MemoryScopeType = (typeof MEMORY_SCOPE_TYPES)[number];

export const MEMORY_KINDS = ["episodic", "summary", "fact", "note"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
