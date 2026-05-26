import Fastify from "fastify";
import type { FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { prisma } from "@centragent/db";
import { AppError } from "./errors.js";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { AgentEventService } from "./services/agent-event-service.js";
import { AgentService } from "./services/agent-service.js";
import { ConversationService } from "./services/conversation-service.js";
import { EmbeddingService } from "./services/embedding-service.js";
import { JoinRequestService } from "./services/join-request-service.js";
import { MessageService } from "./services/message-service.js";
import { QdrantMemoryService } from "./services/qdrant-memory-service.js";
import { RealtimeService } from "./services/realtime-service.js";
import type { Services } from "./types.js";

const logger: FastifyServerOptions["logger"] =
  config.NODE_ENV === "development"
    ? {
        level: "info",
        transport: {
          target: "pino-pretty",
          options: {
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname"
          }
        }
      }
    : { level: "warn" };

const app = Fastify({ logger });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message
      }
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

  const httpError = error as {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };

  if (
    typeof httpError.statusCode === "number" &&
    httpError.statusCode >= 400
  ) {
    return reply.status(httpError.statusCode).send({
      error: {
        code:
          typeof httpError.code === "string"
            ? httpError.code
            : "REQUEST_ERROR",
        message:
          typeof httpError.message === "string"
            ? httpError.message
            : "Request failed"
      }
    });
  }

  app.log.error({ error }, "Unhandled request error");
  return reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error"
    }
  });
});

await prisma.user.upsert({
  where: { id: config.MASTER_USER_ID },
  update: { name: config.MASTER_USER_NAME },
  create: {
    id: config.MASTER_USER_ID,
    name: config.MASTER_USER_NAME,
    email: null
  }
});

await app.register(cors, {
  origin: true
});
await app.register(websocket);

const realtime = new RealtimeService(config, app.log);
await realtime.start();
realtime.registerWebSocket(app);

const embeddings = new EmbeddingService(config, app.log);
const qdrantMemory = new QdrantMemoryService(
  prisma,
  embeddings,
  realtime,
  config,
  app.log
);
const agents = new AgentService(prisma);
const agentEvents = new AgentEventService(prisma, realtime, app.log);
const conversations = new ConversationService(prisma, realtime, config);
const messages = new MessageService(
  prisma,
  realtime,
  qdrantMemory,
  agentEvents,
  config,
  app.log
);
const joinRequests = new JoinRequestService(
  prisma,
  agents,
  realtime,
  app.log
);

const services: Services = {
  prisma,
  log: app.log,
  realtime,
  embeddings,
  qdrantMemory,
  conversations,
  agents,
  agentEvents,
  messages,
  joinRequests
};

await registerRoutes(app, services);

const shutdown = async () => {
  app.log.info("Shutting down Centragent API");
  await realtime.close();
  await prisma.$disconnect();
  await app.close();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

await app.listen({
  host: config.API_HOST,
  port: config.API_PORT
});

app.log.info(
  `Centragent API listening at http://${config.API_HOST}:${config.API_PORT}`
);
