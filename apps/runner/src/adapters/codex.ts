import { runProcess } from "./process.js";
import type { AgentToolAdapter, RunInvocation, RunResult, TurnUsage } from "./types.js";

type CodexEvent = {
  type?: string;
  thread_id?: string;
  session_id?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  item?: { type?: string; text?: string };
};

// Codex reads its MCP server from ~/.codex/config.toml (written by `pnpm connect`),
// so there is no per-run config file to write.
export const codexAdapter: AgentToolAdapter = {
  provider: "codex",

  buildMcpConfig() {
    return { path: "", cleanup: () => {} };
  },

  async spawn(invocation: RunInvocation, onUsage: (usage: TurnUsage) => void): Promise<RunResult> {
    const result: RunResult = { isError: false };

    const { code, stderr } = await runProcess(
      "codex",
      ["exec", "--json", "--skip-git-repo-check", invocation.prompt],
      { cwd: invocation.cwd, signal: invocation.signal },
      (line) => {
        let event: CodexEvent;
        try {
          event = JSON.parse(line) as CodexEvent;
        } catch {
          return;
        }
        if (event.thread_id || event.session_id) {
          result.sessionId = event.session_id ?? event.thread_id;
        }
        if (event.usage) {
          onUsage({
            promptTokens: event.usage.input_tokens ?? 0,
            completionTokens: event.usage.output_tokens ?? 0,
            model: event.model ?? "codex"
          });
        }
        if (event.item?.type === "assistant_message" && event.item.text) {
          result.text = event.item.text;
        }
      }
    );

    if (code !== 0 && !result.text) {
      result.isError = true;
      result.text = stderr.slice(-500) || `codex exited with code ${code}`;
    }
    return result;
  }
};
