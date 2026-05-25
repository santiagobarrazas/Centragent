import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { notFound } from "../errors.js";
import type { RealtimeService } from "./realtime-service.js";

const encodeConversationCursor = (createdAt: Date, id: string) =>
  `${createdAt.toISOString()}|${id}`;

const decodeConversationCursor = (cursor?: string) => {
  if (!cursor) {
    return null;
  }

  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id) {
    return null;
  }

  const date = new Date(createdAt);
  return Number.isNaN(date.valueOf()) ? null : { createdAt: date, id };
};

export class ConversationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig
  ) {}

  async list(limit: number, cursor?: string) {
    const decodedCursor = decodeConversationCursor(cursor);

    const where: Prisma.ConversationWhereInput = decodedCursor
        ? {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              {
                createdAt: decodedCursor.createdAt,
                id: { lt: decodedCursor.id }
              }
            ]
          }
        : {};

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        _count: {
          select: {
            agents: {
              where: { status: "active" }
            }
          }
        }
      }
    });

    const page = conversations.slice(0, limit);
    const next = conversations.length > limit ? page.at(-1) : undefined;

    return {
      conversations: page.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessageAt: conversation.lastMessageAt,
        agentCount: conversation._count.agents
      })),
      nextCursor: next
        ? encodeConversationCursor(next.createdAt, next.id)
        : null
    };
  }

  async create(title: string) {
    // TODO(auth): replace singleton owner assignment with authenticated user context.
    const conversation = await this.prisma.conversation.create({
      data: {
        ownerId: this.config.MASTER_USER_ID,
        title
      }
    });

    await this.realtime.emit("conversation.created", conversation);
    return conversation;
  }

  async get(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        agents: {
          include: { agent: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    return conversation;
  }
}
