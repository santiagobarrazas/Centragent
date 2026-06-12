import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  acceptInviteSchema,
  ackAgentEventsSchema,
  adminAutonomySchema,
  agentPresenceSchema,
  createAgentRunSchema,
  createAgentSchema,
  createAssetSchema,
  createConversationSchema,
  createInviteSchema,
  createProjectSchema,
  createTokenSchema,
  createUserMessageSchema,
  documentRefSchema,
  finishAgentActivitySchema,
  grantMembershipSchema,
  listConversationsSchema,
  listProjectsSchema,
  loginSchema,
  messagePaginationQuerySchema,
  noteAppendSchema,
  patchAgentRunSchema,
  readConversationSchema,
  rejectJoinRequestSchema,
  reportUsageSchema,
  requestJoinConversationSchema,
  searchMemorySchema,
  sendAgentMessageSchema,
  SESSION_COOKIE,
  signupSchema,
  startAgentActivitySchema,
  syncAgentInboxSchema,
  updateAgentSchema,
  updateConversationAutonomySchema,
  updateDocumentSchema,
  waitForAgentEventsSchema
} from "@centragent/shared";
import { badRequest } from "./errors.js";
import { requirePrincipal, requireUserPrincipal } from "./middleware/auth.js";
import { actorType } from "./auth/principal.js";
import type { Services } from "./types.js";

function idParam<K extends string>(key: K) {
  return z.object({ [key]: z.string().uuid() }) as unknown as z.ZodType<
    Record<K, string>
  >;
}

const parse = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> =>
  schema.parse(value);

// Bridges request lifecycle to an AbortSignal for blocking endpoints.
const controllerForRequest = (request: FastifyRequest) => {
  const controller = new AbortController();
  let complete = false;
  request.raw.on("aborted", () => {
    if (!complete) controller.abort();
  });
  return { signal: controller.signal, complete: () => (complete = true) };
};

