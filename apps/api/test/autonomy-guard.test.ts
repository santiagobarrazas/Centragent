import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AutonomyGuard, freshChain, type GuardInput } from "../src/services/autonomy-guard.js";
import type { AppConfig } from "../src/config.js";
import type { RealtimeService } from "../src/services/realtime-service.js";

const CONFIG = {
  CENTRAGENT_AUTONOMY_ENABLED: true,
  AUTONOMY_MAX_HOPS: 6,
  AUTONOMY_MAX_CONSECUTIVE_AGENT_MESSAGES: 12,
  AUTONOMY_COOLDOWN_MS: 15_000,
  AUTONOMY_CONV_MESSAGE_BUDGET: 60,
  AUTONOMY_BUDGET_WINDOW_MS: 3_600_000
} as unknown as AppConfig;

type Opts = {
  enabled?: boolean;
  flag?: boolean;
  autonomyState?: string;
  targetEnabled?: boolean;
  agentMsgCount?: number;
  recentMention?: boolean;
};

const makeGuard = (opts: Opts = {}) => {
  const prisma = {
    systemFlag: {
      findUnique: async () => (opts.flag === undefined ? null : { valueBool: opts.flag })
    },
    conversation: {
      findUnique: async () => ({
        autonomyState: opts.autonomyState ?? "active",
        autonomyConfig: {}
      })
    },
    agent: {
      findUnique: async () => ({ autonomyEnabled: opts.targetEnabled ?? true, name: "Target" })
    },
    membership: { count: async () => 2 },
    agentEvent: { findFirst: async () => (opts.recentMention ? { id: "x" } : null) },
    message: {
      findFirst: async () => null,
      count: async () => opts.agentMsgCount ?? 0
    },
    autonomyUsage: { create: async () => ({}) }
  } as unknown as PrismaClient;
  const realtime = { emit: async () => {} } as unknown as RealtimeService;
  const log = { warn() {}, info() {} } as never;
  const config = opts.enabled === undefined ? CONFIG : ({ ...CONFIG, CENTRAGENT_AUTONOMY_ENABLED: opts.enabled } as AppConfig);
  return new AutonomyGuard(prisma, realtime, config, log);
};

const agentInput = (chainDepth: number): GuardInput => ({
  conversationId: "c1",
  senderType: "agent",
  senderAgentId: "a1",
  targetAgentId: "a2",
  chain: { depth: chainDepth, agentIds: ["a1"], rootMessageId: "m0" }
});

describe("AutonomyGuard.evaluate", () => {
  it("always allows human-originated mentions", async () => {
    const guard = makeGuard({ enabled: false }); // even when killed
    const verdict = await guard.evaluate({ ...agentInput(0), senderType: "user", senderAgentId: null });
    expect(verdict.allow).toBe(true);
  });

  it("denies agent→agent when autonomy is globally killed (env)", async () => {
    const guard = makeGuard({ enabled: false });
    expect((await guard.evaluate(agentInput(0))).allow).toBe(false);
  });

  it("denies agent→agent when the SystemFlag kill switch is off", async () => {
    const guard = makeGuard({ flag: false });
    expect((await guard.evaluate(agentInput(0))).allow).toBe(false);
  });

  it("denies when the conversation is paused", async () => {
    const guard = makeGuard({ autonomyState: "paused" });
    expect((await guard.evaluate(agentInput(0))).allow).toBe(false);
  });

  it("denies when the target agent has autonomy disabled", async () => {
    const guard = makeGuard({ targetEnabled: false });
    expect((await guard.evaluate(agentInput(0))).allow).toBe(false);
  });

  it("denies + pauses at the hop limit", async () => {
    const guard = makeGuard();
    const verdict = await guard.evaluate(agentInput(6));
    expect(verdict.allow).toBe(false);
    expect(verdict.pause).toBe(true);
  });

  it("denies + pauses at the consecutive-agent-message limit", async () => {
    const guard = makeGuard({ agentMsgCount: 12 });
    const verdict = await guard.evaluate(agentInput(1));
    expect(verdict.allow).toBe(false);
    expect(verdict.pause).toBe(true);
  });

  it("denies on a cooldown collision", async () => {
    const guard = makeGuard({ recentMention: true });
    expect((await guard.evaluate(agentInput(1))).allow).toBe(false);
  });

  it("allows a healthy agent→agent mention", async () => {
    const guard = makeGuard({ agentMsgCount: 1 });
    expect((await guard.evaluate(agentInput(1))).allow).toBe(true);
  });
});

describe("freshChain", () => {
  it("starts at depth 0", () => {
    expect(freshChain("m1").depth).toBe(0);
    expect(freshChain("m1", "a1").agentIds).toEqual(["a1"]);
  });
});
