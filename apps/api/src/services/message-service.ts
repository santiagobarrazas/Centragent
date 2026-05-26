import type { FastifyBaseLogger } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  decodeSequenceCursor,
  encodeSequenceCursor,
  type SendAgentMessageInput
} from "@centragent/shared";
import type { AppConfig } from "../config.js";
import { forbidden, notFound } from "../errors.js";
import type { AgentEventService } from "./agent-event-service.js";
import type { QdrantMemoryService } from "./qdrant-memory-service.js";
import type { RealtimeService } from "./realtime-service.js";

type CreateMessageInput = {
  conversationId: string;
  senderType: "user" | "agent" | "system" | "tool";
  senderId?: string | null;
  conversationAgentId?: string | null;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: Record<string, unknown> | undefined;
};

export class MessageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly realtime: RealtimeService,
    private readonly qdrantMemory: QdrantMemoryService,
    private readonly agentEvents: AgentEventService,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger
  ) {}

  async createUserMessage(
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    // TODO(auth): senderId should come from authenticated master user context.
    return this.createMessage({
      conversationId,
      senderType: "user",
      senderId: this.config.MASTER_USER_ID,
      role: "user",
      content,
      metadata
    });
  }

  async createAgentMessage(input: SendAgentMessageInput) {
    const membership = await this.requireActiveConversationAgent(
      input.conversationId,
      input.conversationAgentId
    );

    return this.createMessage({
      conversationId: input.conversationId,
      senderType: "agent",
      senderId: membership.agentId,
      conversationAgentId: input.conversationAgentId,
      role: "assistant",
      content: input.content,
      metadata: input.metadata
    });
  }

  async listMessages(input: {
    conversationId: string;
    limit: number;
    cursor?: string | undefined;
    direction: "before" | "after";
  }) {
    const cursorSequence = decodeSequenceCursor(input.cursor);
    const where: Prisma.MessageWhereInput = {
      conversationId: input.conversationId,
      ...(cursorSequence !== undefined
        ? input.direction === "before"
          ? { sequenceNumber: { lt: cursorSequence } }
          : { sequenceNumber: { gt: cursorSequence } }
        : {})
    };

    const rows = await this.prisma.message.findMany({
      where,
      include: {
        conversationAgent: {
          include: {
            agent: true
          }
        }
      },
      orderBy:
        input.direction === "before"
          ? [{ sequenceNumber: "desc" }]
          : [{ sequenceNumber: "asc" }],
      take: input.limit + 1
    });

    const page = rows.slice(0, input.limit);
    const messages =
      input.direction === "before" ? page.reverse() : page;
    const boundary =
      rows.length > input.limit
        ? input.direction === "before"
          ? messages.at(0)
          : messages.at(-1)
        : undefined;

    return {
      messages: messages.map((message) => this.presentMessage(message)),
      nextCursor: boundary
        ? encodeSequenceCursor(boundary.sequenceNumber)
        : null
    };
  }

  async requireActiveConversationAgent(
    conversationId: string,
    conversationAgentId: string
  ) {
    const membership = await this.prisma.conversationAgent.findUnique({
      where: { id: conversationAgentId }
    });

    if (
      !membership ||
      membership.conversationId !== conversationId ||
      membership.status !== "active"
    ) {
      throw forbidden("Agent is not an active member of this conversation");
    }

    return membership;
  }

  private async createMessage(input: CreateMessageInput) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const message = await this.prisma.$transaction(async (tx) => {
          const conversation = await tx.conversation.findUnique({
            where: { id: input.conversationId },
            select: { id: true }
          });

          if (!conversation) {
            throw notFound("Conversation not found");
          }

          const maxSequence = await tx.message.aggregate({
            where: { conversationId: input.conversationId },
            _max: { sequenceNumber: true }
          });

          const created = await tx.message.create({
            data: {
              conversationId: input.conversationId,
              senderType: input.senderType,
              senderId: input.senderId ?? null,
              conversationAgentId: input.conversationAgentId ?? null,
              role: input.role,
              status: "complete",
              content: input.content,
              sequenceNumber: (maxSequence._max.sequenceNumber ?? 0) + 1,
              metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
            },
            include: {
              conversationAgent: {
                include: {
                  agent: true
                }
              }
            }
          });

          await tx.conversation.update({
            where: { id: input.conversationId },
            data: { lastMessageAt: created.createdAt }
          });

          return created;
        });

        await this.realtime.emit(
          "message.created",
          this.presentMessage(message),
          input.conversationId
        );
        await this.realtime.emit("conversation.updated", {
          conversationId: input.conversationId,
          lastMessageAt: message.createdAt
        });

        try {
          await this.qdrantMemory.indexMessage(message);
        } catch (error) {
          this.log.warn({ error, messageId: message.id }, "Qdrant indexing failed");
        }

        try {
          await this.agentEvents.createMentionsForMessage(message);
        } catch (error) {
          this.log.warn(
            { error, messageId: message.id },
            "Agent mention event creation failed"
          );
        }

        return this.presentMessage(message);
      } catch (error) {
        const maybePrismaError = error as { code?: string };
        if (maybePrismaError.code === "P2002" && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Unable to create message");
  }

  private presentMessage<
    TMessage extends {
      senderType: string;
      conversationAgent?: {
        agent: {
          id: string;
          name: string;
          handle: string;
          provider: string;
        };
      } | null;
    }
  >(message: TMessage) {
    const agent = message.conversationAgent?.agent;

    return {
      ...message,
      sender:
        message.senderType === "agent" && agent
          ? {
              id: agent.id,
              name: agent.name,
              handle: agent.handle,
              provider: agent.provider
            }
          : null
    };
  }
}
