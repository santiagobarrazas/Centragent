import { z } from "zod";
import {
  AGENT_ACTIVITY_STATUSES,
  AGENT_EVENT_TYPES,
  AGENT_PRESENCE_STATUSES,
  AGENT_PROVIDERS,
  AGENT_ROLES,
  DOCUMENT_KINDS,
  MEMORY_SCOPE_TYPES,
  MESSAGE_ROLES,
  PROJECT_ROLES,
  TOKEN_KINDS
} from "./constants.js";

// --- primitives -------------------------------------------------------------

const handle = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, numbers, '-' and '_' only");

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, numbers and '-' only");

const metadata = z.record(z.unknown()).optional();

// --- accounts & sessions ----------------------------------------------------

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200)
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200)
});

// --- tokens -----------------------------------------------------------------

export const createTokenSchema = z.object({
  kind: z.enum(TOKEN_KINDS).default("agent"),
  // Required when kind = agent; must be an agent the caller owns.
  agentId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(160),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional()
});

export const revokeTokenSchema = z.object({
  tokenId: z.string().uuid()
});

// --- agents -----------------------------------------------------------------

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  handle: handle.optional(),
  provider: z.enum(AGENT_PROVIDERS).default("custom"),
  description: z.string().trim().max(2000).optional(),
  notesAgentEditable: z.boolean().optional(),
  clientInstanceId: z.string().trim().min(1).max(256).optional(),
  metadata
});

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  notesAgentEditable: z.boolean().optional()
});

// --- projects ---------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: slug.optional(),
  summary: z.string().trim().max(2000).optional()
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().max(2000).optional()
});

export const listProjectsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});

// --- conversations & messages ----------------------------------------------

export const createConversationSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160)
});

export const listConversationsSchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});

export const createUserMessageSchema = z.object({
  content: z.string().trim().min(1),
  metadata
});

// --- memberships, invites, join requests ------------------------------------

export const requestJoinConversationSchema = z.object({
  conversationId: z.string().uuid(),
  requestedRole: z.enum(AGENT_ROLES).default("assistant"),
  reason: z.string().trim().max(1000).optional(),
  timeoutSeconds: z.coerce.number().int().min(5).max(900).default(120),
  metadata
});

export const rejectJoinRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional()
});

export const createInviteSchema = z.object({
  projectId: z.string().uuid(),
  email: z.string().trim().email().optional(),
  role: z.enum(PROJECT_ROLES).default("member"),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(14)
});

export const acceptInviteSchema = z.object({
  code: z.string().trim().min(8)
});

export const grantMembershipSchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    role: z.enum(PROJECT_ROLES).default("member")
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.agentId), {
    message: "Provide exactly one of userId or agentId"
  });

export const updateMembershipSchema = z.object({
  role: z.enum(PROJECT_ROLES).optional(),
  status: z.enum(["active", "removed"]).optional()
});

// --- documents (living .md) -------------------------------------------------

export const createAssetSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  slug: slug.optional(),
  content: z.string().max(500_000).default("")
});

export const updateDocumentSchema = z.object({
  content: z.string().max(500_000),
  changeSummary: z.string().trim().max(500).optional()
});

// Reference a document either by id or by (kind + scope). The service resolves.
const documentRefObject = z.object({
  documentId: z.string().uuid().optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  projectId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  slug: z.string().optional()
});
// Raw shape (for MCP tool inputSchema, which needs a ZodRawShape, not effects).
export const documentRefShape = documentRefObject.shape;
export const documentRefSchema = documentRefObject.refine(
  (value) => Boolean(value.documentId) || Boolean(value.kind),
  { message: "Provide documentId or kind" }
);

// --- semantic memory --------------------------------------------------------

export const searchMemorySchema = z.object({
  query: z.string().trim().min(1),
  projectId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  scopeType: z.enum(MEMORY_SCOPE_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  responseFormat: z.enum(["concise", "detailed"]).default("detailed")
});

// --- MCP tool args (identity ALWAYS comes from the token, never the args) ----

export const emptyToolSchema = z.object({});

export const whoamiSchema = z.object({
  verbose: z.boolean().optional()
});

export const listMyAgentsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const sendAgentMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1),
  metadata
});

export const readConversationSchema = z.object({
  conversationId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  direction: z.enum(["before", "after"]).default("before")
});

export const mcpUpdateDocumentSchema = updateDocumentSchema.extend({
  documentId: z.string().uuid()
});

export const noteAppendSchema = z.object({
  // Defaults to the calling agent; an owner-token may target an owned agent.
  agentId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(20_000),
  heading: z.string().trim().max(200).optional()
});

// --- presence / activity / inbox (agent identity from token) ----------------

export const agentPresenceSchema = z.object({
  conversationId: z.string().uuid(),
  status: z.enum(AGENT_PRESENCE_STATUSES),
  statusMessage: z.string().trim().max(400).optional(),
  activityTitle: z.string().trim().max(240).optional(),
  metadata
});

export const startAgentActivitySchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  metadata
});

export const finishAgentActivitySchema = z.object({
  conversationId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  status: z
    .enum(AGENT_ACTIVITY_STATUSES)
    .refine((status) => status !== "working", {
      message: "finish_agent_activity requires a terminal status"
    })
    .default("completed"),
  metadata
});

export const syncAgentInboxSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  includeAcknowledged: z.boolean().default(false),
  eventTypes: z.array(z.enum(AGENT_EVENT_TYPES)).optional()
});

export const ackAgentEventsSchema = z.object({
  deliveryIds: z.array(z.string().uuid()).min(1).max(100)
});

export const waitForAgentEventsSchema = syncAgentInboxSchema.extend({
  timeoutSeconds: z.coerce.number().int().min(5).max(900).default(120)
});

// --- coordination -----------------------------------------------------------

export const assignTaskSchema = z.object({
  conversationId: z.string().uuid(),
  targetHandle: handle,
  title: z.string().trim().min(1).max(240),
  content: z.string().trim().max(4000).optional()
});

export const requestHandoffSchema = z.object({
  conversationId: z.string().uuid(),
  targetHandle: handle,
  reason: z.string().trim().max(2000).optional()
});

export const messageRoleSchema = z.enum(MESSAGE_ROLES);

// --- inferred types ---------------------------------------------------------

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateTokenInput = z.infer<typeof createTokenSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type CreateUserMessageInput = z.infer<typeof createUserMessageSchema>;
export type RequestJoinConversationInput = z.infer<
  typeof requestJoinConversationSchema
>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type GrantMembershipInput = z.infer<typeof grantMembershipSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DocumentRefInput = z.infer<typeof documentRefSchema>;
export type SearchMemoryInput = z.infer<typeof searchMemorySchema>;
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageSchema>;
export type ReadConversationInput = z.infer<typeof readConversationSchema>;
export type McpUpdateDocumentInput = z.infer<typeof mcpUpdateDocumentSchema>;
export type NoteAppendInput = z.infer<typeof noteAppendSchema>;
export type AgentPresenceInput = z.infer<typeof agentPresenceSchema>;
export type StartAgentActivityInput = z.infer<typeof startAgentActivitySchema>;
export type FinishAgentActivityInput = z.infer<typeof finishAgentActivitySchema>;
export type SyncAgentInboxInput = z.infer<typeof syncAgentInboxSchema>;
export type AckAgentEventsInput = z.infer<typeof ackAgentEventsSchema>;
export type WaitForAgentEventsInput = z.infer<typeof waitForAgentEventsSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
export type RequestHandoffInput = z.infer<typeof requestHandoffSchema>;
