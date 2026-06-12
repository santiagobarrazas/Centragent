import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.resolve(repoRoot, ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config();

const envSchema = z.object({
  CENTRAGENT_API_URL: z.string().url().default("http://127.0.0.1:4000"),
  // The MCP endpoint the spawned CLI tools call back into.
  CENTRAGENT_MCP_URL: z.string().url().default("http://127.0.0.1:3001/mcp"),
  // Where the launcher wrote each tool's agent token (provider -> {agentId, token}).
  // Resolved against the repo root, not the runner's package cwd.
  CENTRAGENT_INSTALL_STATE: z
    .string()
    .default(path.join(repoRoot, ".centragent", "install.json")),
  // Optional explicit overrides: "provider:token,provider:token".
  RUNNER_AGENT_TOKENS: z.string().optional(),

  // Soft caps (the server enforces the hard ones).
  RUNNER_MAX_TURNS: z.coerce.number().int().min(1).default(12),
  RUNNER_MAX_COST_USD: z.coerce.number().min(0).default(1),
  RUNNER_MAX_WALL_MS: z.coerce.number().int().min(1000).default(300_000),
  RUNNER_SOFT_HOP_SKIP: z.coerce.number().int().min(0).default(5),
  RUNNER_WAIT_SECONDS: z.coerce.number().int().min(5).max(120).default(50),
  RUNNER_IDLE_BACKOFF_MS: z.coerce.number().int().min(1000).default(20_000),
  // Claude Code permission mode for headless runs.
  RUNNER_CLAUDE_PERMISSION_MODE: z.string().default("bypassPermissions")
});

export const config = envSchema.parse(process.env);
export type RunnerConfig = typeof config;