export async function registerRoutes(app: FastifyInstance, services: Services) {
  const setSession = (reply: FastifyReply, token: string, expiresAt: Date) => {
    const sameSite = services.config.COOKIE_SAMESITE;
    // SameSite=None mandates Secure; otherwise honour COOKIE_SECURE or prod.
    const secure =
      services.config.COOKIE_SECURE ??
      (sameSite === "none" || services.config.NODE_ENV === "production");
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite,
      path: "/",
      expires: expiresAt,
      secure
    });
  };

  // --- health & auth --------------------------------------------------------

  app.get("/health", async () => ({
    ok: true,
    service: "centragent-api",
    time: new Date().toISOString(),
    embeddingsConfigured: services.embeddings.isConfigured()
  }));

  app.post("/auth/signup", async (request, reply) => {
    const body = parse(signupSchema, request.body);
    const { user, session } = await services.auth.signup(body);
    setSession(reply, session.token, session.expiresAt);
    return reply.code(201).send({ user: { id: user.id, name: user.name, email: user.email } });
  });

  app.post("/auth/login", async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const { user, session } = await services.auth.login(body);
    setSession(reply, session.token, session.expiresAt);
    return { user: { id: user.id, name: user.name, email: user.email } };
  });

  app.post("/auth/logout", async (request, reply) => {
    const cookie = request.cookies?.[SESSION_COOKIE];
    if (cookie) await services.auth.destroySession(cookie);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (request) => {
    const principal = requirePrincipal(request);
    return services.agents.whoami(principal);
  });

  // --- tokens ---------------------------------------------------------------

  app.get("/tokens", async (request) => {
    const principal = requireUserPrincipal(request);
    return { tokens: await services.auth.listTokens(principal.userId) };
  });

  app.post("/tokens", async (request, reply) => {
    const principal = requireUserPrincipal(request);
    const body = parse(createTokenSchema, request.body);
    const { token, record } = await services.auth.mintToken(principal, body);
    // The raw token is returned exactly once.
    return reply.code(201).send({
      token,
      tokenInfo: {
        id: record.id,
        kind: record.kind,
        prefix: record.prefix,
        label: record.label,
        agentId: record.agentId,
        lastUsedAt: record.lastUsedAt,
        createdAt: record.createdAt
      }
    });
  });

  app.delete("/tokens/:tokenId", async (request) => {
    const principal = requireUserPrincipal(request);
    const params = parse(idParam("tokenId"), request.params);
    return services.auth.revokeToken(principal.userId, params.tokenId);
  });

  // --- projects -------------------------------------------------------------

  app.get("/projects", async (request) => {
    const principal = requirePrincipal(request);
    const query = parse(listProjectsSchema, request.query);
    return services.projects.list(principal, query.limit, query.cursor);
  });

  app.post("/projects", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(createProjectSchema, request.body);
    const project = await services.projects.create(principal, body);
    return reply.code(201).send({ project });
  });

  app.get("/projects/:projectId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("projectId"), request.params);
    return { project: await services.projects.get(principal, params.projectId) };
  });

  app.get("/projects/:projectId/members", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("projectId"), request.params);
    await services.memberships.requireProjectRole(principal, params.projectId, "viewer");
    return { members: await services.memberships.listProjectMembers(params.projectId) };
  });

  app.post("/projects/:projectId/members", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("projectId"), request.params);
    const body = parse(grantMembershipSchema, {
      ...(request.body as object),
      projectId: params.projectId
    });
    return { membership: await services.memberships.grant(principal, body) };
  });

  app.get("/projects/:projectId/conversations", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("projectId"), request.params);
    const query = parse(listConversationsSchema.omit({ projectId: true }), request.query);
    return services.conversations.list(principal, {
      projectId: params.projectId,
      limit: query.limit,
      cursor: query.cursor
    });
  });

  app.get("/projects/:projectId/assets", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("projectId"), request.params);
    return { assets: await services.documents.listProjectAssets(principal, params.projectId) };
  });

  app.post("/projects/:projectId/assets", async (request, reply) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("projectId"), request.params);
    const body = parse(createAssetSchema, {
      ...(request.body as object),
      projectId: params.projectId
    });
    await services.memberships.requireProjectRole(principal, params.projectId, "member");
    const document = await services.documents.create({
      kind: "project_asset",
      title: body.title,
      projectId: params.projectId,
      slug: body.slug ?? null,
      content: body.content,
      author: principal
    });
    return reply.code(201).send({ document });
  });

  // --- invites --------------------------------------------------------------

  app.post("/invites", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(createInviteSchema, request.body);
    const invite = await services.memberships.createInvite(principal, body);
    return reply.code(201).send(invite);
  });

  app.post("/invites/accept", async (request) => {
    const principal = requireUserPrincipal(request);
    const body = parse(acceptInviteSchema, request.body);
    return services.memberships.acceptInvite(principal, body.code);
  });

  // --- conversations --------------------------------------------------------

  app.post("/conversations", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(createConversationSchema, request.body);
    const conversation = await services.conversations.create(principal, body);
    return reply.code(201).send({ conversation });
  });

  app.get("/conversations", async (request) => {
    const principal = requirePrincipal(request);
    const query = parse(listConversationsSchema, request.query);
    return services.conversations.list(principal, query);
  });

  app.get("/conversations/:conversationId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    return { conversation: await services.conversations.get(principal, params.conversationId) };
  });

  app.get("/conversations/:conversationId/messages", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    const query = parse(messagePaginationQuerySchema, request.query);
    return services.messages.list(principal, params.conversationId, query);
  });

  app.post("/conversations/:conversationId/messages", async (request, reply) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    const body = parse(createUserMessageSchema, request.body);
    const message = await services.messages.post(
      principal,
      params.conversationId,
      body.content,
      body.metadata
    );
    return reply.code(201).send({ message });
  });

  app.get("/conversations/:conversationId/participants", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    await services.memberships.resolveReadMembership(principal, params.conversationId);
    return {
      participants: await services.memberships.listConversationParticipants(
        params.conversationId
      )
    };
  });

  app.post("/conversations/:conversationId/search", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    const body = parse(searchMemorySchema.omit({ conversationId: true }), request.body);
    await services.memberships.resolveReadMembership(principal, params.conversationId);
    return services.qdrantMemory.search({
      query: body.query,
      conversationId: params.conversationId,
      scopeType: body.scopeType,
      limit: body.limit,
      callingAgentId: principal.agentId
    });
  });

  app.post("/search", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(searchMemorySchema, request.body);
    if (body.conversationId) {
      await services.memberships.resolveReadMembership(principal, body.conversationId);
    } else if (body.projectId) {
      await services.memberships.requireProjectRole(principal, body.projectId, "viewer");
    } else {
      throw badRequest("Provide projectId or conversationId to search");
    }
    return services.qdrantMemory.search({
      query: body.query,
      projectId: body.projectId,
      conversationId: body.conversationId,
      scopeType: body.scopeType,
      limit: body.limit,
      callingAgentId: principal.agentId
    });
  });

  // --- agents ---------------------------------------------------------------

  app.get("/agents", async (request) => {
    const principal = requirePrincipal(request);
    return { agents: await services.agents.listMine(principal) };
  });

  app.post("/agents", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(createAgentSchema, request.body);
    const agent = await services.agents.create(principal, body);
    return reply.code(201).send({ agent });
  });

  app.get("/agents/:agentId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("agentId"), request.params);
    return { agent: await services.agents.get(principal, params.agentId) };
  });

  app.patch("/agents/:agentId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("agentId"), request.params);
    const body = parse(updateAgentSchema, request.body);
    return { agent: await services.agents.update(principal, params.agentId, body) };
  });

  // --- documents ------------------------------------------------------------

  app.get("/documents/:documentId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("documentId"), request.params);
    return { document: await services.documents.read(principal, { documentId: params.documentId }) };
  });

  app.post("/documents/read", async (request) => {
    const principal = requirePrincipal(request);
    const ref = parse(documentRefSchema, request.body);
    return { document: await services.documents.read(principal, ref) };
  });

  app.put("/documents/:documentId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("documentId"), request.params);
    const body = parse(updateDocumentSchema, request.body);
    return {
      document: await services.documents.update(
        principal,
        params.documentId,
        body.content,
        body.changeSummary
      )
    };
  });

  app.get("/documents/:documentId/versions", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("documentId"), request.params);
    return { versions: await services.documents.versions(principal, params.documentId) };
  });

  app.post("/notes/append", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(noteAppendSchema, request.body);
    const agentId = body.agentId ?? principal.agentId;
    if (!agentId) {
      throw badRequest("Provide agentId or call with an agent token");
    }
    const doc = await services.documents.read(principal, { kind: "agent_notes", agentId });
    const block = `${body.heading ? `## ${body.heading}\n` : ""}${body.content}\n`;
    const next = doc.currentContent.trim()
      ? `${doc.currentContent.trimEnd()}\n\n${block}`
      : block;
    return {
      document: await services.documents.update(principal, doc.id, next, "note appended")
    };
  });

  // --- agents (MCP identity helpers) ----------------------------------------

  app.get("/whoami", async (request) => {
    const principal = requirePrincipal(request);
    return services.agents.whoami(principal);
  });

  // --- presence / activity / inbox (agent token) ----------------------------

  app.post("/agent/presence", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(agentPresenceSchema, request.body);
    return services.agentEvents.setPresence(principal, body);
  });

  app.post("/agent/activities/start", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(startAgentActivitySchema, request.body);
    return services.agentEvents.startActivity(principal, body);
  });

  app.post("/agent/activities/finish", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(finishAgentActivitySchema, request.body);
    return services.agentEvents.finishActivity(principal, body);
  });

  app.post("/agent/inbox/sync", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(syncAgentInboxSchema, request.body);
    return services.agentEvents.syncInbox(principal, body);
  });

  app.post("/agent/inbox/ack", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(ackAgentEventsSchema, request.body);
    return services.agentEvents.ackEvents(principal, body.deliveryIds);
  });

  app.post("/agent/inbox/wait", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(waitForAgentEventsSchema, request.body);
    const lifecycle = controllerForRequest(request);
    try {
      const result = await services.agentEvents.waitForEvents(principal, body, lifecycle.signal);
      lifecycle.complete();
      return reply.send(result);
    } catch (error) {
      lifecycle.complete();
      throw error;
    }
  });

  // --- autonomy runtime (runner) --------------------------------------------

  app.post("/agent/runs", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(createAgentRunSchema, request.body);
    const result = await services.agentRuns.create(principal, body);
    return reply.code(201).send(result);
  });

  app.patch("/agent/runs/:runId", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("runId"), request.params);
    const body = parse(patchAgentRunSchema, request.body);
    return services.agentRuns.patch(principal, params.runId, body);
  });

  app.get("/conversations/:conversationId/runs", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    return services.agentRuns.list(principal, params.conversationId);
  });

  app.post("/agent/usage", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(reportUsageSchema, request.body);
    if (actorType(principal) !== "agent" || !principal.agentId) {
      throw badRequest("Usage reporting requires an agent token");
    }
    return services.autonomyGuard.recordUsage({
      conversationId: body.conversationId,
      agentId: principal.agentId,
      runId: body.runId ?? null,
      deliveryId: body.deliveryId ?? null,
      model: body.model,
      promptTokens: body.promptTokens,
      completionTokens: body.completionTokens
    });
  });

  // --- autonomy controls (humans) -------------------------------------------

  app.get("/admin/autonomy", async (request) => {
    requirePrincipal(request);
    return { killed: await services.autonomyGuard.isKilled() };
  });

  app.post("/admin/autonomy/kill", async (request) => {
    requireUserPrincipal(request);
    parse(adminAutonomySchema, request.body ?? {});
    return services.autonomyGuard.setGloballyEnabled(false);
  });

  app.post("/admin/autonomy/resume", async (request) => {
    requireUserPrincipal(request);
    parse(adminAutonomySchema, request.body ?? {});
    return services.autonomyGuard.setGloballyEnabled(true);
  });

  app.patch("/conversations/:conversationId/autonomy", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("conversationId"), request.params);
    const body = parse(updateConversationAutonomySchema, request.body);
    return services.conversations.updateAutonomy(principal, params.conversationId, body);
  });

  // --- agent messaging via token --------------------------------------------

  app.post("/agent/messages", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(sendAgentMessageSchema, request.body);
    if (actorType(principal) !== "agent") {
      throw badRequest("This endpoint requires an agent token");
    }
    const message = await services.messages.post(
      principal,
      body.conversationId,
      body.content,
      body.metadata
    );
    return reply.code(201).send({ message });
  });

  app.post("/agent/read", async (request) => {
    const principal = requirePrincipal(request);
    const body = parse(readConversationSchema, request.body);
    const page = await services.messages.list(principal, body.conversationId, {
      limit: body.limit,
      cursor: body.cursor,
      direction: body.direction
    });
    const conversation = await services.conversations.get(principal, body.conversationId);
    return { conversation: { id: conversation.id, title: conversation.title }, ...page };
  });

  // --- join requests --------------------------------------------------------

  app.post("/agent/join-requests", async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(requestJoinConversationSchema, request.body);
    const lifecycle = controllerForRequest(request);
    try {
      const result = await services.joinRequests.createAndWait(principal, body, lifecycle.signal);
      lifecycle.complete();
      return reply.send(result);
    } catch (error) {
      lifecycle.complete();
      throw error;
    }
  });

  app.get("/join-requests", async (request) => {
    // Admitting agents is a human-admin action; agent tokens cannot enumerate
    // the owner's pending-request queue.
    const principal = requireUserPrincipal(request);
    const query = parse(z.object({ status: z.string().optional() }), request.query);
    return services.joinRequests.list(principal, query.status);
  });

  app.post("/join-requests/:joinRequestId/accept", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("joinRequestId"), request.params);
    return services.joinRequests.accept(principal, params.joinRequestId);
  });

  app.post("/join-requests/:joinRequestId/reject", async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(idParam("joinRequestId"), request.params);
    const body = parse(rejectJoinRequestSchema, request.body ?? {});
    return services.joinRequests.reject(principal, params.joinRequestId, body.reason);
  });
}
