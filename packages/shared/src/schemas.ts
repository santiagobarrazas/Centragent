import { z } from "zod";
import {
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

export type RequestJoinConversationInput = z.infer<
  typeof requestJoinConversationSchema
>;
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageSchema>;
export type ReadConversationInput = z.infer<typeof readConversationSchema>;
export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;
