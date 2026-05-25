import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { Redis } from "ioredis";
import {
  joinRequestRedisChannel,
  REALTIME_REDIS_CHANNEL,
  type RealtimeEnvelope,
  type RealtimeEventName
} from "@centragent/shared";
import type { AppConfig } from "../config.js";

type WsClient = {
  socket: {
    send: (payload: string) => void;
    close: () => void;
    readyState: number;
    on: (event: string, handler: (payload?: unknown) => void) => void;
  };
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
    this.publisher = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    this.subscriber = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });

    this.publisher.on("error", (error) =>
      this.log.warn({ error }, "Redis publisher error")
    );
    this.subscriber.on("error", (error) =>
      this.log.warn({ error }, "Redis subscriber error")
    );
  }

  async start() {
    try {
      await this.publisher.connect();
      await this.subscriber.connect();
      await this.subscriber.subscribe(REALTIME_REDIS_CHANNEL);
      this.subscriber.on("message", (_channel, payload) => {
        const envelope = JSON.parse(payload) as RealtimeEnvelope;
        this.broadcast(envelope);
      });
      this.redisReady = true;
      this.log.info("Redis realtime fanout connected");
    } catch (error) {
      this.redisReady = false;
      this.log.warn(
        { error },
        "Redis unavailable; websocket fanout will be process-local"
      );
    }
  }

  registerWebSocket(app: FastifyInstance) {
    app.get("/ws", { websocket: true }, (socket) => {
      const client: WsClient = {
        socket,
        conversations: new Set()
      };

      this.clients.add(client);
      socket.send(
        JSON.stringify({
          event: "connected",
          payload: { message: "connected to Centragent realtime" },
          createdAt: new Date().toISOString()
        })
      );

      socket.on("message", (raw: unknown) => {
        try {
          const message = JSON.parse(String(raw)) as {
            type?: string;
            conversationId?: string;
          };

          if (message.type === "subscribe" && message.conversationId) {
            client.conversations.add(message.conversationId);
          }

          if (message.type === "unsubscribe" && message.conversationId) {
            client.conversations.delete(message.conversationId);
          }
        } catch {
          socket.send(
            JSON.stringify({
              event: "error",
              payload: { message: "Invalid websocket message" },
              createdAt: new Date().toISOString()
            })
          );
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
        await this.publisher.publish(
          REALTIME_REDIS_CHANNEL,
          JSON.stringify(envelope)
        );
        return;
      } catch (error) {
        this.log.warn({ error }, "Redis publish failed; broadcasting locally");
      }
    }

    this.broadcast(envelope);
  }

  async publishJoinDecision(joinRequestId: string, payload: unknown) {
    if (!this.redisReady) {
      return;
    }

    try {
      await this.publisher.publish(
        joinRequestRedisChannel(joinRequestId),
        JSON.stringify(payload)
      );
    } catch (error) {
      this.log.warn({ error, joinRequestId }, "join decision publish failed");
    }
  }

  makeRedisSubscriber() {
    return new Redis(this.config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
  }

  private broadcast(envelope: RealtimeEnvelope) {
    const serialized = JSON.stringify(envelope);

    for (const client of this.clients) {
      const shouldSend =
        !envelope.conversationId ||
        envelope.event.startsWith("agent.join_request.") ||
        client.conversations.has(envelope.conversationId);

      if (!shouldSend || client.socket.readyState !== 1) {
        continue;
      }

      client.socket.send(serialized);
    }
  }

  async close() {
    for (const client of this.clients) {
      client.socket.close();
    }
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }
}
