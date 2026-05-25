import type { FastifyBaseLogger } from "fastify";
import type { Message, PrismaClient } from "@prisma/client";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v5 as uuidv5 } from "uuid";
import type { SemanticSearchInput } from "@centragent/shared";
import type { AppConfig } from "../config.js";
import type { EmbeddingService } from "./embedding-service.js";
import type { RealtimeService } from "./realtime-service.js";

const POINT_NAMESPACE = "d6d40105-2f29-4a63-bb6e-d3ab0a946a24";

export class QdrantMemoryService {
  private readonly client: QdrantClient;
  private collectionReady = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger
  ) {
    this.client = new QdrantClient({ url: config.QDRANT_URL });
  }

  isConfigured() {
    return this.embeddings.isConfigured();
  }

  async indexMessage(message: Message) {
    const vector = await this.embeddings.embed(message.content);
    if (!vector) {
      return { indexed: false, reason: "embeddings_not_configured" };
    }

    await this.ensureCollection(vector.length);

    const naturalPointId = `message:${message.id}:chunk:0`;
    const pointId = uuidv5(naturalPointId, POINT_NAMESPACE);
    const agentId =
      message.senderType === "agent" ? message.senderId ?? null : null;
    const payload = {
      conversationId: message.conversationId,
      agentId,
      conversationAgentId: message.conversationAgentId,
      messageId: message.id,
      runId: null,
      scopeType: "message",
      scopeId: message.id,
      createdAt: message.createdAt.toISOString(),
      source: "message",
      naturalPointId
    };

    await this.client.upsert(this.config.QDRANT_COLLECTION, {
      points: [
        {
          id: pointId,
          vector,
          payload
        }
      ]
    });

    const memory = await this.prisma.qdrantMemory.upsert({
      where: { pointId },
      update: {
        conversationId: message.conversationId,
        agentId,
        conversationAgentId: message.conversationAgentId,
        messageId: message.id,
        runId: null,
        scopeType: "message",
        scopeId: message.id,
        content: message.content,
        metadata: payload
      },
      create: {
        pointId,
        conversationId: message.conversationId,
        agentId,
        conversationAgentId: message.conversationAgentId,
        messageId: message.id,
        runId: null,
        scopeType: "message",
        scopeId: message.id,
        content: message.content,
        metadata: payload
      }
    });

    await this.realtime.emit(
      "semantic_memory.created",
      memory,
      message.conversationId
    );

    return { indexed: true, pointId };
  }

  async search(input: SemanticSearchInput) {
    const vector = await this.embeddings.embed(input.query);
    if (!vector) {
      return { results: [], embeddingConfigured: false };
    }

    await this.ensureCollection(vector.length);

    const must: Array<Record<string, unknown>> = [
      { key: "conversationId", match: { value: input.conversationId } }
    ];

    if (input.filters?.agentId) {
      must.push({ key: "agentId", match: { value: input.filters.agentId } });
    }

    if (input.filters?.messageId) {
      must.push({
        key: "messageId",
        match: { value: input.filters.messageId }
      });
    }

    if (input.filters?.scopeType) {
      must.push({
        key: "scopeType",
        match: { value: input.filters.scopeType }
      });
    }

    const matches = await this.client.search(this.config.QDRANT_COLLECTION, {
      vector,
      limit: input.limit,
      with_payload: true,
      filter: { must }
    });

    const pointIds = matches.map((match) => String(match.id));
    const mirrors = await this.prisma.qdrantMemory.findMany({
      where: { pointId: { in: pointIds } }
    });
    const mirrorById = new Map(mirrors.map((mirror) => [mirror.pointId, mirror]));

    return {
      embeddingConfigured: true,
      results: matches.map((match) => {
        const pointId = String(match.id);
        const mirror = mirrorById.get(pointId);
        const payload = (match.payload ?? {}) as Record<string, unknown>;

        return {
          pointId,
          score: match.score,
          content: mirror?.content ?? "",
          conversationId: String(payload.conversationId ?? input.conversationId),
          messageId:
            typeof payload.messageId === "string" ? payload.messageId : null,
          agentId: typeof payload.agentId === "string" ? payload.agentId : null,
          conversationAgentId:
            typeof payload.conversationAgentId === "string"
              ? payload.conversationAgentId
              : null,
          metadata: mirror?.metadata ?? payload
        };
      })
    };
  }

  private async ensureCollection(vectorSize: number) {
    if (this.collectionReady) {
      return;
    }

    try {
      await this.client.getCollection(this.config.QDRANT_COLLECTION);
      this.collectionReady = true;
      return;
    } catch {
      this.log.info(
        {
          collection: this.config.QDRANT_COLLECTION,
          vectorSize
        },
        "Creating Qdrant memory collection"
      );
    }

    await this.client.createCollection(this.config.QDRANT_COLLECTION, {
      vectors: {
        size: vectorSize,
        distance: "Cosine"
      }
    });
    this.collectionReady = true;
  }
}
