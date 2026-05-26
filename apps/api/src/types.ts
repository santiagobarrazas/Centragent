import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { AgentService } from "./services/agent-service.js";
import type { AgentEventService } from "./services/agent-event-service.js";
import type { ConversationService } from "./services/conversation-service.js";
import type { EmbeddingService } from "./services/embedding-service.js";
import type { JoinRequestService } from "./services/join-request-service.js";
import type { MessageService } from "./services/message-service.js";
import type { QdrantMemoryService } from "./services/qdrant-memory-service.js";
import type { RealtimeService } from "./services/realtime-service.js";

export type Services = {
  prisma: PrismaClient;
  log: FastifyBaseLogger;
  realtime: RealtimeService;
  embeddings: EmbeddingService;
  qdrantMemory: QdrantMemoryService;
  conversations: ConversationService;
  agents: AgentService;
  agentEvents: AgentEventService;
  messages: MessageService;
  joinRequests: JoinRequestService;
};
