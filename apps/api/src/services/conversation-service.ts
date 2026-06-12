import type { Prisma, PrismaClient } from "@prisma/client";
import type { CreateConversationInput } from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { actorType } from "../auth/principal.js";
import { notFound } from "../errors.js";
import type { DocumentService } from "./document-service.js";
import type { MembershipService } from "./membership-service.js";
import type { RealtimeService } from "./realtime-service.js";

const encodeCursor = (createdAt: Date, id: string) =>
  `${createdAt.toISOString()}|${id}`;

const decodeCursor = (cursor?: string) => {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id) return null;
  const date = new Date(createdAt);
  return Number.isNaN(date.valueOf()) ? null : { createdAt: date, id };
};

export class ConversationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly documents: DocumentService,
    private readonly realtime: RealtimeService
  ) {}

  async create(principal: Principal, input: CreateConversationInput) {
    await this.memberships.requireProjectRole(principal, input.projectId, "member");

    const conversation = await this.prisma.conversation.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        createdById: principal.userId
      }
    });

    // The creator becomes an explicit participant so presence/messages anchor.
    await this.prisma.membership.create({
      data: {
        principalType: actorType(principal),
        userId: principal.agentId ? null : principal.userId,
        agentId: principal.agentId,
        projectId: input.projectId,
        conversationId: conversation.id,
        role: "member",
        status: "active",
        joinedAt: new Date()
      }
    });

    await this.documents.ensureScoped({
      kind: "conversation_summary",
      title: `${conversation.title} summary`,
      projectId: input.projectId,
      conversationId: conversation.id,
      agentEditable: true,
      content: `# ${conversation.title}\n\n_This summary updates as the conversation grows._\n`
    });

    await this.realtime.emit(
      "conversation.created",
      this.present(conversation),
      conversation.id
    );
    return conversation;
  }

  async list(
    principal: Principal,
    options: { projectId?: string | undefined; limit: number; cursor?: string | undefined }
  ) {
    const where: Prisma.ConversationWhereInput = { archivedAt: null };

    if (actorType(principal) === "agent") {
      where.memberships = {
        some: {
          agentId: principal.agentId!,
          status: "active",
          conversationId: { not: null }
        }
      };
      if (options.projectId) where.projectId = options.projectId;
    } else if (options.projectId) {
      await this.memberships.requireProjectRole(principal, options.projectId, "viewer");
      where.projectId = options.projectId;
    } else if (this.memberships.isSuperuser(principal)) {
      // Superuser sees all conversations across projects.
    } else {
      const rows = await this.prisma.membership.findMany({
        where: { userId: principal.userId, conversationId: null, status: "active" },
        select: { projectId: true },
        distinct: ["projectId"]
      });
      where.projectId = { in: rows.map((row) => row.projectId) };
    }

    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      where.OR = [
        { createdAt: { lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { lt: decoded.id } }
      ];
    }

    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit + 1,
      include: {
        _count: {
          select: {
            memberships: { where: { status: "active", conversationId: { not: null } } }
          }
        }
      }
    });

    const page = rows.slice(0, options.limit);
    const next = rows.length > options.limit ? page.at(-1) : undefined;

    return {
      conversations: page.map((conversation) => ({
        ...this.present(conversation),
        participantCount: conversation._count.memberships
      })),
      nextCursor: next ? encodeCursor(next.createdAt, next.id) : null
    };
  }

  async get(principal: Principal, conversationId: string) {
    const { projectId } = await this.memberships.resolveReadMembership(
      principal,
      conversationId
    );
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    if (!conversation) {
      throw notFound("Conversation not found");
    }
    const summary = await this.prisma.document.findFirst({
      where: { conversationId, kind: "conversation_summary" },
      select: { id: true }
    });
    return {
      ...this.present(conversation),
      projectId,
      summaryDocumentId: summary?.id ?? null
    };
  }

  private present(conversation: {
    id: string;
    projectId: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt: Date | null;
  }) {
    return {
      id: conversation.id,
      projectId: conversation.projectId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessageAt: conversation.lastMessageAt
    };
  }
}
