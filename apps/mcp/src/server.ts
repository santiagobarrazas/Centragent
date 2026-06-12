import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ackAgentEventsSchema,
  agentPresenceSchema,
  createAgentSchema,
  createConversationSchema,
  createProjectSchema,
  documentRefShape,
  finishAgentActivitySchema,
  listConversationsSchema,
  listMyAgentsSchema,
  mcpUpdateDocumentSchema,
  noteAppendSchema,
  readConversationSchema,
  requestJoinConversationSchema,
  searchMemorySchema,
  sendAgentMessageSchema,
  startAgentActivitySchema,
  syncAgentInboxSchema,
  waitForAgentEventsSchema,
  whoamiSchema
} from "@centragent/shared";
import type { BackendClient } from "./backend-client.js";

const INSTRUCTIONS = `Centragent is a control plane for multi-agent collaboration.

HIERARCHY: Projects contain Conversations, Assets (.md docs), and Members. Each
Conversation has a continuously-updated summary.md. Each Agent has a public
profile.md and PRIVATE notes only it (and its owner) can read.

IDENTITY: You are identified by your token — you act as one specific agent (or as
your user). You can only act as agents your user owns; you cannot impersonate
others. Call centragent_whoami first to see who you are.

TYPICAL LOOP:
1. centragent_whoami → confirm identity and owned agents.
2. centragent_list_projects / centragent_list_conversations → find where to work.
3. centragent_request_join_conversation → ask the owner to let you in (blocks
   until accepted). You only need to join once per conversation.
4. centragent_set_presence "working" before focused work so mentions queue in
   your inbox instead of interrupting.
5. centragent_read_conversation and read the conversation summary resource for
   context; centragent_search_memory for semantic recall.
6. centragent_send_message to participate. Mention teammates with @handle.
7. After a task: centragent_inbox_sync → handle events → centragent_inbox_ack.
   Use centragent_inbox_wait only when idle.
8. Keep your profile and private notes current with centragent_update_document
   and centragent_append_note.

Read the resource centragent://onboarding for the full playbook.`;

const jsonToolResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});

const errorResult = (error: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error)
    }
  ]
});

const signalOf = (extra: unknown) =>
  (extra as { signal?: AbortSignal } | undefined)?.signal;

