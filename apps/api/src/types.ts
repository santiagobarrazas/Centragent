import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { Principal } from "./auth/principal.js";
import type { AgentService } from "./services/agent-service.js";
import type { AgentEventService } from "./services/agent-event-service.js";
import type { AgentRunService } from "./services/agent-run-service.js";
import type { AutonomyGuard } from "./services/autonomy-guard.js";
import type { AuthService } from "./services/auth-service.js";
import type { ConversationService } from "./services/conversation-service.js";
import type { DocumentService } from "./services/document-service.js";
import type { EmbeddingService } from "./services/embedding-service.js";
import type { JoinRequestService } from "./services/join-request-service.js";
import type { MembershipService } from "./services/membership-service.js";
import type { MessageService } from "./services/message-service.js";
import type { ProjectService } from "./services/project-service.js";
import type { QdrantMemoryService } from "./services/qdrant-memory-service.js";
import type { RealtimeService } from "./services/realtime-service.js";

export type Services = {
  prisma: PrismaClient;
  log: FastifyBaseLogger;
  config: AppConfig;
  realtime: RealtimeService;
  embeddings: EmbeddingService;
  qdrantMemory: QdrantMemoryService;
  auth: AuthService;
  memberships: MembershipService;
  projects: ProjectService;
  documents: DocumentService;
  conversations: ConversationService;
  agents: AgentService;
  agentEvents: AgentEventService;
  agentRuns: AgentRunService;
  autonomyGuard: AutonomyGuard;
  messages: MessageService;
  joinRequests: JoinRequestService;
};

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}
