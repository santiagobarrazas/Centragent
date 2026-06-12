import { config } from "./config.js";
import type { BackendClient } from "./backend-client.js";
import type { AgentToolAdapter, TurnUsage } from "./adapters/types.js";

export type WorkerContext = {
  agentId: string;
  handle: string;
  provider: string;
  token: string;
  backend: BackendClient;
  adapter: AgentToolAdapter;
  mcpUrl: string;
  workspaceDir: string;
  log: (message: string) => void;
};

export type InboxDelivery = {
  deliveryId: string;
  event: {
    id: string;
    type: string;
    conversationId?: string | null;
    content?: string | null;
    data?: Record<string, unknown> | null;
    conversation?: { id: string; title?: string } | null;
  };
};

// The runner owns the loop; the spawned agent only reads context + posts replies.
const ALLOWED_TOOLS = [
  "mcp__centragent__centragent_send_message",
  "mcp__centragent__centragent_read_conversation",
  "mcp__centragent__centragent_search_memory",
  "mcp__centragent__centragent_read_document",
  "mcp__centragent__centragent_append_note",
  "mcp__centragent__centragent_set_presence",
  "mcp__centragent__centragent_whoami",
  "mcp__centragent__centragent_list_conversations"
];

const ack = (ctx: WorkerContext, deliveryIds: string[]) =>
  deliveryIds.length === 0
    ? Promise.resolve()
    : ctx.backend
        .request("/agent/inbox/ack", { method: "POST", body: { deliveryIds } })
        .catch(() => undefined);

const SILENCE_SENTINEL = "NO_REPLY";

type ConvMessage = {
  sequenceNumber: number;
  senderType: string;
  content: string;
  sender?: { type: string; id: string; handle?: string; name?: string } | null;
};

/** Recent messages, oldest-first, token-bound. Empty on any failure. */
async function fetchRecentMessages(
  ctx: WorkerContext,
  conversationId: string,
  limit: number
): Promise<ConvMessage[]> {
  try {
    const res = await ctx.backend.request<{ messages: ConvMessage[] }>(
      `/conversations/${conversationId}/messages`,
      { query: { limit, direction: "before" } }
    );
    return res.messages ?? [];
  } catch {
    return [];
  }
}

/** Highest sequence number of a message THIS agent authored (−1 if none). */
function maxOwnSeq(messages: ConvMessage[], agentId: string): number {
  let max = -1;
  for (const m of messages) {
    if (m.sender?.type === "agent" && m.sender.id === agentId && m.sequenceNumber > max) {
      max = m.sequenceNumber;
    }
  }
  return max;
}

function formatTranscript(messages: ConvMessage[]): string {
  return messages
    .map((m) => {
      const who =
        m.sender?.type === "agent"
          ? `@${m.sender.handle ?? "agent"}`
          : m.sender?.type === "user"
            ? (m.sender.name ?? "user")
            : m.senderType;
      return `${who}: ${String(m.content).slice(0, 600)}`;
    })
    .join("\n");
}

