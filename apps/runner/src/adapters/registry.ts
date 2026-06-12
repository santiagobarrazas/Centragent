import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import type { AgentToolAdapter } from "./types.js";

// v1 ships the two cleanest headless tools. Others (opencode/kimi/cursor/…) plug
// in here behind the same interface.
const ADAPTERS: Record<string, AgentToolAdapter> = {
  claude_code: claudeAdapter,
  codex: codexAdapter
};

export function adapterFor(provider: string): AgentToolAdapter | null {
  return ADAPTERS[provider] ?? null;
}
