import type { FastifyBaseLogger } from "fastify";
import type { Document, Message, PrismaClient } from "@prisma/client";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v5 as uuidv5 } from "uuid";
import type { MemoryScopeType, Visibility } from "@centragent/shared";
import type { AppConfig } from "../config.js";
import type { EmbeddingService } from "./embedding-service.js";
import type { RealtimeService } from "./realtime-service.js";

const POINT_NAMESPACE = "d6d40105-2f29-4a63-bb6e-d3ab0a946a24";

type SearchParams = {
  query: string;
  projectId?: string | undefined;
  conversationId?: string | undefined;
  scopeType?: MemoryScopeType | undefined;
  limit: number;
  // The acting agent, when impersonating. Gates access to private notes.
  callingAgentId: string | null;
};

type IndexDescriptor = {
  scopeType: MemoryScopeType;
  kind: string;
  visibility: Visibility;
  ownerAgentId: string | null;
};

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

  async indexMessage(
    message: Pick<
      Message,
      "id" | "conversationId" | "senderAgentId" | "membershipId" | "content" | "createdAt"
    >,
    projectId: string
  ) {
    return this.upsert({
      naturalKey: `message:${message.id}:chunk:0`,
      content: message.content,
      projectId,
      conversationId: message.conversationId,
      agentId: message.senderAgentId,
      membershipId: message.membershipId,
      messageId: message.id,
      documentId: null,
      createdAt: message.createdAt,
      descriptor: {
        scopeType: "message",
        kind: "episodic",
        visibility: "shared",
        ownerAgentId: null
      }
    });
  }

  async indexDocument(document: Document) {
    const descriptor = this.descriptorForDocument(document);
    if (!descriptor || !document.currentContent.trim()) {
      return { indexed: false, reason: "not_indexable" };
    }
    const result = await this.upsert({
      naturalKey: `document:${document.id}`,
      content: document.currentContent,
      projectId: document.projectId,
      conversationId: document.conversationId,
      agentId: document.agentId,
      membershipId: null,
      messageId: null,
      documentId: document.id,
      createdAt: document.updatedAt,
      descriptor
    });
    if (result.indexed && result.pointId && document.pointId !== result.pointId) {
      await this.prisma.document
        .update({ where: { id: document.id }, data: { pointId: result.pointId } })
        .catch(() => undefined);
    }
    return result;
  }

  private descriptorForDocument(document: Document): IndexDescriptor | null {
    switch (document.kind) {
      case "agent_notes":
        return document.agentId
          ? {
              scopeType: "agent_note",
              kind: "note",
              visibility: "private",
              ownerAgentId: document.agentId
            }
          : null;
      case "conversation_summary":
        return {
          scopeType: "conversation_summary",
          kind: "summary",
          visibility: "shared",
          ownerAgentId: null
        };
      case "project_overview":
      case "project_asset":
        return {
          scopeType: "project_asset",
          kind: "summary",
          visibility: "shared",
          ownerAgentId: null
        };
      default:
        return null; // agent_profile not indexed for now
    }
  }

  private async upsert(input: {
    naturalKey: string;
    content: string;
    projectId: string | null;
    conversationId: string | null;
    agentId: string | null;
    membershipId: string | null;
    messageId: string | null;
    documentId: string | null;
    createdAt: Date;
    descriptor: IndexDescriptor;
  }) {
    const vector = await this.embeddings.embed(input.content, { purpose: "document" });
    if (!vector) {
      return { indexed: false, reason: "embeddings_not_configured" as const };
    }
    await this.ensureCollection(vector.length);

    const pointId = uuidv5(input.naturalKey, POINT_NAMESPACE);
    const { descriptor } = input;
    const payload = {
      projectId: input.projectId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      membershipId: input.membershipId,
      messageId: input.messageId,
      documentId: input.documentId,
      scopeType: descriptor.scopeType,
      kind: descriptor.kind,
      visibility: descriptor.visibility,
      ownerAgentId: descriptor.ownerAgentId,
      createdAt: input.createdAt.toISOString(),
      createdAtEpoch: Math.floor(input.createdAt.getTime() / 1000),
      naturalKey: input.naturalKey
    };

    await this.client.upsert(this.config.QDRANT_COLLECTION, {
      points: [{ id: pointId, vector, payload }]
    });

    await this.prisma.qdrantMemory.upsert({
      where: { pointId },
      update: {
        projectId: input.projectId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        membershipId: input.membershipId,
        messageId: input.messageId,
        documentId: input.documentId,
        scopeType: descriptor.scopeType,
        scopeId: input.messageId ?? input.documentId,
        kind: descriptor.kind,
        visibility: descriptor.visibility,
        ownerAgentId: descriptor.ownerAgentId,
        content: input.content,
        metadata: payload
      },
      create: {
        pointId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        membershipId: input.membershipId,
        messageId: input.messageId,
        documentId: input.documentId,
        scopeType: descriptor.scopeType,
        scopeId: input.messageId ?? input.documentId,
        kind: descriptor.kind,
        visibility: descriptor.visibility,
        ownerAgentId: descriptor.ownerAgentId,
        content: input.content,
        metadata: payload
      }
    });

    await this.realtime.emit(
      "memory.indexed",
      { pointId, scopeType: descriptor.scopeType },
      input.conversationId ?? undefined
    );
    return { indexed: true as const, pointId };
  }

  async search(params: SearchParams) {
    const vector = await this.embeddings.embed(params.query, { purpose: "query" });
    if (!vector) {
      return { results: [], embeddingConfigured: false };
    }
    await this.ensureCollection(vector.length);

    // Mandatory server-side tenant scope — NEVER taken from agent free input.
    const must: Array<Record<string, unknown>> = [];
    if (params.conversationId) {
      must.push({ key: "conversationId", match: { value: params.conversationId } });
    } else if (params.projectId) {
      must.push({ key: "projectId", match: { value: params.projectId } });
    }
    if (params.scopeType) {
      must.push({ key: "scopeType", match: { value: params.scopeType } });
    }

    // Visibility rule: shared points always; private points only the caller's own.
    if (params.callingAgentId) {
      must.push({
        should: [
          { key: "visibility", match: { value: "shared" } },
          {
            must: [
              { key: "visibility", match: { value: "private" } },
              { key: "ownerAgentId", match: { value: params.callingAgentId } }
            ]
          }
        ]
      });
    } else {
      must.push({ key: "visibility", match: { value: "shared" } });
    }

    const matches = await this.client.search(this.config.QDRANT_COLLECTION, {
      vector,
      limit: params.limit,
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
          scopeType: mirror?.scopeType ?? String(payload.scopeType ?? ""),
          conversationId: mirror?.conversationId ?? null,
          projectId: mirror?.projectId ?? null,
          agentId: mirror?.agentId ?? null,
          messageId: mirror?.messageId ?? null,
          documentId: mirror?.documentId ?? null
        };
      })
    };
  }

  private async ensureCollection(vectorSize: number) {
    if (this.collectionReady) {
      return;
    }
    try {
      const existing = await this.client.getCollection(this.config.QDRANT_COLLECTION);
      const params = existing.config?.params?.vectors;
      const existingSize =
        typeof params === "object" && params && "size" in params
          ? Number((params as { size: number }).size)
          : undefined;
      if (existingSize && existingSize !== vectorSize) {
        throw new Error(
          `Qdrant collection "${this.config.QDRANT_COLLECTION}" has vector size ${existingSize} but the current embedding model produces ${vectorSize}. Use a new QDRANT_COLLECTION or recreate it.`
        );
      }
      this.collectionReady = true;
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes("vector size")) {
        throw error;
      }
      this.log.info(
        { collection: this.config.QDRANT_COLLECTION, vectorSize },
        "Creating Qdrant memory collection"
      );
    }

    await this.client.createCollection(this.config.QDRANT_COLLECTION, {
      vectors: { size: vectorSize, distance: "Cosine" }
    });
    // Payload indexes for tenant-scoped filtering at scale.
    for (const field of [
      "projectId",
      "conversationId",
      "agentId",
      "scopeType",
      "visibility",
      "ownerAgentId"
    ]) {
      await this.client
        .createPayloadIndex(this.config.QDRANT_COLLECTION, {
          field_name: field,
          field_schema: "keyword"
        })
        .catch(() => undefined);
    }
    this.collectionReady = true;
  }
}