export function createCentragentMcpServer(backend: BackendClient) {
  const server = new McpServer(
    { name: "centragent", version: "0.2.0" },
    { instructions: INSTRUCTIONS }
  );

  const tool = (
    name: string,
    config: { title: string; description: string; inputSchema?: z.ZodRawShape },
    run: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
  ) => {
    server.registerTool(
      name,
      { title: config.title, description: config.description, inputSchema: config.inputSchema ?? {} },
      async (args: Record<string, unknown>, extra: unknown) => {
        try {
          return jsonToolResult(await run(args ?? {}, extra));
        } catch (error) {
          return errorResult(error);
        }
      }
    );
  };

  // --- identity & discovery -------------------------------------------------

  tool(
    "centragent_whoami",
    {
      title: "Who am I",
      description:
        "Show the user and agent this token acts as, and the agents the user owns. Call this first.",
      inputSchema: whoamiSchema.shape
    },
    () => backend.request("/whoami")
  );

  tool(
    "centragent_list_my_agents",
    {
      title: "List my agents",
      description: "List the persistent agents owned by your user.",
      inputSchema: listMyAgentsSchema.shape
    },
    () => backend.request("/agents")
  );

  tool(
    "centragent_create_agent",
    {
      title: "Create an agent",
      description:
        "Create a new persistent agent owned by your user. It gets a profile.md, private notes, and a private workspace project.",
      inputSchema: createAgentSchema.shape
    },
    (args) => backend.request("/agents", { method: "POST", body: args })
  );

  tool(
    "centragent_list_projects",
    {
      title: "List projects",
      description: "List projects you can access.",
      inputSchema: { limit: z.coerce.number().int().min(1).max(100).optional() }
    },
    (args) => backend.request("/projects", { query: { limit: args.limit as number | undefined } })
  );

  tool(
    "centragent_create_project",
    {
      title: "Create a project",
      description: "Create a new project (workspace) you own.",
      inputSchema: createProjectSchema.shape
    },
    (args) => backend.request("/projects", { method: "POST", body: args })
  );

  tool(
    "centragent_list_conversations",
    {
      title: "List conversations",
      description:
        "List conversations you can see. As an agent, this is the conversations you have joined (optionally filtered by projectId).",
      inputSchema: listConversationsSchema.shape
    },
    (args) =>
      backend.request("/conversations", {
        query: {
          projectId: args.projectId as string | undefined,
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined
        }
      })
  );

  tool(
    "centragent_create_conversation",
    {
      title: "Create a conversation",
      description: "Start a new conversation inside a project you are a member of.",
      inputSchema: createConversationSchema.shape
    },
    (args) => backend.request("/conversations", { method: "POST", body: args })
  );

  // --- membership -----------------------------------------------------------

  tool(
    "centragent_request_join_conversation",
    {
      title: "Request to join a conversation",
      description:
        "Ask a project admin to admit your agent to a conversation. Blocks until accepted, rejected, timed out, or cancelled. Idempotent if already a member.",
      inputSchema: requestJoinConversationSchema.shape
    },
    (args, extra) =>
      backend.request("/agent/join-requests", {
        method: "POST",
        body: args,
        signal: signalOf(extra)
      })
  );

  // --- messaging & reading --------------------------------------------------

  tool(
    "centragent_send_message",
    {
      title: "Send a message",
      description:
        "Post a message to a conversation you have joined. Mention teammates with @handle to notify them.",
      inputSchema: sendAgentMessageSchema.shape
    },
    (args) => backend.request("/agent/messages", { method: "POST", body: args })
  );

  tool(
    "centragent_read_conversation",
    {
      title: "Read a conversation",
      description: "Read paginated messages from a conversation you can access.",
      inputSchema: readConversationSchema.shape
    },
    (args) => backend.request("/agent/read", { method: "POST", body: args })
  );

  tool(
    "centragent_search_memory",
    {
      title: "Search memory",
      description:
        "Semantic search over messages, summaries, assets, and your own private notes. Scope with projectId or conversationId.",
      inputSchema: searchMemorySchema.shape
    },
    (args) => backend.request("/search", { method: "POST", body: args })
  );

  // --- documents & notes ----------------------------------------------------

  tool(
    "centragent_read_document",
    {
      title: "Read a document",
      description:
        "Read a living .md document by id, or by kind + scope (project_overview, project_asset, conversation_summary, agent_profile, agent_notes).",
      inputSchema: documentRefShape
    },
    (args) => backend.request("/documents/read", { method: "POST", body: args })
  );

  tool(
    "centragent_update_document",
    {
      title: "Update a document",
      description:
        "Replace a document's content (creates a new version). Allowed only where the document is agent-editable; notes also require the per-agent toggle.",
      inputSchema: mcpUpdateDocumentSchema.shape
    },
    (args) =>
      backend.request(`/documents/${args.documentId as string}`, {
        method: "PUT",
        body: { content: args.content, changeSummary: args.changeSummary }
      })
  );

  tool(
    "centragent_append_note",
    {
      title: "Append to your private notes",
      description:
        "Append a block to your agent's private notes (visible only to you and your owner). Requires your owner to have enabled agent note editing.",
      inputSchema: noteAppendSchema.shape
    },
    (args) => backend.request("/notes/append", { method: "POST", body: args })
  );

  // --- presence / activity / inbox ------------------------------------------

  tool(
    "centragent_set_presence",
    {
      title: "Set presence",
      description:
        "Declare your status in a conversation (available | working | listening | needs_attention | offline). Use 'working' during focused work.",
      inputSchema: agentPresenceSchema.shape
    },
    (args) => backend.request("/agent/presence", { method: "POST", body: args })
  );

  tool(
    "centragent_start_activity",
    {
      title: "Start an activity",
      description:
        "Mark the start of focused work in a conversation. Sets presence to 'working' so mentions queue in your inbox.",
      inputSchema: startAgentActivitySchema.shape
    },
    (args) => backend.request("/agent/activities/start", { method: "POST", body: args })
  );

  tool(
    "centragent_finish_activity",
    {
      title: "Finish an activity",
      description:
        "Mark focused work complete/failed/cancelled and immediately return any pending inbox events to handle next.",
      inputSchema: finishAgentActivitySchema.shape
    },
    (args) => backend.request("/agent/activities/finish", { method: "POST", body: args })
  );

  tool(
    "centragent_inbox_sync",
    {
      title: "Sync inbox",
      description:
        "Non-blocking: fetch queued mentions, handoffs, and task assignments. Call after finishing a task.",
      inputSchema: syncAgentInboxSchema.shape
    },
    (args) => backend.request("/agent/inbox/sync", { method: "POST", body: args })
  );

  tool(
    "centragent_inbox_ack",
    {
      title: "Acknowledge inbox events",
      description: "Acknowledge inbox deliveries you have handled (use deliveryIds from sync).",
      inputSchema: ackAgentEventsSchema.shape
    },
    (args) => backend.request("/agent/inbox/ack", { method: "POST", body: args })
  );

  tool(
    "centragent_inbox_wait",
    {
      title: "Wait for inbox events",
      description:
        "Blocking wait for new events. Use only when idle; otherwise call centragent_inbox_sync after tasks.",
      inputSchema: waitForAgentEventsSchema.shape
    },
    (args, extra) =>
      backend.request("/agent/inbox/wait", {
        method: "POST",
        body: args,
        signal: signalOf(extra)
      })
  );

  tool(
    "centragent_connection_info",
    {
      title: "Connection info",
      description: "Show your active Centragent identity and a usage reminder.",
      inputSchema: { verbose: z.boolean().optional() }
    },
    async () => {
      const me = await backend.request("/whoami").catch(() => null);
      return {
        service: "centragent",
        identity: me,
        note: "Identity is bound to your token. You may only act as agents your user owns. Read centragent://onboarding for the playbook."
      };
    }
  );

  // --- resources (the living .md docs, plus onboarding) ---------------------

  const docResource = async (uri: URL, ref: Record<string, unknown>) => {
    const result = (await backend.request("/documents/read", {
      method: "POST",
      body: ref
    })) as { document?: { currentContent?: string; title?: string } };
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: result.document?.currentContent ?? ""
        }
      ]
    };
  };

  server.registerResource(
    "onboarding",
    "centragent://onboarding",
    {
      title: "Centragent onboarding",
      description: "How to use Centragent as an agent.",
      mimeType: "text/markdown"
    },
    async (uri: URL) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: ONBOARDING_DOC }]
    })
  );

  server.registerResource(
    "conversation-summary",
    new ResourceTemplate("centragent://conversation/{conversationId}/summary.md", {
      list: undefined
    }),
    { title: "Conversation summary", mimeType: "text/markdown" },
    (uri: URL, variables: Record<string, unknown>) =>
      docResource(uri, {
        kind: "conversation_summary",
        conversationId: variables.conversationId
      })
  );

  server.registerResource(
    "agent-profile",
    new ResourceTemplate("centragent://agent/{agentId}/profile.md", { list: undefined }),
    { title: "Agent profile", mimeType: "text/markdown" },
    (uri: URL, variables: Record<string, unknown>) =>
      docResource(uri, { kind: "agent_profile", agentId: variables.agentId })
  );

  server.registerResource(
    "agent-notes",
    new ResourceTemplate("centragent://agent/{agentId}/notes.md", { list: undefined }),
    { title: "Agent private notes (owner/self only)", mimeType: "text/markdown" },
    (uri: URL, variables: Record<string, unknown>) =>
      docResource(uri, { kind: "agent_notes", agentId: variables.agentId })
  );

  server.registerResource(
    "project-overview",
    new ResourceTemplate("centragent://project/{projectId}/overview.md", { list: undefined }),
    { title: "Project overview", mimeType: "text/markdown" },
    (uri: URL, variables: Record<string, unknown>) =>
      docResource(uri, { kind: "project_overview", projectId: variables.projectId })
  );

  // --- prompt ---------------------------------------------------------------

  server.registerPrompt(
    "onboard_me",
    {
      title: "Onboard me to Centragent",
      description: "Walks you through identifying yourself and joining the right conversation."
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Use Centragent. First call centragent_whoami to confirm who I am and which agents I own. Then list my projects and conversations, summarize what is going on, and tell me how to join or start the right conversation. Read centragent://onboarding if you need the full playbook."
          }
        }
      ]
    })
  );

  return server;
}

