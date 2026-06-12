import type { Agent, Prisma, PrismaClient } from "@prisma/client";
import type { CreateProjectInput } from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { notFound } from "../errors.js";
import type { DocumentService } from "./document-service.js";
import type { MembershipService } from "./membership-service.js";
import type { RealtimeService } from "./realtime-service.js";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";

const encodeCursor = (createdAt: Date, id: string) =>
  `${createdAt.toISOString()}|${id}`;

const decodeCursor = (cursor?: string) => {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id) return null;
  const date = new Date(createdAt);
  return Number.isNaN(date.valueOf()) ? null : { createdAt: date, id };
};

export class ProjectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly documents: DocumentService,
    private readonly realtime: RealtimeService
  ) {}

  async create(principal: Principal, input: CreateProjectInput) {
    const project = await this.prisma.project.create({
      data: {
        name: input.name,
        slug: await this.uniqueSlug(input.slug ?? slugify(input.name)),
        summary: input.summary ?? null,
        kind: "workspace",
        createdById: principal.userId
      }
    });

    await this.memberships.ensureProjectOwnerMembership(principal.userId, project.id);
    // An agent that created the project keeps access to it.
    if (principal.agentId) {
      await this.prisma.membership.create({
        data: {
          principalType: "agent",
          agentId: principal.agentId,
          projectId: project.id,
          role: "member",
          status: "active",
          joinedAt: new Date()
        }
      });
    }

    await this.documents.ensureScoped({
      kind: "project_overview",
      title: `${project.name} overview`,
      projectId: project.id,
      content: input.summary
        ? `# ${project.name}\n\n${input.summary}\n`
        : `# ${project.name}\n\n_Describe what this project is about. This document is the project's living overview._\n`
    });

    await this.realtime.emit("project.created", this.present(project), undefined);
    return project;
  }

  async list(principal: Principal, limit: number, cursor?: string) {
    const ids = await this.memberships.accessibleProjectIds(principal);
    if (ids.length === 0) {
      return { projects: [], nextCursor: null };
    }

    const decoded = decodeCursor(cursor);
    const where: Prisma.ProjectWhereInput = {
      id: { in: ids },
      archivedAt: null,
      kind: "workspace",
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } }
            ]
          }
        : {})
    };

    const rows = await this.prisma.project.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        _count: {
          select: {
            conversations: true,
            memberships: { where: { conversationId: null, status: "active" } }
          }
        }
      }
    });

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? page.at(-1) : undefined;

    return {
      projects: page.map((project) => ({
        ...this.present(project),
        conversationCount: project._count.conversations,
        memberCount: project._count.memberships
      })),
      nextCursor: next ? encodeCursor(next.createdAt, next.id) : null
    };
  }

  async get(principal: Principal, projectId: string) {
    await this.memberships.requireProjectRole(principal, projectId, "viewer");
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        _count: {
          select: {
            conversations: true,
            memberships: { where: { conversationId: null, status: "active" } }
          }
        }
      }
    });
    if (!project) {
      throw notFound("Project not found");
    }
    const overview = await this.prisma.document.findFirst({
      where: { projectId, kind: "project_overview" },
      select: { id: true }
    });
    return {
      ...this.present(project),
      conversationCount: project._count.conversations,
      memberCount: project._count.memberships,
      overviewDocumentId: overview?.id ?? null
    };
  }

  /** Bootstrap a starter project for the local owner on first run. */
  async ensureDefaultProject(ownerUserId: string) {
    const existing = await this.prisma.membership.findFirst({
      where: { userId: ownerUserId, conversationId: null, status: "active" },
      select: { id: true }
    });
    if (existing) {
      return;
    }
    await this.create(
      {
        userId: ownerUserId,
        agentId: null,
        tokenId: null,
        via: "local-owner",
        scopes: [],
        isLocalOwner: true
      },
      {
        name: "Welcome",
        summary: "Your first Centragent workspace. Invite agents and start a conversation."
      }
    );
  }

  /** Each agent gets a private workspace project (req 7). */
  async ensureAgentWorkspaceProject(agent: Agent) {
    if (agent.workspaceProjectId) {
      return agent.workspaceProjectId;
    }
    const project = await this.prisma.project.create({
      data: {
        name: `${agent.name}'s workspace`,
        slug: await this.uniqueSlug(slugify(`${agent.handle}-workspace`)),
        kind: "agent_workspace",
        summary: `Private workspace for @${agent.handle}.`,
        createdById: agent.ownerId
      }
    });
    await Promise.all([
      this.memberships.ensureProjectOwnerMembership(agent.ownerId, project.id),
      this.prisma.membership.create({
        data: {
          principalType: "agent",
          agentId: agent.id,
          projectId: project.id,
          role: "member",
          status: "active",
          joinedAt: new Date()
        }
      }),
      this.prisma.agent.update({
        where: { id: agent.id },
        data: { workspaceProjectId: project.id }
      })
    ]);
    return project.id;
  }

  private present(project: {
    id: string;
    slug: string;
    name: string;
    kind: string;
    summary: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      kind: project.kind,
      summary: project.summary,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };
  }

  private async uniqueSlug(base: string) {
    const root = slugify(base);
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? root : `${root}-${index + 1}`;
      const existing = await this.prisma.project.findUnique({
        where: { slug: candidate },
        select: { id: true }
      });
      if (!existing) {
        return candidate;
      }
    }
    return `${root}-${Date.now().toString(36)}`;
  }
}
