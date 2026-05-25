import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listConversationsSchema,
  readConversationSchema,
  requestJoinConversationSchema,
  semanticSearchSchema,
  sendAgentMessageSchema
} from "@centragent/shared";
import type { BackendClient } from "./backend-client.js";

const jsonToolResult = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(value, null, 2)
    }
  ]
});

export function createCentragentMcpServer(backend: BackendClient) {
  const server = new McpServer({
    name: "centragent",
    version: "0.1.0"
  });

  server.registerTool(
    "list_conversations",
    {
      title: "List Centragent conversations",
      description: "List conversations that the agent may request to join.",
      inputSchema: listConversationsSchema.shape
    },
    async (input) => {
      const args = listConversationsSchema.parse(input);
      const result = await backend.request("/internal/mcp/conversations", {
        query: args
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "request_join_conversation",
    {
      title: "Request to join conversation",
      description:
        "Request permission from the master user to join an existing Centragent conversation. This call blocks until accepted, rejected, timed out, or cancelled.",
      inputSchema: requestJoinConversationSchema.shape
    },
    async (input, extra) => {
      const args = requestJoinConversationSchema.parse(input);
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
      const result = await backend.request("/internal/mcp/join-requests", {
        method: "POST",
        body: args,
        ...(signal ? { signal } : {})
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "send_message",
    {
      title: "Send message",
      description: "Send a message into a conversation as an accepted agent.",
      inputSchema: sendAgentMessageSchema.shape
    },
    async (input) => {
      const args = sendAgentMessageSchema.parse(input);
      const result = await backend.request("/internal/mcp/messages", {
        method: "POST",
        body: args
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "read_conversation",
    {
      title: "Read conversation",
      description:
        "Read paginated conversation messages. Agents must provide an active conversationAgentId.",
      inputSchema: readConversationSchema.shape
    },
    async (input) => {
      const args = readConversationSchema.parse(input);
      if (!args.conversationAgentId) {
        throw new Error("read_conversation requires conversationAgentId for MCP agents");
      }

      const result = await backend.request(
        `/internal/mcp/conversations/${args.conversationId}`,
        {
          query: {
            conversationAgentId: args.conversationAgentId,
            limit: args.limit,
            cursor: args.cursor,
            direction: args.direction
          }
        }
      );
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "semantic_search_conversation",
    {
      title: "Semantic search conversation",
      description:
        "Search semantically inside one conversation using Qdrant. Agents must provide an active conversationAgentId.",
      inputSchema: semanticSearchSchema.shape
    },
    async (input) => {
      const args = semanticSearchSchema.parse(input);
      if (!args.conversationAgentId) {
        throw new Error(
          "semantic_search_conversation requires conversationAgentId for MCP agents"
        );
      }

      const result = await backend.request(
        `/internal/mcp/conversations/${args.conversationId}/semantic-search`,
        {
          method: "POST",
          body: args
        }
      );
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "centragent_connection_info",
    {
      title: "Centragent connection info",
      description:
        "Show a short reminder of the active Centragent MCP connection and local security model.",
      inputSchema: {
        verbose: z.boolean().optional()
      }
    },
    async () =>
      jsonToolResult({
        service: "centragent",
        mode: "local-mvp",
        note: "Agent identity is self-declared in this MVP. Do not expose this MCP server publicly."
      })
  );

  return server;
}
