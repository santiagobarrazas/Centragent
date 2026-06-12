import { AUTONOMY_TRIGGER_EVENT_TYPES } from "@centragent/shared";
import { config } from "./config.js";
import { executeRun, type InboxDelivery, type WorkerContext } from "./run.js";

const TRIGGER_TYPES = [...AUTONOMY_TRIGGER_EVENT_TYPES];

type InboxResponse = {
  events: InboxDelivery[];
  pendingCount: number;
  status?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms: number) => Math.round(ms * (0.5 + Math.random()));

// Serializes reactions for ONE agent (an agent never spawns two CLIs at once).
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function groupByConversation(events: InboxDelivery[]) {
  const groups = new Map<string, { primary: InboxDelivery; deliveryIds: string[] }>();
  for (const delivery of events) {
    const key =
      delivery.event.conversationId ?? delivery.event.conversation?.id ?? delivery.deliveryId;
    const existing = groups.get(key);
    if (existing) {
      existing.deliveryIds.push(delivery.deliveryId);
    } else {
      groups.set(key, { primary: delivery, deliveryIds: [delivery.deliveryId] });
    }
  }
  return [...groups.values()];
}

export class Worker {
  private stopped = false;
  private activeWait: AbortController | null = null;
  private backoff = 0;
  private readonly mutex = new Mutex();

  constructor(private readonly ctx: WorkerContext) {}

  async start() {
    this.ctx.log(`online (${this.ctx.provider})`);
    await this.announcePresence();

    while (!this.stopped) {
      try {
        // Drain any backlog first, then park on the long-poll.
        let response = await this.ctx.backend.request<InboxResponse>("/agent/inbox/sync", {
          method: "POST",
          body: { limit: 20, eventTypes: TRIGGER_TYPES }
        });

        if (response.events.length === 0) {
          this.activeWait = new AbortController();
          response = await this.ctx.backend.request<InboxResponse>("/agent/inbox/wait", {
            method: "POST",
            body: { timeoutSeconds: config.RUNNER_WAIT_SECONDS, limit: 20, eventTypes: TRIGGER_TYPES },
            signal: this.activeWait.signal
          });
          this.activeWait = null;
        }

        this.backoff = 0;
        if (response.status === "autonomy_paused") {
          await sleep(config.RUNNER_IDLE_BACKOFF_MS);
          continue;
        }
        if (this.stopped) break;

        for (const group of groupByConversation(response.events)) {
          await this.mutex.run(() => executeRun(this.ctx, group.primary, group.deliveryIds));
        }
      } catch (error) {
        if (this.stopped) break;
        this.backoff = Math.min(30_000, (this.backoff || 1000) * 2);
        this.ctx.log(
          `loop error: ${(error as Error).message}; retrying in ${Math.round(this.backoff / 1000)}s`
        );
        await sleep(jitter(this.backoff));
      }
    }
    this.ctx.log("stopped");
  }

  async stop() {
    this.stopped = true;
    this.activeWait?.abort();
  }

  // Mark the agent live in every conversation it has joined.
  private async announcePresence() {
    try {
      const { conversations } = await this.ctx.backend.request<{
        conversations: Array<{ id: string }>;
      }>("/conversations", { query: { limit: 100 } });
      for (const conversation of conversations) {
        await this.ctx.backend
          .request("/agent/presence", {
            method: "POST",
            body: { conversationId: conversation.id, status: "listening" }
          })
          .catch(() => undefined);
      }
    } catch {
      // best effort
    }
  }
}
