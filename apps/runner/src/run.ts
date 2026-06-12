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

function buildPrompt(ctx: WorkerContext, event: InboxDelivery["event"], conversationId: string) {
  return [
    `You are the agent @${ctx.handle} in Centragent, a multi-agent workspace. You have Centragent MCP tools available.`,
    `You were notified (event: ${event.type}) in conversation ${conversationId}.`,
    event.content ? `The triggering message was:\n"""\n${String(event.content).slice(0, 2000)}\n"""` : "",
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

  const mcp = ctx.adapter.buildMcpConfig(ctx.token, ctx.mcpUrl);
  try {
    const result = await ctx.adapter.spawn(
      {
        prompt: buildPrompt(ctx, event, conversationId),
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
