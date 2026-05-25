import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createConversationSchema,
  createUserMessageSchema,
  listConversationsSchema,
  messagePaginationQuerySchema,
  readConversationSchema,
  rejectJoinRequestSchema,
  requestJoinConversationSchema,
  semanticSearchSchema,
  sendAgentMessageSchema
} from "@centragent/shared";
import { forbidden } from "./errors.js";
import type { Services } from "./types.js";

const conversationParamsSchema = z.object({
  conversationId: z.string().uuid()
});

const joinRequestParamsSchema = z.object({
  joinRequestId: z.string().uuid()
});

const joinRequestsQuerySchema = z.object({
  status: z.string().optional()
});

const parse = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown
): z.infer<TSchema> => schema.parse(value);

const controllerForRequest = (request: FastifyRequest) => {
  const controller = new AbortController();
  let complete = false;

  request.raw.on("close", () => {
    if (!complete) {
      controller.abort();
    }
  });

  return {
    signal: controller.signal,
    complete: () => {
      complete = true;
    }
  };
};

export async function registerRoutes(app: FastifyInstance, services: Services) {
  app.get("/health", async () => ({
    ok: true,
    service: "centragent-api",
    time: new Date().toISOString(),
    embeddingsConfigured: services.embeddings.isConfigured()
  }));

  app.get("/conversations", async (request) => {
    const query = parse(listConversationsSchema, request.query);
    return services.conversations.list(query.limit, query.cursor);
  });

  app.post("/conversations", async (request, reply) => {
    const body = parse(createConversationSchema, request.body);
    const conversation = await services.conversations.create(body.title);
    return reply.code(201).send({ conversation });
  });

  app.get("/conversations/:conversationId", async (request) => {
    const params = parse(conversationParamsSchema, request.params);
    const conversation = await services.conversations.get(params.conversationId);
    return { conversation };
  });

  app.get("/conversations/:conversationId/messages", async (request) => {
    const params = parse(conversationParamsSchema, request.params);
    const query = parse(messagePaginationQuerySchema, request.query);
    return services.messages.listMessages({
      conversationId: params.conversationId,
      limit: query.limit,
      cursor: query.cursor,
      direction: query.direction
    });
  });

  app.post("/conversations/:conversationId/messages", async (request, reply) => {
    const params = parse(conversationParamsSchema, request.params);
    const body = parse(createUserMessageSchema, request.body);
    const message = await services.messages.createUserMessage(
      params.conversationId,
      body.content,
      body.metadata
    );
    return reply.code(201).send({ message });
  });

  app.get("/conversations/:conversationId/agents", async (request) => {
    const params = parse(conversationParamsSchema, request.params);
    const agents = await services.prisma.conversationAgent.findMany({
      where: { conversationId: params.conversationId },
      include: { agent: true },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }]
    });
    return { agents };
  });

  app.post("/conversations/:conversationId/semantic-search", async (request) => {
    const params = parse(conversationParamsSchema, request.params);
    const body = parse(
      semanticSearchSchema.omit({ conversationAgentId: true }).extend({
        conversationId: z.string().uuid().optional()
      }),
      {
        ...(request.body as Record<string, unknown> | undefined),
        conversationId: params.conversationId
      }
    );

    return services.qdrantMemory.search({
      ...body,
      conversationId: params.conversationId
    });
  });

  app.get("/join-requests", async (request) => {
    const query = parse(joinRequestsQuerySchema, request.query);
    return services.joinRequests.list(query.status);
  });

  app.post("/join-requests/:joinRequestId/accept", async (request) => {
    const params = parse(joinRequestParamsSchema, request.params);
    return services.joinRequests.accept(params.joinRequestId);
  });

  app.post("/join-requests/:joinRequestId/reject", async (request) => {
    const params = parse(joinRequestParamsSchema, request.params);
    const body = parse(rejectJoinRequestSchema, request.body ?? {});
    return services.joinRequests.reject(params.joinRequestId, body.reason);
  });

  app.get("/internal/mcp/conversations", async (request) => {
    const query = parse(listConversationsSchema, request.query);
    return services.conversations.list(query.limit, query.cursor);
  });

  app.get("/internal/mcp/conversations/:conversationId", async (request) => {
    const params = parse(conversationParamsSchema, request.params);
    const query = parse(
      readConversationSchema.omit({ conversationId: true }),
      request.query
    );

    if (!query.conversationAgentId) {
      throw forbidden("MCP reads require an active conversationAgentId");
    }

    await services.messages.requireActiveConversationAgent(
      params.conversationId,
      query.conversationAgentId
    );

    const conversation = await services.conversations.get(params.conversationId);
    const page = await services.messages.listMessages({
      conversationId: params.conversationId,
      limit: query.limit,
      cursor: query.cursor,
      direction: query.direction
    });

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title
      },
      ...page
    };
  });

  app.post("/internal/mcp/join-requests", async (request, reply) => {
    const body = parse(requestJoinConversationSchema, request.body);
    const lifecycle = controllerForRequest(request);

    try {
      const result = await services.joinRequests.createAndWait(
        body,
        lifecycle.signal
      );
      lifecycle.complete();
      return reply.send(result);
    } catch (error) {
      lifecycle.complete();
      throw error;
    }
  });

  app.post("/internal/mcp/messages", async (request, reply) => {
    const body = parse(sendAgentMessageSchema, request.body);
    const message = await services.messages.createAgentMessage(body);
    return reply.code(201).send({
      messageId: message.id,
      sequenceNumber: message.sequenceNumber,
      createdAt: message.createdAt
    });
  });

  app.post(
    "/internal/mcp/conversations/:conversationId/semantic-search",
    async (request) => {
      const params = parse(conversationParamsSchema, request.params);
      const body = parse(semanticSearchSchema, {
        ...(request.body as Record<string, unknown> | undefined),
        conversationId: params.conversationId
      });

      if (!body.conversationAgentId) {
        throw forbidden("MCP semantic search requires an active conversationAgentId");
      }

      await services.messages.requireActiveConversationAgent(
        params.conversationId,
        body.conversationAgentId
      );

      return services.qdrantMemory.search(body);
    }
  );
}
