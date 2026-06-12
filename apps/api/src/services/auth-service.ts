import type { PrismaClient } from "@prisma/client";
import type { CreateTokenInput, LoginInput, SignupInput } from "@centragent/shared";
import type { AppConfig } from "../config.js";
import type { Principal } from "../auth/principal.js";
import {
  generateSecret,
  generateToken,
  hashPassword,
  sha256,
  verifyPassword
} from "../auth/crypto.js";
import { badRequest, conflict, forbidden, unauthorized } from "../errors.js";

const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899"
];

const DEFAULT_COLOR = "#6366f1";

const colorFor = (seed: string) => {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? DEFAULT_COLOR;
};

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {}

  async ensureLocalOwner() {
    return this.prisma.user.upsert({
      where: { id: this.config.MASTER_USER_ID },
      update: { isLocalOwner: true },
      create: {
        id: this.config.MASTER_USER_ID,
        name: this.config.MASTER_USER_NAME,
        email: null,
        isLocalOwner: true,
        avatarColor: DEFAULT_COLOR
      }
    });
  }

  // No DB hit on the hot path: the row is guaranteed by ensureLocalOwner() at
  // boot, and the id is stable (config.MASTER_USER_ID).
  localOwnerPrincipal(): Principal {
    return {
      userId: this.config.MASTER_USER_ID,
      agentId: null,
      tokenId: null,
      via: "local-owner",
      scopes: [],
      isLocalOwner: true
    };
  }

  // --- accounts -------------------------------------------------------------

  async signup(input: SignupInput) {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw conflict("An account with that email already exists");
    }

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        avatarColor: colorFor(email)
      }
    });

    return { user, session: await this.createSession(user.id) };
  }

  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });
    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthorized("Invalid email or password");
    }
    return { user, session: await this.createSession(user.id) };
  }

  async createSession(userId: string, userAgent?: string) {
    const secret = generateSecret();
    const expiresAt = new Date(
      Date.now() + this.config.SESSION_TTL_HOURS * 3600 * 1000
    );
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: secret.hash,
        userAgent: userAgent ?? null,
        expiresAt
      }
    });
    return { token: secret.raw, expiresAt };
  }

  async resolveSession(rawToken: string): Promise<Principal | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true }
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return {
      userId: session.userId,
      agentId: null,
      tokenId: null,
      via: "session",
      scopes: [],
      isLocalOwner: session.user.isLocalOwner
    };
  }

  async destroySession(rawToken: string) {
    await this.prisma.session
      .deleteMany({ where: { tokenHash: sha256(rawToken) } })
      .catch(() => undefined);
  }

  // --- tokens ---------------------------------------------------------------

  async mintToken(principal: Principal, input: CreateTokenInput) {
    // Tokens are minted by a human acting as themselves (not while impersonating).
    if (principal.agentId) {
      throw forbidden("Exit impersonation before minting a token");
    }

    let agentId: string | null = null;
    if (input.kind === "agent") {
      if (!input.agentId) {
        throw badRequest("An agent token requires agentId");
      }
      // The IFF-you-own rule, enforced at mint time.
      const agent = await this.prisma.agent.findUnique({
        where: { id: input.agentId },
        select: { ownerId: true }
      });
      if (!agent || agent.ownerId !== principal.userId) {
        throw forbidden("You can only mint tokens for agents you own");
      }
      agentId = input.agentId;
    }

    const secret = generateToken(input.kind);
    const record = await this.prisma.apiToken.create({
      data: {
        kind: input.kind,
        tokenHash: secret.hash,
        prefix: secret.prefix,
        userId: principal.userId,
        agentId,
        label: input.label,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86400 * 1000)
          : null
      }
    });

    return { token: secret.raw, record };
  }

  async resolveToken(rawToken: string): Promise<Principal> {
    const token = await this.prisma.apiToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { agent: { select: { ownerId: true } } }
    });

    if (!token || token.revokedAt) {
      throw unauthorized("Invalid or revoked token");
    }
    if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
      throw unauthorized("Token expired");
    }

    // The IFF-you-own rule, re-validated on every request (defense in depth):
    // ownership transfer or a stale token can never grant cross-owner control.
    if (token.agentId) {
      if (!token.agent || token.agent.ownerId !== token.userId) {
        throw forbidden("Token agent is no longer owned by this user");
      }
    }

    // Best-effort last-used stamp; never block the request on it.
    void this.prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      userId: token.userId,
      agentId: token.agentId,
      tokenId: token.id,
      via: "token",
      scopes: token.scopes,
      isLocalOwner: false
    };
  }

  async listTokens(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        prefix: true,
        label: true,
        agentId: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true
      }
    });
  }

  async revokeToken(userId: string, tokenId: string) {
    const result = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (result.count === 0) {
      throw badRequest("Token not found");
    }
    return { revoked: true };
  }
}
