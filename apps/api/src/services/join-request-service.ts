import type { FastifyBaseLogger } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { joinRequestRedisChannel, type RequestJoinConversationInput } from "@centragent/shared";
import { badRequest, notFound } from "../errors.js";
import type { AgentService } from "./agent-service.js";
import type { RealtimeService } from "./realtime-service.js";

type JoinDecisionStatus = "accepted" | "rejected" | "timed_out" | "cancelled";

type JoinDecision = {
  status: JoinDecisionStatus;
  conversationId: string;
  agentId: string;
  conversationAgentId: string | null;
  message: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JoinRequestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly agents: AgentService,
    private readonly realtime: RealtimeService,
    private readonly log: FastifyBaseLogger
  ) {}

  async list(status?: string) {
    const joinRequests = await this.prisma.joinRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(status === "pending" ? { expiresAt: { gt: new Date() } } : {})
      },
      include: {
        agent: true,
        conversation: true
      },
      orderBy: { createdAt: "desc" }
    });

    return { joinRequests };
  }

  async createAndWait(
    input: RequestJoinConversationInput,
    signal?: AbortSignal
  ): Promise<JoinDecision> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId }
    });

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const agent = await this.agents.findOrCreateAgent({
      name: input.agentName,
      provider: input.provider,
      ...(input.clientInstanceId
        ? { clientInstanceId: input.clientInstanceId }
        : {})
    });

    const expiresAt = new Date(Date.now() + input.timeoutSeconds * 1000);
    const joinRequest = await this.prisma.joinRequest.create({
      data: {
        conversationId: input.conversationId,
        agentId: agent.id,
        requestedRole: input.requestedRole,
        status: "pending",
        reason: input.reason ?? null,
        expiresAt,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      },
      include: {
        agent: true,
        conversation: true
      }
    });

    await this.realtime.emit(
      "agent.join_request.created",
      joinRequest,
      input.conversationId
    );

    return this.waitForDecision(joinRequest.id, signal);
  }

  async accept(joinRequestId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.joinRequest.findUnique({
        where: { id: joinRequestId },
        include: { agent: true, conversation: true }
      });

      if (!request) {
        throw notFound("Join request not found");
      }

      if (request.status !== "pending") {
        throw badRequest(`Join request is already ${request.status}`);
      }

      const updatedRequest = await tx.joinRequest.update({
        where: { id: joinRequestId },
        data: {
          status: "accepted",
          respondedAt: new Date()
        },
        include: { agent: true, conversation: true }
      });

      const membership = await tx.conversationAgent.upsert({
        where: {
          conversationId_agentId: {
            conversationId: request.conversationId,
            agentId: request.agentId
          }
        },
        update: {
          role: request.requestedRole,
          status: "active",
          joinedAt: new Date(),
          leftAt: null
        },
        create: {
          conversationId: request.conversationId,
          agentId: request.agentId,
          role: request.requestedRole,
          status: "active",
          joinedAt: new Date(),
          metadata: {}
        }
      });

      return { request: updatedRequest, membership };
    });

    await this.realtime.emit(
      "agent.join_request.accepted",
      result.request,
      result.request.conversationId
    );
    await this.realtime.emit(
      "agent.joined",
      result.membership,
      result.request.conversationId
    );
    await this.realtime.publishJoinDecision(joinRequestId, {
      status: "accepted"
    });

    return result;
  }

  async reject(joinRequestId: string, reason?: string) {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      include: { agent: true, conversation: true }
    });

    if (!request) {
      throw notFound("Join request not found");
    }

    if (request.status !== "pending") {
      throw badRequest(`Join request is already ${request.status}`);
    }

    const updated = await this.prisma.joinRequest.update({
      where: { id: joinRequestId },
      data: {
        status: "rejected",
        reason: reason ?? request.reason,
        respondedAt: new Date()
      },
      include: { agent: true, conversation: true }
    });

    await this.realtime.emit(
      "agent.join_request.rejected",
      updated,
      updated.conversationId
    );
    await this.realtime.publishJoinDecision(joinRequestId, {
      status: "rejected"
    });

    return updated;
  }

  private async waitForDecision(
    joinRequestId: string,
    signal?: AbortSignal
  ): Promise<JoinDecision> {
    const subscriber = this.realtime.makeRedisSubscriber();
    let wake: (() => void) | undefined;
    let redisSubscribed = false;

    try {
      subscriber.on("error", (error) =>
        this.log.warn({ error, joinRequestId }, "join request redis wait error")
      );
      await subscriber.connect();
      await subscriber.subscribe(joinRequestRedisChannel(joinRequestId));
      subscriber.on("message", () => {
        wake?.();
      });
      redisSubscribed = true;
    } catch (error) {
      this.log.warn(
        { error, joinRequestId },
        "Redis join wake unavailable; using polling only"
      );
    }

    try {
      while (true) {
        if (signal?.aborted) {
          return this.cancel(joinRequestId);
        }

        const request = await this.prisma.joinRequest.findUnique({
          where: { id: joinRequestId }
        });

        if (!request) {
          throw notFound("Join request not found");
        }

        if (request.status !== "pending") {
          return this.formatDecision(request.id);
        }

        const remainingMs = request.expiresAt.getTime() - Date.now();
        if (remainingMs <= 0) {
          return this.markTimedOut(joinRequestId);
        }

        await Promise.race([
          sleep(Math.min(remainingMs, 2000)),
          new Promise<void>((resolve) => {
            wake = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          })
        ]);
      }
    } finally {
      wake = undefined;
      if (redisSubscribed) {
        await subscriber.unsubscribe(joinRequestRedisChannel(joinRequestId)).catch(
          () => undefined
        );
      }
      await subscriber.quit().catch(() => undefined);
    }
  }

  private async formatDecision(joinRequestId: string): Promise<JoinDecision> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      include: { agent: true, conversation: true }
    });

    if (!request) {
      throw notFound("Join request not found");
    }

    const membership =
      request.status === "accepted"
        ? await this.prisma.conversationAgent.findFirst({
            where: {
              conversationId: request.conversationId,
              agentId: request.agentId,
              status: "active"
            }
          })
        : null;

    const status = request.status as JoinDecisionStatus;

    return {
      status,
      conversationId: request.conversationId,
      agentId: request.agentId,
      conversationAgentId: membership?.id ?? null,
      message: this.messageForStatus(status, request.reason ?? undefined)
    };
  }

  private async markTimedOut(joinRequestId: string): Promise<JoinDecision> {
    const existing = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId }
    });

    if (!existing) {
      throw notFound("Join request not found");
    }

    if (existing.status === "pending") {
      const updated = await this.prisma.joinRequest.update({
        where: { id: joinRequestId },
        data: {
          status: "timed_out",
          respondedAt: new Date()
        },
        include: { agent: true, conversation: true }
      });

      await this.realtime.emit(
        "agent.join_request.rejected",
        updated,
        updated.conversationId
      );
      await this.realtime.publishJoinDecision(joinRequestId, {
        status: "timed_out"
      });
    }

    return this.formatDecision(joinRequestId);
  }

  private async cancel(joinRequestId: string): Promise<JoinDecision> {
    const existing = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId }
    });

    if (!existing) {
      throw notFound("Join request not found");
    }

    if (existing.status === "pending") {
      const updated = await this.prisma.joinRequest.update({
        where: { id: joinRequestId },
        data: {
          status: "cancelled",
          respondedAt: new Date()
        },
        include: { agent: true, conversation: true }
      });

      await this.realtime.emit(
        "agent.join_request.rejected",
        updated,
        updated.conversationId
      );
      await this.realtime.publishJoinDecision(joinRequestId, {
        status: "cancelled"
      });
    }

    return this.formatDecision(joinRequestId);
  }

  private messageForStatus(status: JoinDecisionStatus, reason?: string) {
    if (status === "accepted") {
      return "Join request accepted. The agent may now participate in the conversation.";
    }

    if (status === "rejected") {
      return reason
        ? `Join request rejected: ${reason}`
        : "Join request rejected.";
    }

    if (status === "timed_out") {
      return "Join request timed out before the master user responded.";
    }

    return "Join request was cancelled by the MCP client.";
  }
}
