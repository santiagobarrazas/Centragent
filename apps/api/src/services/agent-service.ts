import type { PrismaClient } from "@prisma/client";
import type { CreateAgentInput, UpdateAgentInput } from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { actorType } from "../auth/principal.js";
import { forbidden, notFound } from "../errors.js";
import type { DocumentService } from "./document-service.js";
import type { MembershipService } from "./membership-service.js";
import type { ProjectService } from "./project-service.js";
import type { RealtimeService } from "./realtime-service.js";

const handleFromName = (name: string) => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized.length >= 2 ? normalized : "agent";
};

export class AgentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly memberships: MembershipService,
    private readonly projects: ProjectService,
    private readonly documents: DocumentService,
    private readonly realtime: RealtimeService
  ) {}

  async create(principal: Principal, input: CreateAgentInput) {
    const handle = await this.uniqueHandle(
      input.handle ?? handleFromName(input.name)
    );

    const agent = await this.prisma.agent.create({
      data: {
        ownerId: principal.userId,
        name: input.name,
        handle,
        provider: input.provider,
        description: input.description ?? null,
        notesAgentEditable: input.notesAgentEditable ?? false,
        clientInstanceId: input.clientInstanceId ?? null,
        config: (input.metadata ?? {}) as object,
        lastSeenAt: new Date()
      }
    });

    await this.projects.ensureAgentWorkspaceProject(agent);

    await this.documents.ensureScoped({
      kind: "agent_profile",
      title: `@${agent.handle} profile`,
      agentId: agent.id,
      agentEditable: true,
      content:
        `# ${agent.name} (@${agent.handle})\n\n` +
        `${agent.description ?? "_This agent has not described itself yet._"}\n\n` +
        `## Capabilities\n\n## Operating notes\n`
    });
    await this.documents.ensureScoped({
      kind: "agent_notes",
      title: `@${agent.handle} private notes`,
      agentId: agent.id,
      agentEditable: true,
      content: ""
    });

    await this.realtime.emit("membership.created", { agentId: agent.id }, undefined);
    return this.get(principal, agent.id);
  }

  async listMine(principal: Principal, limit = 50) {
    const agents = await this.prisma.agent.findMany({
      where: { ownerId: principal.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { presences: { orderBy: { lastSeenAt: "desc" }, take: 1 } }
    });
    return agents.map((agent) => this.present(agent, true));
  }

  async get(principal: Principal, agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        owner: { select: { id: true, name: true } },
        presences: { orderBy: { lastSeenAt: "desc" }, take: 1 }
      }
    });
    if (!agent) {
      throw notFound("Agent not found");
    }

    const isOwner = agent.ownerId === principal.userId && !principal.agentId;
    const isSelf = principal.agentId === agent.id;
    if (!isOwner && !isSelf && !(await this.sharesProject(principal, agentId))) {
      throw forbidden("You cannot view this agent");
    }

    const docs = await this.prisma.document.findMany({
      where: { agentId, kind: { in: ["agent_profile", "agent_notes"] } },
      select: { id: true, kind: true }
    });
    const profile = docs.find((doc) => doc.kind === "agent_profile");
    const notes = docs.find((doc) => doc.kind === "agent_notes");

    return {
      ...this.present(agent, isOwner || isSelf),
      ownerName: agent.owner.name,
      isOwnedByYou: isOwner,
      profileDocumentId: profile?.id ?? null,
      // Only surface the private-notes document id to the owner or the agent.
      notesDocumentId: isOwner || isSelf ? notes?.id ?? null : null,
      workspaceProjectId: isOwner || isSelf ? agent.workspaceProjectId : null
    };
  }

  async update(principal: Principal, agentId: string, input: UpdateAgentInput) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { ownerId: true }
    });
    if (!agent) {
      throw notFound("Agent not found");
    }
    if (agent.ownerId !== principal.userId || principal.agentId) {
      throw forbidden("Only the owner may edit this agent");
    }
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.notesAgentEditable !== undefined
          ? { notesAgentEditable: input.notesAgentEditable }
          : {}),
        ...(input.autonomyEnabled !== undefined
          ? { autonomyEnabled: input.autonomyEnabled }
          : {})
      }
    });
    return this.get(principal, agentId);
  }

  /** Identity summary for the MCP `whoami` tool. */
  async whoami(principal: Principal) {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, name: true, email: true, isLocalOwner: true }
    });
    const actingAgent = principal.agentId
      ? await this.prisma.agent.findUnique({
          where: { id: principal.agentId },
          select: { id: true, name: true, handle: true, provider: true }
        })
      : null;
    const ownedAgents = await this.prisma.agent.findMany({
      where: { ownerId: principal.userId },
      select: { id: true, name: true, handle: true, provider: true },
      orderBy: { createdAt: "asc" }
    });

    return {
      user,
      actorType: actorType(principal),
      impersonating: actingAgent,
      via: principal.via,
      ownedAgents
    };
  }

  private present(
    agent: {
      id: string;
      ownerId: string;
      name: string;
      handle: string;
      provider: string;
      description: string | null;
      notesAgentEditable: boolean;
      autonomyEnabled: boolean;
      lastSeenAt: Date | null;
      createdAt: Date;
      presences?: Array<{
        status: string;
        statusMessage: string | null;
        activityTitle: string | null;
        lastSeenAt: Date;
      }>;
    },
    includeToggles: boolean
  ) {
    return {
      id: agent.id,
      ownerId: agent.ownerId,
      name: agent.name,
      handle: agent.handle,
      provider: agent.provider,
      description: agent.description,
      lastSeenAt: agent.lastSeenAt,
      createdAt: agent.createdAt,
      ...(includeToggles
        ? { notesAgentEditable: agent.notesAgentEditable, autonomyEnabled: agent.autonomyEnabled }
        : {}),
      presence: agent.presences?.[0]
        ? {
            status: agent.presences[0].status,
            statusMessage: agent.presences[0].statusMessage,
            activityTitle: agent.presences[0].activityTitle,
            lastSeenAt: agent.presences[0].lastSeenAt
          }
        : null
    };
  }

  private async sharesProject(principal: Principal, agentId: string) {
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

  private async uniqueHandle(baseHandle: string) {
    const base = handleFromName(baseHandle);
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}-${index + 1}`;
      const existing = await this.prisma.agent.findUnique({
        where: { handle: candidate },
        select: { id: true }
      });
      if (!existing) {
        return candidate;
      }
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
