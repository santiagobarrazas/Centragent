import { Prisma, type Document, type DocumentKind, type PrismaClient } from "@prisma/client";
import type { DocumentRefInput } from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { actorType } from "../auth/principal.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import type { MembershipService } from "./membership-service.js";
import type { QdrantMemoryService } from "./qdrant-memory-service.js";
import type { RealtimeService } from "./realtime-service.js";

type AuthorData = {
  authorType: "user" | "agent";
  authorUserId: string | null;
  authorAgentId: string | null;
};

const authorOf = (principal: Principal): AuthorData => ({
  authorType: actorType(principal),
  authorUserId: principal.agentId ? null : principal.userId,
  authorAgentId: principal.agentId
});

export class DocumentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly qdrantMemory: QdrantMemoryService,
    private readonly realtime: RealtimeService
  ) {}

  // --- creation -------------------------------------------------------------

  /** Create a document plus its initial version (version 1). */
  async create(input: {
    kind: DocumentKind;
    title: string;
    projectId?: string | null;
    conversationId?: string | null;
    agentId?: string | null;
    slug?: string | null;
    content?: string;
    agentEditable?: boolean;
    author?: Principal;
  }) {
    const isNotes = input.kind === "agent_notes";
    const content = input.content ?? "";
    const author: AuthorData = input.author
      ? authorOf(input.author)
      : { authorType: "user", authorUserId: null, authorAgentId: null };

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          kind: input.kind,
          title: input.title,
          projectId: input.projectId ?? null,
          conversationId: input.conversationId ?? null,
          agentId: input.agentId ?? null,
          slug: input.slug ?? null,
          agentEditable: input.agentEditable ?? !isNotes,
          isPrivate: isNotes,
          visibility: isNotes ? "private" : "shared",
          currentContent: content,
          versionSeq: 1
        }
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: created.id,
          versionNumber: 1,
          content,
          editSource: input.author ? "manual" : "system",
          authorType: author.authorType,
          authorUserId: author.authorUserId,
          authorAgentId: author.authorAgentId
        }
      });
      return tx.document.update({
        where: { id: created.id },
        data: { currentVersionId: version.id }
      });
    });

    void this.index(document);
    return document;
  }

  /** Idempotently fetch-or-create the singleton document for a scope/kind. */
  async ensureScoped(input: {
    kind: DocumentKind;
    title: string;
    projectId?: string | null;
    conversationId?: string | null;
    agentId?: string | null;
    content?: string;
    agentEditable?: boolean;
  }): Promise<Document> {
    const where: Prisma.DocumentWhereInput = { kind: input.kind };
    if (input.projectId) where.projectId = input.projectId;
    if (input.conversationId) where.conversationId = input.conversationId;
    if (input.agentId) where.agentId = input.agentId;

    const existing = await this.prisma.document.findFirst({ where });
    if (existing) {
      return existing;
    }
    return this.create(input);
  }

  // --- reads ----------------------------------------------------------------

  async resolve(ref: DocumentRefInput): Promise<Document> {
    if (ref.documentId) {
      const document = await this.prisma.document.findUnique({
        where: { id: ref.documentId }
      });
      if (!document) {
        throw notFound("Document not found");
      }
      return document;
    }
    if (!ref.kind) {
      throw badRequest("Provide documentId or kind");
    }
    const where: Prisma.DocumentWhereInput = { kind: ref.kind };
    if (ref.projectId) where.projectId = ref.projectId;
    if (ref.conversationId) where.conversationId = ref.conversationId;
    if (ref.agentId) where.agentId = ref.agentId;
    if (ref.slug) where.slug = ref.slug;
    const document = await this.prisma.document.findFirst({ where });
    if (!document) {
      throw notFound("Document not found");
    }
    return document;
  }

  async read(principal: Principal, ref: DocumentRefInput) {
    const document = await this.resolve(ref);
    await this.requireCanRead(principal, document);
    return document;
  }

  async listProjectAssets(principal: Principal, projectId: string) {
    await this.memberships.requireProjectRole(principal, projectId, "viewer");
    return this.prisma.document.findMany({
      where: { projectId, kind: { in: ["project_overview", "project_asset"] } },
      orderBy: [{ kind: "asc" }, { title: "asc" }],
      select: {
        id: true,
        kind: true,
        title: true,
        slug: true,
        updatedAt: true,
        agentEditable: true
      }
    });
  }

  async versions(principal: Principal, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId }
    });
    if (!document) {
      throw notFound("Document not found");
    }
    await this.requireCanRead(principal, document);
    return this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
      take: 50,
      include: {
        authorUser: { select: { id: true, name: true } }
      }
    });
  }

  // --- writes ---------------------------------------------------------------

  async update(
    principal: Principal,
    documentId: string,
    content: string,
    changeSummary?: string
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId }
    });
    if (!document) {
      throw notFound("Document not found");
    }
    await this.requireCanWrite(principal, document);
    return this.writeVersion(document, content, {
      editSource: actorType(principal) === "agent" ? "agent" : "manual",
      ...authorOf(principal),
      changeSummary: changeSummary ?? null
    });
  }

  /** System/worker writer for auto-summaries (bypasses the agent-edit gate). */
  async writeAutoSummary(documentId: string, content: string, changeSummary?: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId }
    });
    if (!document) {
      throw notFound("Document not found");
    }
    return this.writeVersion(document, content, {
      editSource: "auto_summary",
      authorType: "user",
      authorUserId: null,
      authorAgentId: null,
      changeSummary: changeSummary ?? "Automated summary update"
    });
  }

  private async writeVersion(
    document: Document,
    content: string,
    meta: AuthorData & {
      editSource: "manual" | "agent" | "system" | "auto_summary";
      changeSummary: string | null;
    }
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Race-free per-document version allocation (mirrors message_seq).
      const rows = await tx.$queryRaw<Array<{ version_seq: number }>>(Prisma.sql`
        UPDATE "documents"
        SET "version_seq" = "version_seq" + 1
        WHERE "id" = ${document.id}::uuid
        RETURNING "version_seq"
      `);
      const versionNumber = rows[0]?.version_seq ?? 1;
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber,
          content,
          editSource: meta.editSource,
          authorType: meta.authorType,
          authorUserId: meta.authorUserId,
          authorAgentId: meta.authorAgentId,
          changeSummary: meta.changeSummary
        }
      });
      return tx.document.update({
        where: { id: document.id },
        data: { currentContent: content, currentVersionId: version.id }
      });
    });

    void this.index(updated);
    await this.realtime.emit(
      "document.updated",
      {
        id: updated.id,
        kind: updated.kind,
        projectId: updated.projectId,
        conversationId: updated.conversationId,
        agentId: updated.agentId,
        title: updated.title,
        updatedAt: updated.updatedAt
      },
      updated.conversationId ?? undefined
    );
    return updated;
  }

  private index(document: Document) {
    return this.qdrantMemory
      .indexDocument(document)
      .catch(() => undefined);
  }

  // --- authorization --------------------------------------------------------

  private async requireCanRead(principal: Principal, document: Document) {
    if (document.kind === "agent_notes") {
      if (!(await this.isAgentOwnerOrSelf(principal, document.agentId))) {
        throw forbidden("Private notes are visible only to the owning agent");
      }
      return;
    }
    if (document.kind === "agent_profile") {
      if (!(await this.canSeeAgent(principal, document.agentId))) {
        throw forbidden("You cannot view this agent");
      }
      return;
    }
    if (document.conversationId) {
      await this.memberships.resolveReadMembership(principal, document.conversationId);
      return;
    }
    if (document.projectId) {
      await this.memberships.requireProjectRole(principal, document.projectId, "viewer");
      return;
    }
    throw forbidden("You cannot view this document");
  }

  private async requireCanWrite(principal: Principal, document: Document) {
    const isAgent = actorType(principal) === "agent";

    if (document.kind === "agent_notes") {
      const ownerOrSelf = await this.isAgentOwnerOrSelf(principal, document.agentId);
      if (!ownerOrSelf) {
        throw forbidden("Only the owning agent's user or the agent may edit these notes");
      }
      // The agent itself may edit only when the per-agent toggle is on.
      if (isAgent) {
        const agent = await this.prisma.agent.findUnique({
          where: { id: document.agentId ?? "" },
          select: { notesAgentEditable: true }
        });
        if (!agent?.notesAgentEditable || !document.agentEditable) {
          throw forbidden("Agent self-editing of notes is disabled for this agent");
        }
      }
      return;
    }

    if (isAgent && !document.agentEditable) {
      throw forbidden("This document is not agent-editable");
    }

    if (document.kind === "agent_profile") {
      if (!(await this.isAgentOwnerOrSelf(principal, document.agentId))) {
        throw forbidden("Only the agent's owner or the agent may edit its profile");
      }
      return;
    }
    if (document.conversationId) {
      await this.memberships.resolveParticipantMembership(
        principal,
        document.conversationId
      );
      return;
    }
    if (document.projectId) {
      await this.memberships.requireProjectRole(principal, document.projectId, "member");
      return;
    }
    throw forbidden("You cannot edit this document");
  }

  private async isAgentOwnerOrSelf(principal: Principal, agentId: string | null) {
    if (!agentId) {
      return false;
    }
    if (principal.agentId === agentId) {
      return true;
    }
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { ownerId: true }
    });
    return agent?.ownerId === principal.userId && !principal.agentId;
  }

  private async canSeeAgent(principal: Principal, agentId: string | null) {
    if (!agentId) {
      return false;
    }
    if (await this.isAgentOwnerOrSelf(principal, agentId)) {
      return true;
    }
    const [agentProjects, principalProjects] = await Promise.all([
      this.prisma.membership.findMany({
        where: { agentId, status: "active" },
        select: { projectId: true },
        distinct: ["projectId"]
      }),
      this.memberships.accessibleProjectIds(principal)
    ]);
    const shared = new Set(principalProjects);
    return agentProjects.some((row) => shared.has(row.projectId));
  }
}
