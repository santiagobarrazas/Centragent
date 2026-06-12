import { Prisma, type PrismaClient } from "@prisma/client";
import type { CreateAgentRunInput, PatchAgentRunInput } from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { forbidden, notFound } from "../errors.js";
import { freshChain, type AgentChain } from "./autonomy-guard.js";
import type { MembershipService } from "./membership-service.js";
import type { RealtimeService } from "./realtime-service.js";

const requireActingAgent = (principal: Principal): string => {
  if (!principal.agentId) {
    throw forbidden("Agent runs require an agent token");
  }
  return principal.agentId;
};

export class AgentRunService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly realtime: RealtimeService
  ) {}

  /**
   * Idempotent by triggerDeliveryId: a runner restart / redelivery returns the
   * existing run with `skip` set if it already ran, so an agent never
   * double-responds. The hop chain is DERIVED from the triggering message here
   * (server-authoritative — the runner never computes it).
   */
  async create(principal: Principal, input: CreateAgentRunInput) {
    const agentId = requireActingAgent(principal);

    const existing = await this.prisma.agentRun.findUnique({
      where: { triggerDeliveryId: input.triggerDeliveryId }
    });
    if (existing) {
      return {
        runId: existing.id,
        sessionId: existing.sessionId,
        // Skip if this delivery was already fully handled (not still running).
        skip: existing.status !== "running"
      };
    }

    const delivery = await this.prisma.agentEventDelivery.findUnique({
      where: { id: input.triggerDeliveryId },
      include: {
        event: { include: { message: { select: { id: true, metadata: true } } } }
      }
    });
    if (!delivery || delivery.agentId !== agentId) {
      throw forbidden("That inbox delivery does not belong to this agent");
    }

    const triggerMessage = delivery.event.message;
    const parentChain =
      ((triggerMessage?.metadata as { agentChain?: AgentChain } | null)?.agentChain) ??
      freshChain(triggerMessage?.id ?? null);

    // Continuity: resume the agent's most recent COMPLETED tool session in this
    // conversation so it keeps thread context (and the tool compacts its own).
    // Only completed runs hold a session the tool actually persisted — resuming a
    // failed/cancelled run's id makes the tool abort ("No conversation found").
    const lastSession = await this.prisma.agentRun.findFirst({
      where: {
        agentId,
        conversationId: input.conversationId,
        sessionId: { not: null },
        status: "completed"
      },
      orderBy: { startedAt: "desc" },
      select: { sessionId: true }
    });

    const run = await this.prisma.agentRun.create({
      data: {
        agentId,
        conversationId: input.conversationId,
        triggerDeliveryId: input.triggerDeliveryId,
        triggerMessageId: triggerMessage?.id ?? null,
        status: "running",
        trigger: input.trigger,
        provider: input.provider,
        chainDepth: parentChain.depth,
        chainAgentIds: parentChain.agentIds,
        rootMessageId: parentChain.rootMessageId,
        declineNotice: parentChain.declineNotice ?? false
      }
    });

    await this.realtime.emit(
      "agent.run.started",
      { id: run.id, agentId, conversationId: input.conversationId, trigger: run.trigger },
      input.conversationId
    );
    return { runId: run.id, sessionId: lastSession?.sessionId ?? null, skip: false };
  }

  async patch(principal: Principal, runId: string, input: PatchAgentRunInput) {
    const agentId = requireActingAgent(principal);
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw notFound("Run not found");
    }
    if (run.agentId !== agentId) {
      throw forbidden("That run does not belong to this agent");
    }

    const updated = await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        ...(input.costUsd !== undefined ? { costUsd: new Prisma.Decimal(input.costUsd) } : {}),
        ...(input.turns !== undefined ? { turns: input.turns } : {}),
        // Only a completed run holds a resumable session; never persist the id of
        // a failed/cancelled run or it poisons the next resume.
        ...(input.sessionId && input.status === "completed" ? { sessionId: input.sessionId } : {}),
        ...(input.error ? { error: input.error } : {}),
        finishedAt: input.status === "running" ? null : new Date()
      }
    });

    await this.realtime.emit(
      "agent.run.finished",
      { id: run.id, agentId, conversationId: run.conversationId, status: updated.status },
      run.conversationId
    );
    return { run: updated };
  }

  async list(principal: Principal, conversationId: string) {
    await this.memberships.resolveReadMembership(principal, conversationId);
    const runs = await this.prisma.agentRun.findMany({
      where: { conversationId },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { agent: { select: { handle: true, name: true } } }
    });
    return { runs };
  }

  /** The agent's in-flight run for a conversation (drives chain extension). */
  async findActiveRun(agentId: string, conversationId: string) {
    return this.prisma.agentRun.findFirst({
      where: { agentId, conversationId, status: "running" },
      orderBy: { startedAt: "desc" }
    });
  }
}
