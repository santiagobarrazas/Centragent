import Fastify from "fastify";
import type { FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { prisma } from "@centragent/db";
import { AppError } from "./errors.js";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { createAuthPreHandler } from "./middleware/auth.js";
import { AgentEventService } from "./services/agent-event-service.js";
import { AgentRunService } from "./services/agent-run-service.js";
import { AgentService } from "./services/agent-service.js";
import { AutonomyGuard } from "./services/autonomy-guard.js";
import { AuthService } from "./services/auth-service.js";
import { ConversationService } from "./services/conversation-service.js";
import { DocumentService } from "./services/document-service.js";
import { EmbeddingService } from "./services/embedding-service.js";
import { JoinRequestService } from "./services/join-request-service.js";
import { MembershipService } from "./services/membership-service.js";
import { MessageService } from "./services/message-service.js";
import { ProjectService } from "./services/project-service.js";
import { QdrantMemoryService } from "./services/qdrant-memory-service.js";
import { RealtimeService } from "./services/realtime-service.js";
import type { Services } from "./types.js";

const logger: FastifyServerOptions["logger"] =
  config.NODE_ENV === "development"
    ? {
        level: "info",
        transport: {
          target: "pino-pretty",
          options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" }
        }
      }
    : { level: "warn" };

const app = Fastify({ logger });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    if (error.statusCode === 401) {
      reply.header("WWW-Authenticate", 'Bearer realm="centragent"');
    }
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message }
    });
  }

  if (typeof error === "object" && error && "issues" in error) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        issues: (error as { issues: unknown }).issues
      }
    });
  }

  // Prisma unique-constraint races (e.g. concurrent membership creation) are a
  // conflict, not a server error.
  if ((error as { code?: unknown }).code === "P2002") {
    return reply.status(409).send({
      error: { code: "CONFLICT", message: "That resource already exists" }
    });
  }

  const httpError = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  if (typeof httpError.statusCode === "number" && httpError.statusCode >= 400) {
    return reply.status(httpError.statusCode).send({
      error: {
        code: typeof httpError.code === "string" ? httpError.code : "REQUEST_ERROR",
        message: typeof httpError.message === "string" ? httpError.message : "Request failed"
      }
    });
  }

  app.log.error({ error }, "Unhandled request error");
  return reply.status(500).send({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" }
  });
});

await app.register(cors, {
  origin: config.API_CORS_ORIGINS,
  credentials: true
});
await app.register(cookie);
await app.register(websocket);

// --- services (dependency order) --------------------------------------------

const auth = new AuthService(prisma, config);
const memberships = new MembershipService(prisma);
const realtime = new RealtimeService(config, app.log);
await realtime.start();
const embeddings = new EmbeddingService(config, app.log);
const qdrantMemory = new QdrantMemoryService(prisma, embeddings, realtime, config, app.log);
const documents = new DocumentService(prisma, memberships, qdrantMemory, realtime);
const projects = new ProjectService(prisma, memberships, documents, realtime);
const agents = new AgentService(prisma, memberships, projects, documents, realtime);
const conversations = new ConversationService(prisma, memberships, documents, realtime);
const autonomyGuard = new AutonomyGuard(prisma, realtime, config, app.log);
const agentEvents = new AgentEventService(
  prisma,
  memberships,
  realtime,
  autonomyGuard,
  app.log
);
const agentRuns = new AgentRunService(prisma, memberships, realtime);
const messages = new MessageService(
  prisma,
  memberships,
  realtime,
  qdrantMemory,
  agentEvents,
  agentRuns,
  app.log
);
const joinRequests = new JoinRequestService(prisma, memberships, realtime, app.log);

const services: Services = {
  prisma,
  log: app.log,
  config,
  realtime,
  embeddings,
  qdrantMemory,
  auth,
  memberships,
  projects,
  documents,
  conversations,
  agents,
  agentEvents,
  agentRuns,
  autonomyGuard,
  messages,
  joinRequests
};

// --- bootstrap --------------------------------------------------------------

const owner = await auth.ensureLocalOwner();
await projects.ensureDefaultProject(owner.id);

// --- auth + routes + realtime ----------------------------------------------

app.addHook("preHandler", createAuthPreHandler(auth, config));
realtime.registerWebSocket(app, memberships);
await registerRoutes(app, services);

const shutdown = async () => {
  app.log.info("Shutting down Centragent API");
  await realtime.close();
  await prisma.$disconnect();
  await app.close();
};

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
app.log.info(`Centragent API listening at http://${config.API_HOST}:${config.API_PORT}`);
