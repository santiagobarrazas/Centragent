import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { SYSTEM_FLAG_AUTONOMY, usageCents } from "@centragent/shared";
import type { AppConfig } from "../config.js";
import type { RealtimeService } from "./realtime-service.js";

// The server-derived agent-to-agent hop chain carried on a message's metadata.
// The runner NEVER computes this — it is derived from the active AgentRun.
export type AgentChain = {
  depth: number;
  agentIds: string[];
  rootMessageId: string | null;
  // Marks a sub-chain that originated from a "request declined" notice, so the
  // caller's acknowledgment gets exactly +1 hop and cannot trigger a storm.
  declineNotice?: boolean;
};

export const freshChain = (
  rootMessageId: string | null,
  agentId?: string | null
): AgentChain => ({
  depth: 0,
  agentIds: agentId ? [agentId] : [],
  rootMessageId
});

export type GuardInput = {
  conversationId: string;
  senderType: string;
  senderAgentId: string | null;
  targetAgentId: string;
  chain: AgentChain;
};

export type GuardResult = {
  allow: boolean;
  reason?: string;
  pause?: boolean;
  // When true, the caller should be told (a system "declined" notice is posted).
  notify?: boolean;
};

/**
 * The single authoritative choke point for agent-to-agent autonomy. Evaluated at
 * mint time (AgentEventService.createMentionsForMessage) before any agent→agent
 * inbox event is created. Human/system mentions are never blocked here.
 */
export class AutonomyGuard {
  private flagCache: { value: boolean; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger
  ) {}

  async isKilled(): Promise<boolean> {
    if (!this.config.CENTRAGENT_AUTONOMY_ENABLED) {
      return true;
    }
    return !(await this.autonomyFlag());
  }

  private async autonomyFlag(): Promise<boolean> {
    const now = Date.now();
    if (this.flagCache && now - this.flagCache.at < 2000) {
      return this.flagCache.value;
    }
    const row = await this.prisma.systemFlag
      .findUnique({ where: { key: SYSTEM_FLAG_AUTONOMY } })
      .catch(() => null);
    const value = row?.valueBool ?? true;
    this.flagCache = { value, at: now };
    return value;
  }

  async setGloballyEnabled(enabled: boolean) {
    await this.prisma.systemFlag.upsert({
      where: { key: SYSTEM_FLAG_AUTONOMY },
      update: { valueBool: enabled },
      create: { key: SYSTEM_FLAG_AUTONOMY, valueBool: enabled }
    });
    this.flagCache = { value: enabled, at: Date.now() };
    await this.realtime.emit(enabled ? "autonomy.resumed" : "autonomy.paused", {
      scope: "global"
    });
    return { enabled };
  }

  /** The ordered HARD checks. Only agent→agent mentions are gated. */
  async evaluate(input: GuardInput): Promise<GuardResult> {
    // A human/system/tool directing an agent always goes through.
    if (input.senderType !== "agent") {
      return { allow: true };
    }

    if (await this.isKilled()) {
      return { allow: false, reason: "autonomy is disabled globally" };
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { autonomyState: true, autonomyConfig: true }
    });
    if (!conversation) {
      return { allow: false, reason: "conversation not found" };
    }
    if (conversation.autonomyState === "disabled" || conversation.autonomyState === "paused") {
      return { allow: false, reason: `conversation autonomy is ${conversation.autonomyState}` };
    }
    if (conversation.autonomyState === "requires_approval") {
      return { allow: false, reason: "conversation requires approval", pause: true };
    }

    const target = await this.prisma.agent.findUnique({
      where: { id: input.targetAgentId },
      select: { autonomyEnabled: true, name: true }
    });
    if (!target?.autonomyEnabled) {
      // The caller is told (and acknowledges) — this is not a silent drop.
      return { allow: false, reason: "is not available to receive requests right now", notify: true };
    }

    const cfg = (conversation.autonomyConfig ?? {}) as {
      maxHops?: number;
      maxConsecutiveAgentMessages?: number;
      messageBudget?: number;
    };

