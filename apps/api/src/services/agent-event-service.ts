import type { FastifyBaseLogger } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  agentEventsRedisChannel,
  type AgentPresenceInput,
  type FinishAgentActivityInput,
  type StartAgentActivityInput,
  type SyncAgentInboxInput,
  type WaitForAgentEventsInput
} from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { forbidden, notFound } from "../errors.js";
import type { AgentChain, AutonomyGuard } from "./autonomy-guard.js";
import type { MembershipService } from "./membership-service.js";
import type { RealtimeService } from "./realtime-service.js";

type MessageForMentions = {
  id: string;
  conversationId: string;
  senderType: string;
  senderAgentId: string | null;
  senderUserId: string | null;
  content: string;
  chain: AgentChain;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mentionHandles = (content: string) => {
  const handles = new Set<string>();
  for (const match of content.matchAll(/@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})/g)) {
    const handle = match[1];
    if (handle) handles.add(handle.toLowerCase());
  }
  return [...handles];
};

const requireActingAgent = (principal: Principal): string => {
  if (!principal.agentId) {
    throw forbidden("This action requires an agent token");
  }
  return principal.agentId;
};

export class AgentEventService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly realtime: RealtimeService,
    private readonly guard: AutonomyGuard,
    private readonly log: FastifyBaseLogger
  ) {}

  async createMentionsForMessage(message: MessageForMentions) {
    const handles = mentionHandles(message.content);
    if (handles.length === 0) {
      return { created: [], declines: [] };
    }

    const targets = await this.prisma.membership.findMany({
      where: {
        conversationId: message.conversationId,
        status: "active",
        principalType: "agent",
        agent: { handle: { in: handles } }
      },
      include: { agent: true }
    });

    const created = [];
    const declines: Array<{ name: string; handle: string; reason: string }> = [];
    for (const target of targets) {
      if (!target.agentId || !target.agent) continue;
      if (message.senderAgentId && target.agentId === message.senderAgentId) {
        continue;
      }

      // Autonomy choke point: gate agent→agent mentions. Human mentions pass.
      const verdict = await this.guard.evaluate({
        conversationId: message.conversationId,
        senderType: message.senderType,
        senderAgentId: message.senderAgentId,
        targetAgentId: target.agentId,
        chain: message.chain
      });
      if (!verdict.allow) {
        if (verdict.pause) {
          await this.guard.pauseConversation(
            message.conversationId,
            verdict.reason ?? "autonomy paused"
          );
        }
        // Notify the caller (and only once per sub-chain) that the request was declined.
        if (verdict.notify && !message.chain.declineNotice) {
          declines.push({
            name: target.agent.name,
            handle: target.agent.handle,
            reason: verdict.reason ?? "is not available to receive requests"
          });
        }
        this.log.info(
          { conversationId: message.conversationId, targetAgentId: target.agentId, reason: verdict.reason },
          "autonomy mention suppressed"
        );
        continue;
      }

      const event = await this.prisma.agentEvent.create({
        data: {
          type: "mention",
          conversationId: message.conversationId,
          messageId: message.id,
          actorType: message.senderType,
          actorId: message.senderAgentId ?? message.senderUserId,
          targetAgentId: target.agentId,
          targetMembershipId: target.id,
          title: `${target.agent.name} was mentioned`,
          content: message.content,
          data: { handle: target.agent.handle, source: "message", chainDepth: message.chain.depth },
          deliveries: {
            create: {
              agentId: target.agentId,
              membershipId: target.id,
              status: "pending"
            }
          }
        },
        include: { deliveries: true, targetAgent: true }
      });

      created.push(event);
      await this.realtime.emit(
        "agent.event.created",
        { id: event.id, type: event.type, targetAgentId: event.targetAgentId },
        message.conversationId
      );
      await this.realtime.publishAgentEvent(target.agentId, {
        eventId: event.id,
        type: event.type
      });
    }

    return { created, declines };
  }

  async setPresence(principal: Principal, input: AgentPresenceInput) {
    const agentId = requireActingAgent(principal);
    const membership = await this.memberships.requireAgentConversationMembership(
      agentId,
      input.conversationId
    );
    return this.writePresence(membership.id, agentId, input);
  }

  private async writePresence(
    membershipId: string,
    agentId: string,
    input: AgentPresenceInput,
    overrideTitle?: string | null
  ) {
    const now = new Date();
    const metadata = (input.metadata ?? {}) as Prisma.InputJsonValue;
    const activityTitle =
      overrideTitle !== undefined ? overrideTitle : input.activityTitle ?? null;

    const presence = await this.prisma.agentPresence.upsert({
      where: { membershipId },
      create: {
        membershipId,
        agentId,
        conversationId: input.conversationId,
        status: input.status,
        statusMessage: input.statusMessage ?? null,
        activityTitle,
        metadata,
        lastSeenAt: now
      },
      update: {
        status: input.status,
        statusMessage: input.statusMessage ?? null,
        activityTitle,
        metadata,
        lastSeenAt: now
      }
    });

    await this.prisma.agent.update({
      where: { id: agentId },
      data: { lastSeenAt: now }
    });
    await this.realtime.emit(
      "agent.presence.updated",
      {
        agentId,
        conversationId: input.conversationId,
        status: presence.status,
        statusMessage: presence.statusMessage,
        activityTitle: presence.activityTitle
      },
      input.conversationId
    );
    return { presence };
  }

  async startActivity(principal: Principal, input: StartAgentActivityInput) {
    const agentId = requireActingAgent(principal);
    const membership = await this.memberships.requireAgentConversationMembership(
      agentId,
      input.conversationId
    );

    const activity = await this.prisma.agentActivity.create({
      data: {
        agentId,
        conversationId: input.conversationId,
        membershipId: membership.id,
        title: input.title,
        status: "working",
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });

    await this.writePresence(
      membership.id,
      agentId,
      { conversationId: input.conversationId, status: "working" },
      input.title
    );
    await this.realtime.emit(
      "agent.activity.started",
      { id: activity.id, agentId, conversationId: input.conversationId, title: activity.title },
      input.conversationId
    );
    return { activity };
  }

  async finishActivity(principal: Principal, input: FinishAgentActivityInput) {
    const agentId = requireActingAgent(principal);
    const membership = await this.memberships.requireAgentConversationMembership(
      agentId,
      input.conversationId
    );

    const activity = input.activityId
      ? await this.prisma.agentActivity.findUnique({ where: { id: input.activityId } })
      : await this.prisma.agentActivity.findFirst({
          where: { membershipId: membership.id, agentId, status: "working" },
          orderBy: { startedAt: "desc" }
        });

    if (!activity) {
      throw notFound("Active agent activity not found");
    }
    if (activity.agentId !== agentId || activity.conversationId !== input.conversationId) {
      throw forbidden("Activity does not belong to this agent and conversation");
    }

    const updated = await this.prisma.agentActivity.update({
      where: { id: activity.id },
      data: {
        status: input.status,
        completedAt: new Date(),
        metadata: {
          ...(activity.metadata as Record<string, unknown>),
          ...(input.metadata ?? {})
        } as Prisma.InputJsonValue
      }
    });

    await this.writePresence(
      membership.id,
      agentId,
      { conversationId: input.conversationId, status: "available" },
      null
    );
    await this.realtime.emit(
      "agent.activity.finished",
      { id: updated.id, agentId, conversationId: input.conversationId, status: updated.status },
      input.conversationId
    );

    const inbox = await this.syncInbox(principal, {
      limit: 25,
      includeAcknowledged: false
    });
    return { activity: updated, inbox };
  }

  async syncInbox(principal: Principal, input: SyncAgentInboxInput) {
    const agentId = requireActingAgent(principal);
    const statusFilter = input.includeAcknowledged
      ? undefined
      : { in: ["pending", "delivered"] };

    const deliveries = await this.prisma.agentEventDelivery.findMany({
      where: {
        agentId,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(input.eventTypes ? { event: { type: { in: input.eventTypes } } } : {})
      },
      include: {
        event: {
          include: {
            conversation: { select: { id: true, title: true, projectId: true } },
            message: { select: { id: true, sequenceNumber: true } },
            targetAgent: { select: { id: true, handle: true } }
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: input.limit
    });

    const pendingIds = deliveries
      .filter((delivery) => delivery.status === "pending")
      .map((delivery) => delivery.id);
    const deliveredAt = new Date();
    if (pendingIds.length > 0) {
      await this.prisma.agentEventDelivery.updateMany({
        where: { id: { in: pendingIds } },
        data: { status: "delivered", deliveredAt }
      });
    }

    const pendingCount = await this.prisma.agentEventDelivery.count({
      where: { agentId, status: { in: ["pending", "delivered"] } }
    });
    await this.touch(agentId);

    return {
      events: deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        status: delivery.status === "pending" ? "delivered" : delivery.status,
        deliveredAt: delivery.status === "pending" ? deliveredAt : delivery.deliveredAt,
        acknowledgedAt: delivery.acknowledgedAt,
        event: delivery.event
      })),
      pendingCount,
      recommendedNextAction:
        pendingCount > 0
          ? "Process these events, then call centragent_inbox_ack with the deliveryIds you handled."
          : "No pending events. Continue the current task; call centragent_inbox_sync after tasks."
    };
  }

  async ackEvents(principal: Principal, deliveryIds: string[]) {
    const agentId = requireActingAgent(principal);
    const result = await this.prisma.agentEventDelivery.updateMany({
      where: { id: { in: deliveryIds }, agentId },
      data: { status: "acknowledged", acknowledgedAt: new Date() }
    });
    await this.touch(agentId);
    await this.realtime.emit("agent.event.acknowledged", {
      agentId,
      deliveryIds,
      acknowledgedCount: result.count
    });
    return { acknowledgedCount: result.count };
  }

  async waitForEvents(
    principal: Principal,
    input: WaitForAgentEventsInput,
    signal?: AbortSignal
  ) {
    const agentId = requireActingAgent(principal);
    const deadline = Date.now() + input.timeoutSeconds * 1000;
    const subscriber = this.realtime.makeRedisSubscriber();
    let wake: (() => void) | undefined;
    let redisSubscribed = false;

    try {
      subscriber.on("error", (error) =>
        this.log.warn({ error, agentId }, "agent inbox wait redis error")
      );
      await subscriber.connect();
      await subscriber.subscribe(agentEventsRedisChannel(agentId));
      subscriber.on("message", () => wake?.());
      redisSubscribed = true;
    } catch (error) {
      this.log.warn({ error, agentId }, "Redis agent wake unavailable; polling only");
    }

    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          return { events: [], pendingCount: 0, status: "cancelled" };
        }
        if (await this.guard.isKilled()) {
          return {
            events: [],
            pendingCount: 0,
            status: "autonomy_paused",
            recommendedNextAction:
              "Autonomy is globally disabled. Idle and retry later, or wait for resume."
          };
        }
        const inbox = await this.syncInbox(principal, {
          limit: input.limit,
          includeAcknowledged: false,
          ...(input.eventTypes ? { eventTypes: input.eventTypes } : {})
        });
        if (inbox.events.length > 0) {
          return { ...inbox, status: "events_available" };
        }
        const remainingMs = deadline - Date.now();
        await Promise.race([
          sleep(Math.min(remainingMs, 5000)),
          new Promise<void>((resolve) => {
            wake = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          })
        ]);
      }
      return {
        events: [],
        pendingCount: 0,
        status: "timed_out",
        recommendedNextAction:
          "No events arrived. Continue useful work; call centragent_inbox_sync after tasks."
      };
    } finally {
      wake = undefined;
      if (redisSubscribed) {
        await subscriber
          .unsubscribe(agentEventsRedisChannel(agentId))
          .catch(() => undefined);
      }
      await subscriber.quit().catch(() => undefined);
    }
  }

  private async touch(agentId: string) {
    await this.prisma.agent
      .update({ where: { id: agentId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
}
