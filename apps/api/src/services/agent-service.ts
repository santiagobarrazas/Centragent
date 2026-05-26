import type { PrismaClient } from "@prisma/client";

type FindOrCreateAgentInput = {
  name: string;
  agentHandle?: string | undefined;
  provider: string;
  clientInstanceId?: string | undefined;
};

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
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreateAgent(input: FindOrCreateAgentInput) {
    const existing = await this.prisma.agent.findFirst({
      where: {
        name: input.name,
        provider: input.provider,
        clientInstanceId: input.clientInstanceId ?? null
      }
    });

    if (existing) {
      return existing;
    }

    const handle = await this.uniqueHandle(
      input.agentHandle ?? handleFromName(input.name)
    );

    return this.prisma.agent.create({
      data: {
        ownerId: null,
        name: input.name,
        handle,
        provider: input.provider,
        clientInstanceId: input.clientInstanceId ?? null,
        config: {},
        lastSeenAt: new Date()
      }
    });
  }

  async listConversationAgents(conversationId: string) {
    const memberships = await this.prisma.conversationAgent.findMany({
      where: { conversationId },
      include: {
        agent: {
          include: {
            presence: true
          }
        },
        _count: {
          select: {
            eventDeliveries: {
              where: {
                status: { in: ["pending", "delivered"] }
              }
            }
          }
        }
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }]
    });

    return memberships.map((membership) => ({
      ...membership,
      pendingEventCount: membership._count.eventDeliveries
    }));
  }

  private async uniqueHandle(baseHandle: string) {
    const base = handleFromName(baseHandle);

    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}-${index + 1}`;
      const existing = await this.prisma.agent.findUnique({
        where: { handle: candidate }
      });

      if (!existing) {
        return candidate;
      }
    }

    return `${base}-${Date.now().toString(36)}`;
  }
}
