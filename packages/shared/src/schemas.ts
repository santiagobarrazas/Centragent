import { z } from "zod";
import {
  AGENT_ACTIVITY_STATUSES,
  AGENT_EVENT_DELIVERY_STATUSES,
  AGENT_EVENT_TYPES,
  AGENT_PRESENCE_STATUSES,
  AGENT_PROVIDERS,
  AGENT_ROLES,
  MEMORY_SCOPE_TYPES,
  MESSAGE_ROLES
} from "./constants.js";

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(160)
});

export const createUserMessageSchema = z.object({
  content: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional()
});

export const requestJoinConversationSchema = z.object({
  conversationId: z.string().uuid(),
  agentName: z.string().trim().min(1).max(160),
  agentHandle: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  provider: z.enum(AGENT_PROVIDERS),
  requestedRole: z.enum(AGENT_ROLES),
  clientInstanceId: z.string().trim().min(1).max(256).optional(),
  reason: z.string().trim().max(1000).optional(),
  timeoutSeconds: z.coerce.number().int().min(5).max(900).default(120),
  metadata: z.record(z.unknown()).optional()
});

export const sendAgentMessageSchema = z.object({
  conversationId: z.string().uuid(),
  conversationAgentId: z.string().uuid(),
  content: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional()
});

export const readConversationSchema = z.object({
  conversationId: z.string().uuid(),
  conversationAgentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  direction: z.enum(["before", "after"]).default("before")
});

export const semanticSearchSchema = z.object({
  conversationId: z.string().uuid(),
  conversationAgentId: z.string().uuid().optional(),
  query: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  filters: z
    .object({
      agentId: z.string().uuid().optional(),
      messageId: z.string().uuid().optional(),
      scopeType: z.enum(MEMORY_SCOPE_TYPES).optional()
    })
    .optional()
});

export const listConversationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});

export const rejectJoinRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional()
});

export const messageRoleSchema = z.enum(MESSAGE_ROLES);

export const agentPresenceSchema = z.object({
  conversationAgentId: z.string().uuid(),
  status: z.enum(AGENT_PRESENCE_STATUSES),
  statusMessage: z.string().trim().max(400).optional(),
  activityTitle: z.string().trim().max(240).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const startAgentActivitySchema = z.object({
  conversationAgentId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  metadata: z.record(z.unknown()).optional()
});

export const finishAgentActivitySchema = z.object({
  conversationAgentId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  status: z
    .enum(AGENT_ACTIVITY_STATUSES)
    .refine((status) => status !== "working", {
      message: "finish_agent_activity requires a terminal status"
    })
    .default("completed"),
  metadata: z.record(z.unknown()).optional()
});

export const syncAgentInboxSchema = z.object({
  conversationAgentId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  includeAcknowledged: z.boolean().default(false),
  eventTypes: z.array(z.enum(AGENT_EVENT_TYPES)).optional()
});

export const ackAgentEventsSchema = z.object({
  conversationAgentId: z.string().uuid(),
  deliveryIds: z.array(z.string().uuid()).min(1).max(100)
});

export const waitForAgentEventsSchema = syncAgentInboxSchema.extend({
  timeoutSeconds: z.coerce.number().int().min(5).max(900).default(120)
});

export type RequestJoinConversationInput = z.infer<
  typeof requestJoinConversationSchema
>;
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageSchema>;
export type ReadConversationInput = z.infer<typeof readConversationSchema>;
export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;
export type AgentPresenceInput = z.infer<typeof agentPresenceSchema>;
export type StartAgentActivityInput = z.infer<typeof startAgentActivitySchema>;
export type FinishAgentActivityInput = z.infer<typeof finishAgentActivitySchema>;
export type SyncAgentInboxInput = z.infer<typeof syncAgentInboxSchema>;
export type AckAgentEventsInput = z.infer<typeof ackAgentEventsSchema>;
export type WaitForAgentEventsInput = z.infer<typeof waitForAgentEventsSchema>;
