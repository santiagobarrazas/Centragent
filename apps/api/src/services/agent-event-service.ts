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
import { forbidden, notFound } from "../errors.js";
import type { RealtimeService } from "./realtime-service.js";

type MessageForMentions = {
  id: string;
  conversationId: string;
  senderType: string;
  senderId: string | null;
  conversationAgentId: string | null;
  content: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mentionHandles = (content: string) => {
  const handles = new Set<string>();
  for (const match of content.matchAll(/@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})/g)) {
    const handle = match[1];
    if (handle) {
      handles.add(handle.toLowerCase());
    }
  }
  return [...handles];
};

export class AgentEventService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly realtime: RealtimeService,
    private readonly log: FastifyBaseLogger
  ) {}

  async createMentionsForMessage(message: MessageForMentions) {
    const handles = mentionHandles(message.content);
    if (handles.length === 0) {
      return [];
    }

    const targets = await this.prisma.conversationAgent.findMany({
      where: {
        conversationId: message.conversationId,
        status: "active",
        agent: {
          handle: { in: handles }
        }
      },
      include: { agent: true }
    });

    const created = [];
    for (const target of targets) {
      if (message.senderType === "agent" && target.agentId === message.senderId) {
        continue;
      }

      const event = await this.prisma.agentEvent.create({
        data: {
          type: "mention",
          conversationId: message.conversationId,
          messageId: message.id,
          actorType: message.senderType,
          actorId: message.senderId,
          targetAgentId: target.agentId,
          targetConversationAgentId: target.id,
          title: `${target.agent.name} was mentioned`,
          content: message.content,
          data: {
            handle: target.agent.handle,
            source: "message"
          },
          deliveries: {
            create: {
              agentId: target.agentId,
              conversationAgentId: target.id,
              status: "pending"
            }
          }
        },
        include: {
          deliveries: true,
          targetAgent: true,
          targetConversationAgent: true
        }
      });

      created.push(event);
      await this.realtime.emit(
        "agent.event.created",
        event,
        message.conversationId
      );
      await this.realtime.publishAgentEvent(target.agentId, {
        eventId: event.id,
        type: event.type
      });
    }

    return created;
  }

  async setPresence(input: AgentPresenceInput) {
    const membership = await this.requireActiveMembership(
      input.conversationAgentId
    );
    const now = new Date();
    const metadata = (input.metadata ?? {}) as Prisma.InputJsonValue;

    const presence = await this.prisma.agentPresence.upsert({
      where: { agentId: membership.agentId },
      create: {
        agentId: membership.agentId,
        status: input.status,
        statusMessage: input.statusMessage ?? null,
        activeConversationId: membership.conversationId,
        activeConversationAgentId: membership.id,
        activityTitle: input.activityTitle ?? null,
        metadata,
        lastSeenAt: now
      },
      update: {
        status: input.status,
        statusMessage: input.statusMessage ?? null,
        activeConversationId: membership.conversationId,
        activeConversationAgentId: membership.id,
        activityTitle: input.activityTitle ?? null,
        metadata,
        lastSeenAt: now
      }
    });

    await this.prisma.agent.update({
      where: { id: membership.agentId },
      data: { lastSeenAt: now }
    });
    await this.realtime.emit(
      "agent.presence.updated",
      presence,
      membership.conversationId
    );

    return { presence };
  }

  async startActivity(input: StartAgentActivityInput) {
    const membership = await this.requireActiveMembership(
      input.conversationAgentId
    );

    const activity = await this.prisma.agentActivity.create({
      data: {
        agentId: membership.agentId,
        conversationId: membership.conversationId,
        conversationAgentId: membership.id,
        title: input.title,
        status: "working",
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });

    await this.setPresence({
      conversationAgentId: membership.id,
      status: "working",
      activityTitle: input.title
    });
    await this.realtime.emit(
      "agent.activity.started",
      activity,
      membership.conversationId
    );

    return { activity };
  }

  async finishActivity(input: FinishAgentActivityInput) {
    const membership = await this.requireActiveMembership(
      input.conversationAgentId
    );
    const activity = input.activityId
      ? await this.prisma.agentActivity.findUnique({
          where: { id: input.activityId }
        })
      : await this.prisma.agentActivity.findFirst({
          where: {
            conversationAgentId: membership.id,
            agentId: membership.agentId,
            status: "working"
          },
          orderBy: { startedAt: "desc" }
        });

    if (!activity) {
      throw notFound("Active agent activity not found");
    }

    if (
      activity.agentId !== membership.agentId ||
      activity.conversationAgentId !== membership.id
    ) {
      throw forbidden("Activity does not belong to this conversation agent");
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

    await this.setPresence({
      conversationAgentId: membership.id,
      status: "available"
    });
    await this.realtime.emit(
      "agent.activity.finished",
      updated,
      membership.conversationId
    );

    const inbox = await this.syncInbox({
      conversationAgentId: membership.id,
      limit: 25,
      includeAcknowledged: false
    });

    return { activity: updated, inbox };
  }

  async syncInbox(input: SyncAgentInboxInput) {
    const membership = await this.requireActiveMembership(
      input.conversationAgentId
    );
    const statusFilter = input.includeAcknowledged
      ? undefined
      : { in: ["pending", "delivered"] };

    const deliveries = await this.prisma.agentEventDelivery.findMany({
      where: {
        agentId: membership.agentId,
        ...(statusFilter ? { status: statusFilter } : {}),
        event: {
          ...(input.eventTypes ? { type: { in: input.eventTypes } } : {})
        }
      },
      include: {
        event: {
          include: {
            conversation: true,
            message: true,
            targetAgent: true,
            targetConversationAgent: true
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: input.limit
    });

    const pendingDeliveryIds = deliveries
      .filter((delivery) => delivery.status === "pending")
      .map((delivery) => delivery.id);
    const deliveredAt = new Date();

    if (pendingDeliveryIds.length > 0) {
      await this.prisma.agentEventDelivery.updateMany({
        where: { id: { in: pendingDeliveryIds } },
        data: {
          status: "delivered",
          deliveredAt
        }
      });
    }

    const pendingCount = await this.prisma.agentEventDelivery.count({
      where: {
        agentId: membership.agentId,
        status: { in: ["pending", "delivered"] }
      }
    });

    await this.touchAgent(membership.agentId);

    return {
      events: deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        status:
          delivery.status === "pending" ? "delivered" : delivery.status,
        deliveredAt:
          delivery.status === "pending" ? deliveredAt : delivery.deliveredAt,
        acknowledgedAt: delivery.acknowledgedAt,
        event: delivery.event
      })),
      pendingCount,
      recommendedNextAction:
        pendingCount > 0
          ? "Process these events, then call ack_agent_events with the deliveryIds you handled."
          : "No pending events. Continue the current task or call wait_for_events only when you are available."
    };
  }

  async ackEvents(input: { conversationAgentId: string; deliveryIds: string[] }) {
    const membership = await this.requireActiveMembership(
      input.conversationAgentId
    );

    const result = await this.prisma.agentEventDelivery.updateMany({
      where: {
        id: { in: input.deliveryIds },
        agentId: membership.agentId
      },
      data: {
        status: "acknowledged",
        acknowledgedAt: new Date()
      }
    });

    await this.touchAgent(membership.agentId);
    await this.realtime.emit(
      "agent.event.acknowledged",
      {
        conversationAgentId: membership.id,
        agentId: membership.agentId,
        deliveryIds: input.deliveryIds,
        acknowledgedCount: result.count
      },
      membership.conversationId
    );

    return { acknowledgedCount: result.count };
  }

  async waitForEvents(input: WaitForAgentEventsInput, signal?: AbortSignal) {
    const membership = await this.requireActiveMembership(
      input.conversationAgentId
    );
    await this.setPresence({
      conversationAgentId: membership.id,
      status: "listening",
      statusMessage: "Waiting for mentions and inbox events"
    });

    const deadline = Date.now() + input.timeoutSeconds * 1000;
    const subscriber = this.realtime.makeRedisSubscriber();
    let wake: (() => void) | undefined;
    let redisSubscribed = false;

    try {
      subscriber.on("error", (error) =>
        this.log.warn({ error, agentId: membership.agentId }, "agent inbox wait redis error")
      );
      await subscriber.connect();
      await subscriber.subscribe(agentEventsRedisChannel(membership.agentId));
      subscriber.on("message", () => {
        wake?.();
      });
      redisSubscribed = true;
    } catch (error) {
      this.log.warn(
        { error, agentId: membership.agentId },
        "Redis agent wake unavailable; using polling only"
      );
    }

    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          return {
            events: [],
            pendingCount: 0,
            status: "cancelled",
            recommendedNextAction:
              "wait_for_events was cancelled. Call sync_agent_inbox after finishing your current task."
          };
        }

        const inbox = await this.syncInbox({
          conversationAgentId: input.conversationAgentId,
          limit: input.limit,
          includeAcknowledged: false,
          ...(input.eventTypes ? { eventTypes: input.eventTypes } : {})
        });

        if (inbox.events.length > 0) {
          return {
            ...inbox,
            status: "events_available"
          };
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
          "No events arrived. Continue useful work, call sync_agent_inbox after tasks, or call wait_for_events again only if idle."
      };
    } finally {
      wake = undefined;
      if (redisSubscribed) {
        await subscriber.unsubscribe(agentEventsRedisChannel(membership.agentId)).catch(
          () => undefined
        );
      }
      await subscriber.quit().catch(() => undefined);
    }
  }

  private async requireActiveMembership(conversationAgentId: string) {
    const membership = await this.prisma.conversationAgent.findUnique({
      where: { id: conversationAgentId },
      include: { agent: true }
    });

    if (!membership || membership.status !== "active") {
      throw forbidden("Agent is not an active conversation member");
    }

    return membership;
  }

  private async touchAgent(agentId: string) {
    const now = new Date();
    await this.prisma.agent.update({
      where: { id: agentId },
      data: { lastSeenAt: now }
    });
  }
}
