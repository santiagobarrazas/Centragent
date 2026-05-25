import type { PrismaClient } from "@prisma/client";

type FindOrCreateAgentInput = {
  name: string;
  provider: string;
  clientInstanceId?: string | undefined;
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

    return this.prisma.agent.create({
      data: {
        ownerId: null,
        name: input.name,
        provider: input.provider,
        clientInstanceId: input.clientInstanceId ?? null,
        config: {}
      }
    });
  }
}
