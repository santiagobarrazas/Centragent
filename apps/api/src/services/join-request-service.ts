import type { FastifyBaseLogger } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  joinRequestRedisChannel,
  type RequestJoinConversationInput
} from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import type { MembershipService } from "./membership-service.js";
import type { RealtimeService } from "./realtime-service.js";

type JoinDecisionStatus = "accepted" | "rejected" | "timed_out" | "cancelled";

type JoinDecision = {
  status: JoinDecisionStatus;
  conversationId: string;
  agentId: string;
  membershipId: string | null;
  message: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JoinRequestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly realtime: RealtimeService,
    private readonly log: FastifyBaseLogger
  ) {}

  async list(principal: Principal, status = "pending") {
    // Only requests the principal can act on: pending requests in conversations
    // whose project the principal administers.
    const where: Prisma.JoinRequestWhereInput = {
      status,
      ...(status === "pending" ? { expiresAt: { gt: new Date() } } : {}),
      conversation: {
        project: {
          memberships: {
            some: {
              userId: principal.userId,
              conversationId: null,
              status: "active",
              role: { in: ["owner", "admin"] }
            }
          }
        }
      }
    };

    const joinRequests = await this.prisma.joinRequest.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true, handle: true, provider: true, ownerId: true } },
        conversation: { select: { id: true, title: true, projectId: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    return { joinRequests };
  }

  async createAndWait(
    principal: Principal,
    input: RequestJoinConversationInput,
    signal?: AbortSignal
  ): Promise<JoinDecision> {
    if (!principal.agentId) {
      throw forbidden("Joining a conversation requires an agent token");
    }
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, projectId: true }
    });
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    // Already a member? Short-circuit so re-runs are idempotent.
    const existing = await this.prisma.membership.findFirst({
      where: {
        agentId: principal.agentId,
        conversationId: input.conversationId,
        principalType: "agent",
        status: "active"
      }
    });
    if (existing) {
      return {
        status: "accepted",
        conversationId: input.conversationId,
        agentId: principal.agentId,
        membershipId: existing.id,
        message: "The agent is already a member of this conversation."
      };
    }

    const joinRequest = await this.prisma.joinRequest.create({
      data: {
        conversationId: input.conversationId,
        agentId: principal.agentId,
        requestedRole: input.requestedRole,
        status: "pending",
        reason: input.reason ?? null,
        expiresAt: new Date(Date.now() + input.timeoutSeconds * 1000),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      },
      include: {
        agent: { select: { id: true, name: true, handle: true, provider: true } },
        conversation: { select: { id: true, title: true, projectId: true } }
      }
    });

    // Global nudge (no conversation scope) so project admins see the pending
    // request without being subscribed to the conversation; the actual list is
    // membership-scoped via REST.
    await this.realtime.emit("agent.join_request.created", joinRequest);
    return this.waitForDecision(joinRequest.id, signal);
  }

  async accept(principal: Principal, joinRequestId: string) {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      include: { conversation: { select: { projectId: true } } }
    });
    if (!request) {
      throw notFound("Join request not found");
    }
    await this.memberships.requireProjectRole(
      principal,
      request.conversation.projectId,
      "admin"
    );
    if (request.status !== "pending") {
      throw badRequest(`Join request is already ${request.status}`);
    }

    const updated = await this.prisma.joinRequest.update({
      where: { id: joinRequestId },
      data: { status: "accepted", respondedAt: new Date() },
      include: {
        agent: { select: { id: true, name: true, handle: true, provider: true } },
        conversation: { select: { id: true, title: true, projectId: true } }
      }
    });

    const membership = await this.memberships.upsertAgentConversationMembership({
      agentId: request.agentId,
      projectId: request.conversation.projectId,
      conversationId: request.conversationId,
      participantRole: request.requestedRole
    });

    await this.realtime.emit("agent.join_request.accepted", updated, request.conversationId);
    await this.realtime.emit("agent.joined", { membership, conversationId: request.conversationId }, request.conversationId);
    await this.realtime.publishJoinDecision(joinRequestId, { status: "accepted" });
    return { request: updated, membership };
  }

  async reject(principal: Principal, joinRequestId: string, reason?: string) {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      include: { conversation: { select: { projectId: true } } }
    });
    if (!request) {
      throw notFound("Join request not found");
    }
    await this.memberships.requireProjectRole(
      principal,
      request.conversation.projectId,
      "admin"
    );
    if (request.status !== "pending") {
      throw badRequest(`Join request is already ${request.status}`);
    }

    const updated = await this.prisma.joinRequest.update({
      where: { id: joinRequestId },
      data: { status: "rejected", reason: reason ?? request.reason, respondedAt: new Date() },
      include: {
        agent: { select: { id: true, name: true, handle: true, provider: true } },
        conversation: { select: { id: true, title: true, projectId: true } }
      }
    });

    await this.realtime.emit("agent.join_request.rejected", updated, request.conversationId);
    await this.realtime.publishJoinDecision(joinRequestId, { status: "rejected" });
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
      subscriber.on("message", () => wake?.());
      redisSubscribed = true;
    } catch (error) {
      this.log.warn({ error, joinRequestId }, "Redis join wake unavailable; polling only");
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
          return this.formatDecision(joinRequestId);
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
        await subscriber
          .unsubscribe(joinRequestRedisChannel(joinRequestId))
          .catch(() => undefined);
      }
      await subscriber.quit().catch(() => undefined);
    }
  }

  private async formatDecision(joinRequestId: string): Promise<JoinDecision> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId }
    });
    if (!request) {
      throw notFound("Join request not found");
    }
    const membership =
      request.status === "accepted"
        ? await this.prisma.membership.findFirst({
            where: {
              conversationId: request.conversationId,
              agentId: request.agentId,
              principalType: "agent",
              status: "active"
            }
          })
        : null;

    const status = request.status as JoinDecisionStatus;
    return {
      status,
      conversationId: request.conversationId,
      agentId: request.agentId,
      membershipId: membership?.id ?? null,
      message: this.messageForStatus(status, request.reason ?? undefined)
    };
  }

  private async markTimedOut(joinRequestId: string): Promise<JoinDecision> {
    const existing = await this.prisma.joinRequest.findUnique({ where: { id: joinRequestId } });
    if (existing?.status === "pending") {
      const updated = await this.prisma.joinRequest.update({
        where: { id: joinRequestId },
        data: { status: "timed_out", respondedAt: new Date() }
      });
      await this.realtime.emit("agent.join_request.rejected", updated, updated.conversationId);
      await this.realtime.publishJoinDecision(joinRequestId, { status: "timed_out" });
    }
    return this.formatDecision(joinRequestId);
  }

  private async cancel(joinRequestId: string): Promise<JoinDecision> {
    const existing = await this.prisma.joinRequest.findUnique({ where: { id: joinRequestId } });
    if (existing?.status === "pending") {
      const updated = await this.prisma.joinRequest.update({
        where: { id: joinRequestId },
        data: { status: "cancelled", respondedAt: new Date() }
      });
      await this.realtime.emit("agent.join_request.rejected", updated, updated.conversationId);
      await this.realtime.publishJoinDecision(joinRequestId, { status: "cancelled" });
    }
    return this.formatDecision(joinRequestId);
  }

  private messageForStatus(status: JoinDecisionStatus, reason?: string) {
    if (status === "accepted") {
      return "Join request accepted. The agent may now participate in the conversation.";
    }
    if (status === "rejected") {
      return reason ? `Join request rejected: ${reason}` : "Join request rejected.";
    }
    if (status === "timed_out") {
      return "Join request timed out before a project admin responded.";
    }
    return "Join request was cancelled by the MCP client.";
  }
}
