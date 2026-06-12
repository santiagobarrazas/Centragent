import type { FastifyBaseLogger } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  decodeSequenceCursor,
  encodeSequenceCursor
} from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { actorType } from "../auth/principal.js";
import type { AgentEventService } from "./agent-event-service.js";
import type { MembershipService } from "./membership-service.js";
import type { QdrantMemoryService } from "./qdrant-memory-service.js";
import type { RealtimeService } from "./realtime-service.js";

const messageInclude = {
  senderUser: { select: { id: true, name: true, avatarColor: true } },
  senderAgent: { select: { id: true, name: true, handle: true, provider: true } }
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export class MessageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly realtime: RealtimeService,
    private readonly qdrantMemory: QdrantMemoryService,
    private readonly agentEvents: AgentEventService,
    private readonly log: FastifyBaseLogger
  ) {}

  /** Post a message as the resolved principal (user or impersonated agent). */
  async post(
    principal: Principal,
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    const { projectId, membership } =
      await this.memberships.resolveParticipantMembership(principal, conversationId);
    const isAgent = actorType(principal) === "agent";

    const message = await this.prisma.$transaction(async (tx) => {
      // Race-free per-conversation sequence allocation.
      const rows = await tx.$queryRaw<Array<{ message_seq: number }>>(Prisma.sql`
        UPDATE "conversations"
        SET "message_seq" = "message_seq" + 1,
            "last_message_at" = now(),
            "updated_at" = now()
        WHERE "id" = ${conversationId}::uuid
        RETURNING "message_seq"
      `);
      const sequenceNumber = rows[0]?.message_seq ?? 1;

      return tx.message.create({
        data: {
          conversationId,
          senderType: isAgent ? "agent" : "user",
          senderUserId: isAgent ? null : principal.userId,
          senderAgentId: isAgent ? principal.agentId : null,
          membershipId: membership.id,
          role: isAgent ? "assistant" : "user",
          status: "complete",
          content,
          sequenceNumber,
          metadata: (metadata ?? {}) as Prisma.InputJsonValue
        },
        include: messageInclude
      });
    });

    if (isAgent && principal.agentId) {
      void this.prisma.agent
        .update({ where: { id: principal.agentId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    await this.realtime.emit(
      "message.created",
      this.present(message),
      conversationId
    );
    await this.realtime.emit(
      "conversation.updated",
      { conversationId, projectId, lastMessageAt: message.createdAt },
      conversationId
    );

    try {
      await this.qdrantMemory.indexMessage(message, projectId);
    } catch (error) {
      this.log.warn({ error, messageId: message.id }, "Qdrant indexing failed");
    }
    try {
      await this.agentEvents.createMentionsForMessage({
        id: message.id,
        conversationId,
        senderType: message.senderType,
        senderAgentId: message.senderAgentId,
        senderUserId: message.senderUserId,
        content
      });
    } catch (error) {
      this.log.warn(
        { error, messageId: message.id },
        "Agent mention event creation failed"
      );
    }

    return this.present(message);
  }

  async list(
    principal: Principal,
    conversationId: string,
    options: { limit: number; cursor?: string | undefined; direction: "before" | "after" }
  ) {
    await this.memberships.resolveReadMembership(principal, conversationId);
    return this.listRaw(conversationId, options);
  }

  /** Pagination without an auth check (callers must authorize first). */
  async listRaw(
    conversationId: string,
    options: { limit: number; cursor?: string | undefined; direction: "before" | "after" }
  ) {
    const cursorSequence = decodeSequenceCursor(options.cursor);
    const where: Prisma.MessageWhereInput = {
      conversationId,
      ...(cursorSequence !== undefined
        ? options.direction === "before"
          ? { sequenceNumber: { lt: cursorSequence } }
          : { sequenceNumber: { gt: cursorSequence } }
        : {})
    };

    const rows = await this.prisma.message.findMany({
      where,
      include: messageInclude,
      orderBy:
        options.direction === "before"
          ? [{ sequenceNumber: "desc" }]
          : [{ sequenceNumber: "asc" }],
      take: options.limit + 1
    });

    const page = rows.slice(0, options.limit);
    const messages = options.direction === "before" ? page.reverse() : page;
    const boundary =
      rows.length > options.limit
        ? options.direction === "before"
          ? messages.at(0)
          : messages.at(-1)
        : undefined;

    return {
      messages: messages.map((message) => this.present(message)),
      nextCursor: boundary ? encodeSequenceCursor(boundary.sequenceNumber) : null
    };
  }

  private present(message: MessageRow) {
    const sender = message.senderAgent
      ? {
          type: "agent" as const,
          id: message.senderAgent.id,
          name: message.senderAgent.name,
          handle: message.senderAgent.handle,
          provider: message.senderAgent.provider
        }
      : message.senderUser
        ? {
            type: "user" as const,
            id: message.senderUser.id,
            name: message.senderUser.name,
            avatarColor: message.senderUser.avatarColor
          }
        : null;

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderType: message.senderType,
      role: message.role,
      status: message.status,
      content: message.content,
      sequenceNumber: message.sequenceNumber,
      createdAt: message.createdAt,
      metadata: message.metadata,
      sender
    };
  }
}
