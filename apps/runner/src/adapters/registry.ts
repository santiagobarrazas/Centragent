import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import {
  antigravityAdapter,
  cursorAdapter,
  kimiAdapter,
  opencodeAdapter
} from "./extra.js";
import type { AgentToolAdapter } from "./types.js";

// claude_code + codex are the verified headless adapters; the rest are
// best-effort (their headless modes vary and may need the wall-clock cap).
const ADAPTERS: Record<string, AgentToolAdapter> = {
  claude_code: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  kimi_cli: kimiAdapter,
  antigravity_cli: antigravityAdapter
};

export function adapterFor(provider: string): AgentToolAdapter | null {
  return ADAPTERS[provider] ?? null;
}