    // Defaults scale with team size (more agents → longer legitimate chains),
    // clamped so cost stays bounded. Explicit per-conversation overrides win.
    const agentCount = await this.prisma.membership.count({
      where: { conversationId: input.conversationId, principalType: "agent", status: "active" }
    });
    const scaledHops = Math.min(Math.max(this.config.AUTONOMY_MAX_HOPS, agentCount * 2), 24);
    const scaledConsec = Math.min(
      Math.max(this.config.AUTONOMY_MAX_CONSECUTIVE_AGENT_MESSAGES, agentCount * 2),
      40
    );

    // Hop depth (server-derived) — the primary loop bound.
    const maxHops = cfg.maxHops ?? scaledHops;
    if (input.chain.depth >= maxHops) {
      return {
        allow: false,
        reason: `couldn't be reached — the agent-to-agent hop limit was reached (${maxHops})`,
        pause: true,
        notify: true
      };
    }

    // Consecutive agent messages since the last human/system message — the
    // dead-simple catch-all that bounds runaway even if chain logic fails.
    const maxConsec = cfg.maxConsecutiveAgentMessages ?? scaledConsec;
    const consecutive = await this.consecutiveAgentMessages(input.conversationId);
    if (consecutive >= maxConsec) {
      return {
        allow: false,
        reason: `too many agent messages without a human (${maxConsec})`,
        pause: true
      };
    }

    // Per-edge cooldown.
    if (input.senderAgentId && this.config.AUTONOMY_COOLDOWN_MS > 0) {
      const recent = await this.prisma.agentEvent.findFirst({
        where: {
          conversationId: input.conversationId,
          type: "mention",
          actorId: input.senderAgentId,
          targetAgentId: input.targetAgentId,
          createdAt: { gt: new Date(Date.now() - this.config.AUTONOMY_COOLDOWN_MS) }
        },
        select: { id: true }
      });
      if (recent) {
        return { allow: false, reason: "mention cooldown" };
      }
    }

    // Rolling per-conversation message budget.
    const budget = cfg.messageBudget ?? this.config.AUTONOMY_CONV_MESSAGE_BUDGET;
    if (budget > 0) {
      const since = new Date(Date.now() - this.config.AUTONOMY_BUDGET_WINDOW_MS);
      const recentAgentMsgs = await this.prisma.message.count({
        where: {
          conversationId: input.conversationId,
          senderType: "agent",
          createdAt: { gt: since }
        }
      });
      if (recentAgentMsgs >= budget) {
        return {
          allow: false,
          reason: `conversation autonomy budget reached (${budget} agent msgs/window)`,
          pause: true
        };
      }
    }

    return { allow: true };
  }

  private async consecutiveAgentMessages(conversationId: string): Promise<number> {
    const lastHuman = await this.prisma.message.findFirst({
      where: { conversationId, senderType: { in: ["user", "system"] } },
      orderBy: { sequenceNumber: "desc" },
      select: { sequenceNumber: true }
    });
    return this.prisma.message.count({
      where: {
        conversationId,
        senderType: "agent",
        ...(lastHuman ? { sequenceNumber: { gt: lastHuman.sequenceNumber } } : {})
      }
    });
  }

  /** Pause a conversation's autonomy (hard breach) and notify the humans. */
  async pauseConversation(conversationId: string, reason: string) {
    await this.prisma.conversation
      .update({ where: { id: conversationId }, data: { autonomyState: "paused" } })
      .catch((error) =>
        this.log.warn({ error, conversationId }, "failed to pause conversation autonomy")
      );
    await this.realtime.emit(
      "autonomy.paused",
      { scope: "conversation", conversationId, reason },
      conversationId
    );
  }

  async recordUsage(input: {
    conversationId: string;
    agentId: string;
    runId?: string | null;
    deliveryId?: string | null;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }) {
    const usdCents = usageCents(input.model, input.promptTokens, input.completionTokens);
    await this.prisma.autonomyUsage.create({
      data: {
        conversationId: input.conversationId,
        agentId: input.agentId,
        runId: input.runId ?? null,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        usdCents
      }
    });
    return { usdCents };
  }
}
