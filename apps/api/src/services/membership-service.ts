import type { Membership, Prisma, PrismaClient } from "@prisma/client";
import type {
  CreateInviteInput,
  GrantMembershipInput,
  ProjectRole
} from "@centragent/shared";
import type { Principal } from "../auth/principal.js";
import { actorType } from "../auth/principal.js";
import { generateSecret, sha256 } from "../auth/crypto.js";
import { badRequest, forbidden, notFound } from "../errors.js";

const ROLE_ORDER: Record<ProjectRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3
};

export const roleAtLeast = (role: string, min: ProjectRole) =>
  (ROLE_ORDER[role as ProjectRole] ?? -1) >= ROLE_ORDER[min];

// Who is acting: scope every membership lookup to the acting entity (the agent
// when impersonating, otherwise the user), never to "everyone".
const actorWhere = (principal: Principal) =>
  principal.agentId
    ? { agentId: principal.agentId, userId: null }
    : { userId: principal.userId, agentId: null };

export class MembershipService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * The local owner is the instance superuser: they administer everything on
   * their own machine and can never be locked out by a missing/wrong membership.
   * (An agent token is never a superuser, even if its owner is the local owner.)
   */
  isSuperuser(principal: Principal): boolean {
    return principal.isLocalOwner && !principal.agentId;
  }

  // --- read scoping ---------------------------------------------------------

  /** Project ids the acting principal can see (any active membership). */
  async accessibleProjectIds(principal: Principal): Promise<string[]> {
    if (this.isSuperuser(principal)) {
      const all = await this.prisma.project.findMany({
        where: { archivedAt: null },
        select: { id: true }
      });
      return all.map((row) => row.id);
    }
    const rows = await this.prisma.membership.findMany({
      where: { ...actorWhere(principal), status: "active" },
      select: { projectId: true },
      distinct: ["projectId"]
    });
    return rows.map((row) => row.projectId);
  }

  /** The principal's project-level membership (conversationId = null), if any. */
  async projectMembership(
    principal: Principal,
    projectId: string
  ): Promise<Membership | null> {
    return this.prisma.membership.findFirst({
      where: {
        ...actorWhere(principal),
        projectId,
        conversationId: null,
        status: "active"
      }
    });
  }

  async conversationMembership(
    principal: Principal,
    conversationId: string
  ): Promise<Membership | null> {
    return this.prisma.membership.findFirst({
      where: {
        ...actorWhere(principal),
        conversationId,
        status: "active"
      }
    });
  }

  // --- authorization gates --------------------------------------------------

  /** Require an active project membership of at least `minRole`. */
  async requireProjectRole(
    principal: Principal,
    projectId: string,
    minRole: ProjectRole = "viewer"
  ): Promise<Membership> {
    let membership = await this.projectMembership(principal, projectId);
    // The superuser is always owner of any project they touch (self-heals a
    // missing or under-privileged membership).
    if ((!membership || !roleAtLeast(membership.role, minRole)) && this.isSuperuser(principal)) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true }
      });
      if (project) {
        membership = await this.ensureProjectOwnerMembership(principal.userId, projectId);
      }
    }
    if (!membership || !roleAtLeast(membership.role, minRole)) {
      throw forbidden("You do not have access to this project");
    }
    return membership;
  }

  /**
   * Resolve the membership a principal reads a conversation through: a
   * conversation-level membership, or (for users) a project-level membership.
   * Agents must hold an explicit conversation membership.
   */
  async resolveReadMembership(
    principal: Principal,
    conversationId: string
  ): Promise<{ projectId: string; membership: Membership }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, projectId: true }
    });
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const convMembership = await this.conversationMembership(
      principal,
      conversationId
    );
    if (convMembership) {
      return { projectId: conversation.projectId, membership: convMembership };
    }

    if (actorType(principal) === "user") {
      const projectMembership = await this.projectMembership(
        principal,
        conversation.projectId
      );
      if (projectMembership) {
        return { projectId: conversation.projectId, membership: projectMembership };
      }
      if (this.isSuperuser(principal)) {
        const owner = await this.ensureProjectOwnerMembership(
          principal.userId,
          conversation.projectId
        );
        return { projectId: conversation.projectId, membership: owner };
      }
    }

    throw forbidden("You are not a participant of this conversation");
  }

  /**
   * Resolve the membership a principal posts/acts through. Agents must have an
   * active conversation membership; users may post via a project membership of
   * at least `member`.
   */
  async resolveParticipantMembership(
    principal: Principal,
    conversationId: string
  ): Promise<{ projectId: string; membership: Membership }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, projectId: true }
    });
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const convMembership = await this.conversationMembership(
      principal,
      conversationId
    );
    if (convMembership && roleAtLeast(convMembership.role, "viewer")) {
      return { projectId: conversation.projectId, membership: convMembership };
    }

    if (actorType(principal) === "user") {
      const projectMembership = await this.projectMembership(
        principal,
        conversation.projectId
      );
      if (projectMembership && roleAtLeast(projectMembership.role, "member")) {
        return { projectId: conversation.projectId, membership: projectMembership };
      }
      if (this.isSuperuser(principal)) {
        const owner = await this.ensureProjectOwnerMembership(
          principal.userId,
          conversation.projectId
        );
        return { projectId: conversation.projectId, membership: owner };
      }
    }

    throw forbidden(
      actorType(principal) === "agent"
        ? "The agent must join this conversation before participating"
        : "You cannot post in this conversation"
    );
  }

  /** The acting agent's active membership in a conversation (MCP fast path). */
  async requireAgentConversationMembership(
    agentId: string,
    conversationId: string
  ): Promise<Membership> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        agentId,
        conversationId,
        principalType: "agent",
        status: "active"
      }
    });
    if (!membership) {
      throw forbidden("The agent is not an active member of this conversation");
    }
    return membership;
  }

  /** A specific agent's active project-level membership (conversationId null). */
  async agentProjectMembership(
    agentId: string,
    projectId: string
  ): Promise<Membership | null> {
    return this.prisma.membership.findFirst({
      where: {
        agentId,
        projectId,
        conversationId: null,
        principalType: "agent",
        status: "active"
      }
    });
  }

  /**
   * Hierarchy gate: an agent must already be a PROJECT member before it can hold
   * ANY conversation membership in that project. Enforced in code because it's a
   * cross-row rule a DB CHECK constraint can't express.
   */
  async requireAgentProjectMembership(agentId: string, projectId: string): Promise<void> {
    const membership = await this.agentProjectMembership(agentId, projectId);
    if (!membership) {
      throw forbidden(
        "The agent must be a member of the project before it can join a conversation"
      );
    }
  }

  // --- mutations ------------------------------------------------------------

  /** Ensure the user is an active OWNER of the project (idempotent; upgrades). */
  async ensureProjectOwnerMembership(userId: string, projectId: string) {
    const existing = await this.prisma.membership.findFirst({
      where: { userId, projectId, conversationId: null }
    });
    if (existing) {
      if (existing.role !== "owner" || existing.status !== "active") {
        return this.prisma.membership.update({
          where: { id: existing.id },
          data: { role: "owner", status: "active", leftAt: null }
        });
      }
      return existing;
    }
    return this.prisma.membership.create({
      data: {
        principalType: "user",
        userId,
        projectId,
        role: "owner",
        status: "active",
        joinedAt: new Date()
      }
    });
  }

  /** Upsert an agent's conversation membership (used on join accept). */
  async upsertAgentConversationMembership(input: {
    agentId: string;
    projectId: string;
    conversationId: string;
    participantRole: string;
  }) {
    // Project-first hierarchy (also enforced here so the join-accept path can't
    // bypass it).
    await this.requireAgentProjectMembership(input.agentId, input.projectId);

    const existing = await this.prisma.membership.findFirst({
      where: {
        agentId: input.agentId,
        conversationId: input.conversationId,
        principalType: "agent"
      }
    });

    if (existing) {
      return this.prisma.membership.update({
        where: { id: existing.id },
        data: {
          status: "active",
          participantRole: input.participantRole,
          joinedAt: new Date(),
          leftAt: null
        }
      });
    }

    return this.prisma.membership.create({
      data: {
        principalType: "agent",
        agentId: input.agentId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        role: "member",
        participantRole: input.participantRole,
        status: "active",
        joinedAt: new Date()
      }
    });
  }

  async grant(actor: Principal, input: GrantMembershipInput) {
    await this.requireProjectRole(actor, input.projectId, "admin");

    if (input.conversationId) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { projectId: true }
      });
      if (!conversation || conversation.projectId !== input.projectId) {
        throw badRequest("Conversation does not belong to the project");
      }
      // Project-first hierarchy: an agent must be a project member before it can
      // be added to one of the project's conversations. (Users reach a
      // conversation through their project membership, so they're exempt here.)
      if (input.agentId) {
        await this.requireAgentProjectMembership(input.agentId, input.projectId);
      }
    }

    const principalType = input.userId ? "user" : "agent";
    const where: Prisma.MembershipWhereInput = {
      principalType,
      userId: input.userId ?? null,
      agentId: input.agentId ?? null,
      projectId: input.projectId,
      conversationId: input.conversationId ?? null
    };
    const existing = await this.prisma.membership.findFirst({ where });
    if (existing) {
      return this.prisma.membership.update({
        where: { id: existing.id },
        data: { role: input.role, status: "active", leftAt: null }
      });
    }

    return this.prisma.membership.create({
      data: {
        principalType,
        userId: input.userId ?? null,
        agentId: input.agentId ?? null,
        projectId: input.projectId,
        conversationId: input.conversationId ?? null,
        role: input.role,
        status: "active",
        joinedAt: new Date()
      }
    });
  }

  // --- invites (near-term multi-user) ---------------------------------------

  async createInvite(actor: Principal, input: CreateInviteInput) {
    await this.requireProjectRole(actor, input.projectId, "admin");
    const secret = generateSecret(24);
    const invite = await this.prisma.projectInvite.create({
      data: {
        projectId: input.projectId,
        email: input.email ?? null,
        codeHash: secret.hash,
        prefix: secret.prefix,
        role: input.role,
        status: "pending",
        createdById: actor.userId,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86400 * 1000)
      }
    });
    // The code is returned once; share it with the invitee.
    return {
      code: secret.raw,
      invite: {
        id: invite.id,
        projectId: invite.projectId,
        role: invite.role,
        expiresAt: invite.expiresAt
      }
    };
  }

  async acceptInvite(actor: Principal, code: string) {
    const invite = await this.prisma.projectInvite.findUnique({
      where: { codeHash: sha256(code) }
    });
    if (
      !invite ||
      invite.status !== "pending" ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      throw badRequest("Invalid or expired invite");
    }

    const existing = await this.prisma.membership.findFirst({
      where: { userId: actor.userId, projectId: invite.projectId, conversationId: null }
    });
    const membership = existing
      ? await this.prisma.membership.update({
          where: { id: existing.id },
          data: { status: "active", role: invite.role, leftAt: null }
        })
      : await this.prisma.membership.create({
          data: {
            principalType: "user",
            userId: actor.userId,
            projectId: invite.projectId,
            role: invite.role,
            status: "active",
            joinedAt: new Date()
          }
        });

    await this.prisma.projectInvite.update({
      where: { id: invite.id },
      data: { status: "accepted", acceptedById: actor.userId }
    });
    return { membership, projectId: invite.projectId };
  }

  async listProjectMembers(projectId: string) {
    return this.prisma.membership.findMany({
      where: { projectId, conversationId: null, status: { not: "removed" } },
      include: {
        user: { select: { id: true, name: true, email: true, avatarColor: true } },
        agent: {
          select: { id: true, name: true, handle: true, provider: true, ownerId: true }
        }
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
  }

  async listConversationParticipants(conversationId: string) {
    return this.prisma.membership.findMany({
      where: { conversationId, status: "active" },
      include: {
        user: { select: { id: true, name: true, avatarColor: true } },
        agent: {
          select: {
            id: true,
            name: true,
            handle: true,
            provider: true,
            ownerId: true,
            presences: { where: { conversationId } }
          }
        }
      },
      orderBy: [{ createdAt: "asc" }]
    });
  }
}
