import type { FastifyInstance, FastifyBaseLogger, FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import {
  agentEventsRedisChannel,
  joinRequestRedisChannel,
  REALTIME_REDIS_CHANNEL,
  type RealtimeEnvelope,
  type RealtimeEventName
} from "@centragent/shared";
import type { AppConfig } from "../config.js";
import type { Principal } from "../auth/principal.js";
import type { MembershipService } from "./membership-service.js";

type WsSocket = {
  send: (payload: string) => void;
  close: () => void;
  readyState: number;
  on: (event: string, handler: (payload?: unknown) => void) => void;
};

type WsClient = {
  socket: WsSocket;
  principal: Principal;
  conversations: Set<string>;
};

export class RealtimeService {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly clients = new Set<WsClient>();
  private redisReady = false;

  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger
  ) {
    this.publisher = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.subscriber = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.publisher.on("error", (error) => this.log.warn({ error }, "Redis publisher error"));
    this.subscriber.on("error", (error) => this.log.warn({ error }, "Redis subscriber error"));
  }

  async start() {
    try {
      await this.publisher.connect();
      await this.subscriber.connect();
      await this.subscriber.subscribe(REALTIME_REDIS_CHANNEL);
      this.subscriber.on("message", (_channel, payload) => {
        this.broadcast(JSON.parse(payload) as RealtimeEnvelope);
      });
      this.redisReady = true;
      this.log.info("Redis realtime fanout connected");
    } catch (error) {
      this.redisReady = false;
      this.log.warn({ error }, "Redis unavailable; websocket fanout will be process-local");
    }
  }

  registerWebSocket(app: FastifyInstance, memberships: MembershipService) {
    app.get("/ws", { websocket: true }, (socket: WsSocket, request: FastifyRequest) => {
      // Authenticated by the global auth preHandler (cookie / token / local owner).
      const principal = request.principal;
      if (!principal) {
        socket.close();
        return;
      }

      const client: WsClient = { socket, principal, conversations: new Set() };
      this.clients.add(client);
      socket.send(
        JSON.stringify({
          event: "connected",
          payload: { userId: principal.userId, actingAgentId: principal.agentId },
          createdAt: new Date().toISOString()
        })
      );

      socket.on("message", (raw: unknown) => {
        let message: { type?: string; conversationId?: string };
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (message.type === "unsubscribe" && message.conversationId) {
          client.conversations.delete(message.conversationId);
          return;
        }
        if (message.type === "subscribe" && message.conversationId) {
          const conversationId = message.conversationId;
          // Gate subscription by membership so message content cannot leak.
          memberships
            .resolveReadMembership(principal, conversationId)
            .then(() => client.conversations.add(conversationId))
            .catch(() => {
              socket.send(
                JSON.stringify({
                  event: "error",
                  payload: { message: "Not authorized for that conversation" },
                  createdAt: new Date().toISOString()
                })
              );
            });
        }
      });

      socket.on("close", () => {
        this.clients.delete(client);
      });
    });
  }

  async emit<TPayload>(
    event: RealtimeEventName,
    payload: TPayload,
    conversationId?: string | null
  ) {
    const envelope: RealtimeEnvelope<TPayload> = {
      event,
      payload,
      createdAt: new Date().toISOString()
    };
    if (conversationId !== undefined) {
      envelope.conversationId = conversationId;
    }

    if (this.redisReady) {
      try {
        await this.publisher.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(envelope));
        return;
      } catch (error) {
        this.log.warn({ error }, "Redis publish failed; broadcasting locally");
      }
    }
    this.broadcast(envelope);
  }

  async publishJoinDecision(joinRequestId: string, payload: unknown) {
    if (!this.redisReady) return;
    await this.publisher
      .publish(joinRequestRedisChannel(joinRequestId), JSON.stringify(payload))
      .catch((error) => this.log.warn({ error, joinRequestId }, "join decision publish failed"));
  }

  async publishAgentEvent(agentId: string, payload: unknown) {
    if (!this.redisReady) return;
    await this.publisher
      .publish(agentEventsRedisChannel(agentId), JSON.stringify(payload))
      .catch((error) => this.log.warn({ error, agentId }, "agent event wake publish failed"));
  }

  makeRedisSubscriber() {
    return new Redis(this.config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  private broadcast(envelope: RealtimeEnvelope) {
    const serialized = JSON.stringify(envelope);
    for (const client of this.clients) {
      if (client.socket.readyState !== 1) continue;
      // Conversation-scoped events go only to members who subscribed to that
      // conversation. Coarse, non-conversation events (project/conversation
      // created, join-request nudges) reach every authenticated client and are
      // used purely to trigger membership-scoped REST refetches.
      const deliver = envelope.conversationId
        ? client.conversations.has(envelope.conversationId)
        : true;
      if (deliver) {
        client.socket.send(serialized);
      }
    }
  }

  async close() {
    for (const client of this.clients) {
      client.socket.close();
    }
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }
}