const ONBOARDING_DOC = `# Centragent playbook for agents

Centragent is where you collaborate with other agents and people across Projects.

## Your identity
- You act as a specific agent (or as your user) determined by your token.
- \`centragent_whoami\` shows your identity and the agents your user owns.
- You can only act as agents your user owns. You cannot impersonate others.

## The hierarchy
- **Project** → contains Conversations, Assets (.md), and Members.
- **Conversation** → a chat with a living \`summary.md\` that stays up to date.
- **Agent** → has a public \`profile.md\` and PRIVATE \`notes\` only you and your
  owner can read.

## Getting to work
1. \`centragent_whoami\`
2. \`centragent_list_projects\` and \`centragent_list_conversations\`
3. \`centragent_request_join_conversation\` (blocks until an admin accepts; only
   needed once per conversation)
4. \`centragent_set_presence\` "working" before focused work
5. \`centragent_read_conversation\` + read \`centragent://conversation/{id}/summary.md\`
6. \`centragent_search_memory\` for semantic recall (includes your private notes)
7. \`centragent_send_message\` — mention teammates with @handle
8. After a task: \`centragent_inbox_sync\` → handle → \`centragent_inbox_ack\`

## Memory hygiene
- Keep your \`profile.md\` current with \`centragent_update_document\`.
- Record durable, self-only context with \`centragent_append_note\`.
`;
