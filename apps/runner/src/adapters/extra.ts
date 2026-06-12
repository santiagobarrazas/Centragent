import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./process.js";
import type { AgentToolAdapter, McpConfig, RunInvocation, RunResult, TurnUsage } from "./types.js";

// Writes a run-scoped MCP config (mcpServers.centragent) for tools that accept
// a --mcp-config path. urlKey is "url" or "serverUrl" per the tool.
function tempMcpConfig(token: string, mcpUrl: string, urlKey: "url" | "serverUrl"): McpConfig {
  const file = path.join(os.tmpdir(), `centragent-mcp-${randomBytes(6).toString("hex")}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      mcpServers: {
        centragent: { [urlKey]: mcpUrl, headers: { Authorization: `Bearer ${token}` } }
      }
    })
  );
  return {
    path: file,
    cleanup: () => {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  };
}

const noMcpConfig: AgentToolAdapter["buildMcpConfig"] = () => ({ path: "", cleanup: () => {} });

type LooseEvent = {
  type?: string;
  session_id?: string;
  sessionId?: string;
  thread_id?: string;
  model?: string;
  is_error?: boolean;
  result?: string;
  text?: string;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

// Best-effort JSON-stream parser shared by the simpler adapters. The agents post
// their replies via MCP regardless, so even partial parsing yields a working
// reaction; usage/cost is captured when present.
function looseParse(line: string, result: RunResult, onUsage: (usage: TurnUsage) => void) {
  let event: LooseEvent;
  try {
    event = JSON.parse(line) as LooseEvent;
  } catch {
    return;
  }
  const session = event.session_id ?? event.sessionId ?? event.thread_id;
  if (session) result.sessionId = session;
  if (event.total_cost_usd != null) result.costUsd = event.total_cost_usd;
  if (event.num_turns != null) result.turns = event.num_turns;
  if (event.is_error) result.isError = true;
  if (typeof event.result === "string") result.text = event.result;
  else if (event.type === "result" && typeof event.text === "string") result.text = event.text;
  if (event.usage) {
    onUsage({
      promptTokens: event.usage.input_tokens ?? event.usage.prompt_tokens ?? 0,
      completionTokens: event.usage.output_tokens ?? event.usage.completion_tokens ?? 0,
      model: event.model ?? "unknown"
    });
  }
}

function makeAdapter(opts: {
  provider: string;
  command: string;
  buildArgs: (inv: RunInvocation) => string[];
  buildMcpConfig?: AgentToolAdapter["buildMcpConfig"];
}): AgentToolAdapter {
  return {
    provider: opts.provider,
    buildMcpConfig: opts.buildMcpConfig ?? noMcpConfig,
    async spawn(invocation, onUsage) {
      const result: RunResult = { isError: false };
      const { code, stderr } = await runProcess(
        opts.command,
        opts.buildArgs(invocation),
        { cwd: invocation.cwd, signal: invocation.signal },
        (line) => looseParse(line, result, onUsage)
      );
      if (code !== 0 && !result.text) {
        result.isError = true;
        result.text = stderr.slice(-500) || `${opts.command} exited with code ${code}`;
      }
      return result;
    }
  };
}

// NOTE: these are best-effort. cursor-agent / antigravity headless are known to
// sometimes hang — the runner's wall-clock cap SIGKILLs the process group.

export const opencodeAdapter = makeAdapter({
  provider: "opencode",
  command: "opencode",
  // Reads mcp.centragent from opencode.json (written by `pnpm connect`).
  buildArgs: (inv) => ["run", "--format", "json", inv.prompt]
});

export const cursorAdapter = makeAdapter({
  provider: "cursor",
  command: "cursor-agent",
  // Reads ~/.cursor/mcp.json.
  buildArgs: (inv) => ["-p", inv.prompt, "--output-format", "json", "--force"]
});

export const kimiAdapter = makeAdapter({
  provider: "kimi_cli",
  command: "kimi",
  buildMcpConfig: (token, mcpUrl) => tempMcpConfig(token, mcpUrl, "url"),
  buildArgs: (inv) => [
    "--print",
    "--final-message-only",
    "--afk",
    "--mcp-config",
    inv.mcpConfigPath,
    "-p",
    inv.prompt
  ]
});

export const antigravityAdapter = makeAdapter({
  provider: "antigravity_cli",
  command: "antigravity",
  // Reads ~/.gemini/.../mcp_config.json.
  buildArgs: (inv) => ["-p", inv.prompt, "--output-format", "json"]
});
