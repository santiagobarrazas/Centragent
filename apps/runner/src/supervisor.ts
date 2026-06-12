import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { BackendClient } from "./backend-client.js";
import { adapterFor } from "./adapters/registry.js";
import { Worker } from "./worker.js";
import type { WorkerContext } from "./run.js";

// install.json keys are tool targets; map them to AGENT_PROVIDERS.
const TARGET_TO_PROVIDER: Record<string, string> = {
  "claude-code": "claude_code",
  codex: "codex",
  "kimi-cli": "kimi_cli",
  cursor: "cursor",
  "antigravity-ide": "antigravity",
  "antigravity-cli": "antigravity_cli",
  opencode: "opencode"
};

type Pair = { provider: string; token: string };

type Whoami = {
  impersonating: { id: string; handle: string; provider: string } | null;
};

export class Supervisor {
  private readonly workers: Worker[] = [];

  async start() {
    const pairs = await resolvePairs();
    if (pairs.length === 0) {
      console.error(
        "[runner] no agent tokens found. Connect a tool (pnpm connect) or set RUNNER_AGENT_TOKENS. Idling."
      );
      return;
    }

    for (const pair of pairs) {
      const adapter = adapterFor(pair.provider);
      if (!adapter) {
        console.error(`[runner] no adapter for provider '${pair.provider}' yet — skipping`);
        continue;
      }
      const backend = new BackendClient(config.CENTRAGENT_API_URL, pair.token);

      let who: Whoami;
      try {
        who = await backend.request<Whoami>("/whoami");
      } catch (error) {
        console.error(`[runner] token for '${pair.provider}' is invalid: ${(error as Error).message}`);
        continue;
      }
      if (!who.impersonating) {
        console.error(`[runner] '${pair.provider}' token is not an agent token — skipping`);
        continue;
      }

      const { id: agentId, handle } = who.impersonating;
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), `ctg-${handle}-`));
      const ctx: WorkerContext = {
        agentId,
        handle,
        provider: pair.provider,
        token: pair.token,
        backend,
        adapter,
        mcpUrl: config.CENTRAGENT_MCP_URL,
        workspaceDir,
        log: (message: string) => console.error(`[runner:@${handle}] ${message}`)
      };
      const worker = new Worker(ctx);
      this.workers.push(worker);
      void worker.start();
    }
  }

  async stop() {
    await Promise.all(this.workers.map((worker) => worker.stop()));
  }
}

async function resolvePairs(): Promise<Pair[]> {
  if (config.RUNNER_AGENT_TOKENS) {
    return config.RUNNER_AGENT_TOKENS.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const sep = entry.indexOf(":");
        const rawProvider = entry.slice(0, sep);
        const token = entry.slice(sep + 1);
        return { provider: TARGET_TO_PROVIDER[rawProvider] ?? rawProvider, token };
      })
      .filter((pair) => pair.token);
  }

  try {
    const raw = fs.readFileSync(config.CENTRAGENT_INSTALL_STATE, "utf8");
    const state = JSON.parse(raw) as Record<string, { token?: string } | undefined>;
    return Object.entries(state)
      .filter(([, value]) => Boolean(value?.token))
      .map(([target, value]) => ({
        provider: TARGET_TO_PROVIDER[target] ?? target,
        token: value!.token as string
      }));
  } catch {
    return [];
  }
}