function buildPrompt(
  ctx: WorkerContext,
  event: InboxDelivery["event"],
  conversationId: string,
  recent: ConvMessage[]
) {
  const intro = `You are the agent @${ctx.handle} in Centragent, a multi-agent workspace.`;
  const notified = `You were notified (event: ${event.type}) in conversation ${conversationId}.`;
  const trigger = event.content
    ? `The triggering message was:\n"""\n${String(event.content).slice(0, 2000)}\n"""`
    : "";

  // Stdout-reply tools (codex, the loose CLIs) get context pre-injected and just
  // write their answer — the runner posts it. No dependency on a named tool call.
  if (ctx.adapter.repliesInStdout) {
    const transcript = formatTranscript(recent);
    return [
      intro,
      notified,
      transcript
        ? `Recent conversation (oldest first; the last line is what triggered you):\n"""\n${transcript}\n"""`
        : trigger,
      "",
      "Write ONE concise, useful reply as your FINAL message — it is posted to the conversation for you automatically.",
      `If this mention does not need a response from you, reply with exactly: ${SILENCE_SENTINEL}`,
      "You also have Centragent MCP tools (search_memory, read_document, append_note, set_presence) for optional side-effects — use them only if genuinely useful. You do NOT need to call send_message.",
      "Only @mention another agent if you truly need them."
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Tools that reliably drive the MCP tools themselves (claude-code).
  return [
    `${intro} You have Centragent MCP tools available.`,
    notified,
    trigger,
    "",
    "React autonomously:",
    `1. centragent_read_conversation { conversationId: "${conversationId}" } to read recent context.`,
    "2. If helpful, centragent_search_memory or centragent_read_document for background.",
    `3. Post ONE concise, useful reply with centragent_send_message { conversationId: "${conversationId}", content: ... }. Only @mention another agent if you genuinely need them.`,
    "Do NOT call any inbox, wait, or join tools — you are already running. Once you have replied, stop."
  ]
    .filter(Boolean)
    .join("\n");
}

// Lean prompt for a RESUMED session: the agent already has its role and earlier
// context in-session, so re-onboarding it would waste tokens (and is slightly
// wrong — it's already joined). Just hand it the new trigger.
function buildResumePrompt(
  ctx: WorkerContext,
  event: InboxDelivery["event"],
  conversationId: string
) {
  return [
    `New activity in this Centragent conversation (event: ${event.type}). You are @${ctx.handle}, continuing your earlier session here.`,
    event.content ? `Triggering message:\n"""\n${String(event.content).slice(0, 2000)}\n"""` : "",
    "",
    `Catch up only if needed (centragent_read_conversation { conversationId: "${conversationId}" } for anything since your last turn), then post ONE concise reply with centragent_send_message — or do nothing if no response is warranted.`,
    "Only @mention another agent if you genuinely need them."
  ]
    .filter(Boolean)
    .join("\n");
}

/** Execute one agent reaction. Acks ALL `deliveryIds` for the conversation. */
export async function executeRun(
  ctx: WorkerContext,
  primary: InboxDelivery,
  deliveryIds: string[]
): Promise<void> {
  const event = primary.event;
  const conversationId = event.conversationId ?? event.conversation?.id;
  if (!conversationId) {
    await ack(ctx, deliveryIds);
    return;
  }

  // Pre-spend soft hop skip (cheap, local; server is authoritative).
  const chainDepth = Number((event.data as { chainDepth?: number } | null)?.chainDepth ?? 0);
  if (chainDepth >= config.RUNNER_SOFT_HOP_SKIP) {
    ctx.log(`skip reaction (hop depth ${chainDepth})`);
    await ack(ctx, deliveryIds);
    return;
  }

  let run: { runId: string; sessionId: string | null; skip: boolean };
  try {
    run = await ctx.backend.request("/agent/runs", {
      method: "POST",
      body: {
        triggerDeliveryId: primary.deliveryId,
        conversationId,
        trigger: event.type,
        provider: ctx.provider
      }
    });
  } catch (error) {
    ctx.log(`run create failed: ${(error as Error).message}`);
    await ack(ctx, deliveryIds);
    return;
  }
  if (run.skip) {
    await ack(ctx, deliveryIds);
    return;
  }

  await ctx.backend
    .request("/agent/activities/start", {
      method: "POST",
      body: { conversationId, title: `Reacting to ${event.type}` }
    })
    .catch(() => undefined);

  const controller = new AbortController();
  const wall = setTimeout(() => controller.abort(), config.RUNNER_MAX_WALL_MS);
  let cumulativeCost = 0;

  const onUsage = (usage: TurnUsage) => {
    if (usage.model && (usage.promptTokens || usage.completionTokens)) {
      void ctx.backend
        .request("/agent/usage", {
          method: "POST",
          body: {
            conversationId,
            runId: run.runId,
            deliveryId: primary.deliveryId,
            model: usage.model,
            promptTokens: usage.promptTokens ?? 0,
            completionTokens: usage.completionTokens ?? 0
          }
        })
        .catch(() => undefined);
    }
    if (usage.costUsd) {
      cumulativeCost = usage.costUsd;
      if (cumulativeCost > config.RUNNER_MAX_COST_USD) controller.abort();
    }
  };

  let status = "completed";
  let error: string | undefined;
  let costUsd: number | undefined;
  let turns: number | undefined;
  let sessionId: string | undefined;
  let replyText: string | undefined;

  // One read: grounds the stdout-tool prompt AND sets the double-post baseline
  // (the agent's latest message BEFORE this run).
  const recent = await fetchRecentMessages(ctx, conversationId, 20);
  const lastOwnSeq = maxOwnSeq(recent, ctx.agentId);

  const mcp = ctx.adapter.buildMcpConfig(ctx.token, ctx.mcpUrl);
  try {
    const result = await ctx.adapter.spawn(
      {
        prompt: buildPrompt(ctx, event, conversationId, recent),
        resumePrompt: buildResumePrompt(ctx, event, conversationId),
        mcpConfigPath: mcp.path,
        allowedTools: ALLOWED_TOOLS,
        maxTurns: config.RUNNER_MAX_TURNS,
        resumeSessionId: run.sessionId,
        cwd: ctx.workspaceDir,
        signal: controller.signal
      },
      onUsage
    );
    sessionId = result.sessionId ?? undefined;
    costUsd = result.costUsd ?? (cumulativeCost > 0 ? cumulativeCost : undefined);
    turns = result.turns;
    replyText = result.text;
    if (result.isError) {
      status = "failed";
      error = (result.text ?? "tool error").slice(0, 500);
    }
  } catch (caught) {
    status = controller.signal.aborted ? "cancelled" : "failed";
    error = String((caught as Error)?.message ?? caught).slice(0, 500);
  } finally {
    clearTimeout(wall);
    mcp.cleanup();
  }

  // Runner OWNS the conversational reply (hybrid). If the agent did not post a
  // message during the run, post its final text on its behalf. This routes through
  // the SAME MessageService.post as the MCP send_message tool (same autonomy guard,
  // same hop chain). It MUST run while the AgentRun is still 'running' (before the
  // PATCH below) so findActiveRun extends the chain and any @mention in the reply
  // triggers downstream agents under the guard.
  if (status === "completed" && replyText) {
    const trimmed = replyText.trim();
    const silent = trimmed.length === 0 || trimmed.toUpperCase() === SILENCE_SENTINEL;
    if (!silent) {
      const after = await fetchRecentMessages(ctx, conversationId, 20);
      if (maxOwnSeq(after, ctx.agentId) <= lastOwnSeq) {
        await ctx.backend
          .request("/agent/messages", { method: "POST", body: { conversationId, content: trimmed } })
          .catch(() => undefined);
      }
    }
  }

  await ctx.backend
    .request(`/agent/runs/${run.runId}`, {
      method: "PATCH",
      body: {
        status,
        ...(costUsd != null ? { costUsd } : {}),
        ...(turns != null ? { turns } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(error ? { error } : {})
      }
    })
    .catch(() => undefined);
  await ctx.backend
    .request("/agent/activities/finish", {
      method: "POST",
      body: { conversationId, status: status === "completed" ? "completed" : "failed" }
    })
    .catch(() => undefined);

  // Surface a failure to the humans (the runner can post even when the tool
  // itself couldn't run). No @mention → no propagation.
  if (status !== "completed") {
    const firstLine = ((error ?? "").split("\n")[0] ?? "").slice(0, 160);
    const note =
      status === "cancelled"
        ? "I stopped early — a runtime cap was reached."
        : `I couldn't respond just now — my tool failed to run${firstLine ? ` (${firstLine})` : ""}.`;
    await ctx.backend
      .request("/agent/messages", { method: "POST", body: { conversationId, content: `⚠️ ${note}` } })
      .catch(() => undefined);
  }

  // ACK LAST: a crash before this re-delivers, and the unique run row makes the
  // re-run a safe no-op (skip).
  await ack(ctx, deliveryIds);
  ctx.log(
    `reaction ${status}${costUsd ? ` ($${costUsd.toFixed(3)})` : ""} in conversation ${conversationId.slice(0, 8)}`
  );
}
