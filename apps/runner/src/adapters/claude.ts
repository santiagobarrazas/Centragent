import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./process.js";
import type { AgentToolAdapter, RunInvocation, RunResult, TurnUsage } from "./types.js";

type StreamEvent = {
  type?: string;
  session_id?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  message?: {
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
};

export const claudeAdapter: AgentToolAdapter = {
  provider: "claude_code",

  buildMcpConfig(token, mcpUrl) {
    const file = path.join(os.tmpdir(), `centragent-mcp-${randomBytes(6).toString("hex")}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          centragent: {
            type: "http",
            url: mcpUrl,
            headers: { Authorization: `Bearer ${token}` }
          }
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
  },

  async spawn(invocation: RunInvocation, onUsage: (usage: TurnUsage) => void): Promise<RunResult> {
    const args = [
      "-p",
      invocation.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      process.env.RUNNER_CLAUDE_PERMISSION_MODE ?? "bypassPermissions",
      "--max-turns",
      String(invocation.maxTurns),
      "--mcp-config",
      invocation.mcpConfigPath,
      "--strict-mcp-config"
    ];
    if (invocation.allowedTools.length > 0) {
      args.push("--allowedTools", invocation.allowedTools.join(","));
    }
    if (invocation.resumeSessionId) {
      args.push("--resume", invocation.resumeSessionId);
    }

    const result: RunResult = { isError: false };
    let model: string | undefined;

    const { code, stderr } = await runProcess(
      "claude",
      args,
      { cwd: invocation.cwd, signal: invocation.signal },
      (line) => {
        let event: StreamEvent;
        try {
          event = JSON.parse(line) as StreamEvent;
        } catch {
          return;
        }
        if (event.session_id) result.sessionId = event.session_id;
        if (event.type === "assistant" && event.message?.usage) {
          model = event.message.model ?? model;
          onUsage({
            promptTokens: event.message.usage.input_tokens ?? 0,
            completionTokens: event.message.usage.output_tokens ?? 0,
            model
          });
        }
        if (event.type === "result") {
          result.text = event.result;
          result.costUsd = event.total_cost_usd;
          result.turns = event.num_turns;
          result.isError = Boolean(event.is_error);
        }
      }
    );

    if (code !== 0 && !result.text) {
      result.isError = true;
      result.text = stderr.slice(-500) || `claude exited with code ${code}`;
    }
    return result;
  }
};
