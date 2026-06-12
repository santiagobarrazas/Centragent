import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { quoteEnvValue, rootDir, type EnvMap } from "./env.js";
import { chooseMultiple, type Choice, type Rl } from "./prompt.js";

const mcpServerName = "centragent";
const installStatePath = path.join(rootDir, ".centragent", "install.json");

export type McpToolTarget =
  | "claude-code"
  | "codex"
  | "kimi-cli"
  | "cursor"
  | "antigravity-ide"
  | "antigravity-cli"
  | "opencode";

export const ALL_TARGETS: McpToolTarget[] = [
  "claude-code",
  "codex",
  "kimi-cli",
  "cursor",
  "antigravity-ide",
  "antigravity-cli",
  "opencode"
];

export const DEFAULT_TARGETS: McpToolTarget[] = [
  "claude-code",
  "codex",
  "cursor",
  "antigravity-cli"
];

export const TOOL_LABELS: Record<McpToolTarget, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "kimi-cli": "Kimi CLI",
  cursor: "Cursor",
  "antigravity-ide": "Antigravity IDE",
  "antigravity-cli": "Antigravity CLI",
  opencode: "OpenCode"
};

const PROVIDER_FOR_TARGET: Record<McpToolTarget, string> = {
  "claude-code": "claude_code",
  codex: "codex",
  "kimi-cli": "kimi_cli",
  cursor: "cursor",
  "antigravity-ide": "antigravity",
  "antigravity-cli": "antigravity_cli",
  opencode: "opencode"
};

// --- URLs -------------------------------------------------------------------

export function localMcpUrl(env: EnvMap) {
  const host = env.MCP_HOST || "127.0.0.1";
  const port = env.MCP_PORT || "3001";
  return `http://${host}:${port}/mcp`;
}

export function hostApiUrl(env: EnvMap) {
  if (env.NEXT_PUBLIC_API_URL) return env.NEXT_PUBLIC_API_URL;
  const host = env.API_HOST && env.API_HOST !== "0.0.0.0" ? env.API_HOST : "127.0.0.1";
  const port = env.API_PORT || "4000";
  return `http://${host}:${port}`;
}

export async function waitForApiHealth(apiUrl: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

// --- target selection -------------------------------------------------------

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Detect installed tools by probing their config locations. */
export async function detectInstalledTools(): Promise<McpToolTarget[]> {
  const home = os.homedir();
  const probes: Array<[McpToolTarget, string[]]> = [
    ["claude-code", [path.join(home, ".claude.json"), path.join(home, ".claude")]],
    ["codex", [path.join(home, ".codex")]],
    ["kimi-cli", [path.join(home, ".kimi"), path.join(home, ".kimi-code")]],
    ["cursor", [path.join(home, ".cursor")]],
    ["antigravity-ide", [path.join(home, ".gemini", "antigravity")]],
    ["antigravity-cli", [path.join(home, ".gemini", "antigravity-cli")]],
    ["opencode", [path.join(home, ".config", "opencode")]]
  ];
  const found: McpToolTarget[] = [];
  for (const [target, candidates] of probes) {
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        found.push(target);
        break;
      }
    }
  }
  return found;
}

export function parseTargets(value: string): McpToolTarget[] {
  const valid = new Set<McpToolTarget>(ALL_TARGETS);
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is McpToolTarget => valid.has(entry as McpToolTarget));
}

export async function chooseMcpTargets(rl: Rl): Promise<McpToolTarget[]> {
  const choices: Array<Choice<McpToolTarget>> = [
    { label: "Claude Code", description: "~/.claude.json (user scope)", value: "claude-code" },
    { label: "Codex", description: "~/.codex/config.toml", value: "codex" },
    { label: "Kimi CLI", description: "~/.kimi/mcp.json", value: "kimi-cli" },
    { label: "Cursor", description: "~/.cursor/mcp.json", value: "cursor" },
    { label: "Antigravity IDE", description: "~/.gemini/antigravity/", value: "antigravity-ide" },
    { label: "Antigravity CLI", description: "~/.gemini/antigravity-cli/ + unified", value: "antigravity-cli" },
    { label: "OpenCode", description: "~/.config/opencode/opencode.json", value: "opencode" }
  ];
  return chooseMultiple(rl, "Connect Centragent to which tools?", choices, DEFAULT_TARGETS);
}

/** Resolve targets non-interactively: env override → detected → default. */
export async function resolveAutoTargets(env: EnvMap): Promise<McpToolTarget[]> {
  const override = env.CENTRAGENT_MCP_TARGETS?.trim();
  if (override) {
    if (override.toLowerCase() === "none") {
      console.log("CENTRAGENT_MCP_TARGETS=none — skipping tool connection.");
      return [];
    }
    const explicit = override.toLowerCase() === "all" ? ALL_TARGETS : parseTargets(override);
    if (explicit.length > 0) {
      console.log(`Tools (CENTRAGENT_MCP_TARGETS): ${explicit.map((t) => TOOL_LABELS[t]).join(", ")}`);
      return explicit;
    }
  }
  const detected = await detectInstalledTools();
  if (detected.length > 0) {
    console.log(`Detected tools: ${detected.map((t) => TOOL_LABELS[t]).join(", ")}`);
    return detected;
  }
  console.log(`No tools detected; using defaults: ${DEFAULT_TARGETS.map((t) => TOOL_LABELS[t]).join(", ")}`);
  return DEFAULT_TARGETS;
}

// --- install ----------------------------------------------------------------

type McpInstallResult = {
  target: McpToolTarget;
  label: string;
  path?: string;
  ok: boolean;
  message: string;
};

/** How to obtain the bearer token written into each tool's config. */
export type TokenStrategy =
  | { mode: "mint"; apiUrl: string } // mint an agent token per tool (local owner)
  | { mode: "fixed"; token: string }; // use a provided token for all tools (remote)

type InstallEntry = { agentId: string; token: string; prefix: string };
type InstallState = Partial<Record<McpToolTarget, InstallEntry>>;

export async function installMcpTargets(
  targets: McpToolTarget[],
  options: { mcpUrl: string; tokens: TokenStrategy }
): Promise<void> {
  if (targets.length === 0) {
    console.log("No tools selected — nothing to connect.");
    return;
  }

  if (options.tokens.mode === "mint") {
    console.log(`\nWaiting for the Centragent API at ${options.tokens.apiUrl} ...`);
    if (!(await waitForApiHealth(options.tokens.apiUrl))) {
      console.log(
        "  API did not become healthy in time. Start the stack first, or use --token / the web 'Connect a tool' screen."
      );
      return;
    }
  }

  console.log(`Connecting ${targets.length} tool(s) to ${options.mcpUrl}`);
  const state = await readInstallState();
  const results: McpInstallResult[] = [];

  for (const target of targets) {
    try {
      let token: string;
      if (options.tokens.mode === "fixed") {
        token = options.tokens.token;
      } else {
        let entry = state[target];
        if (!entry?.token) {
          entry = await mintAgentToken(options.tokens.apiUrl, target);
          state[target] = entry;
        }
        token = entry.token;
      }
      results.push(await installMcpTarget(target, options.mcpUrl, token));
    } catch (error) {
      results.push({
        target,
        label: TOOL_LABELS[target],
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (options.tokens.mode === "mint") {
    await writeInstallState(state);
  }

  for (const result of results) {
    const marker = result.ok ? "ok" : "failed";
    const location = result.path ? ` (${result.path})` : "";
    console.log(`  [${marker}] ${result.label}${location}: ${result.message}`);
  }
  console.log(
    results.some((result) => !result.ok)
      ? "Some tool configs failed. Fix the listed file and restart that tool."
      : "Done. Restart the affected tools so they reload Centragent's MCP config."
  );
}

const okResult = (target: McpToolTarget, filePath: string, message: string): McpInstallResult => ({
  target,
  label: TOOL_LABELS[target],
  path: filePath,
  ok: true,
  message
});

async function installMcpTarget(
  target: McpToolTarget,
  mcpUrl: string,
  token: string
): Promise<McpInstallResult> {
  const home = os.homedir();
  if (target === "claude-code") {
    const filePath = path.join(home, ".claude.json");
    await installClaudeCodeMcp(filePath, mcpUrl, token);
    return okResult(target, filePath, "user scope, token attached");
  }
  if (target === "codex") {
    const filePath = path.join(home, ".codex", "config.toml");
    await installCodexMcp(filePath, mcpUrl, token);
    return okResult(target, filePath, "configured (http_headers)");
  }
  if (target === "kimi-cli") {
    const filePath = path.join(home, ".kimi", "mcp.json");
    await installMcpServersJson(filePath, mcpUrl, token, "url");
    return okResult(target, filePath, "configured");
  }
  if (target === "cursor") {
    const filePath = path.join(home, ".cursor", "mcp.json");
    await installMcpServersJson(filePath, mcpUrl, token, "url");
    return okResult(target, filePath, "configured");
  }
  if (target === "antigravity-ide") {
    const filePath = path.join(home, ".gemini", "antigravity", "mcp_config.json");
    await installMcpServersJson(filePath, mcpUrl, token, "serverUrl");
    return okResult(target, filePath, "configured (serverUrl)");
  }
  if (target === "antigravity-cli") {
    const cli = path.join(home, ".gemini", "antigravity-cli", "mcp_config.json");
    const unified = path.join(home, ".gemini", "config", "mcp_config.json");
    await installMcpServersJson(cli, mcpUrl, token, "serverUrl");
    await installMcpServersJson(unified, mcpUrl, token, "serverUrl");
    return okResult(target, cli, "configured CLI + unified path (serverUrl)");
  }
  const filePath = path.join(home, ".config", "opencode", "opencode.json");
  await installOpencodeMcp(filePath, mcpUrl, token);
  return okResult(target, filePath, "configured (mcp/type:remote)");
}

async function installClaudeCodeMcp(filePath: string, mcpUrl: string, token: string) {
  const root = (await readJsonObject(filePath, {})) as { mcpServers?: Record<string, unknown> };
  // User scope so Centragent is available in every directory.
  root.mcpServers ??= {};
  root.mcpServers[mcpServerName] = {
    type: "http",
    url: mcpUrl,
    headers: { Authorization: `Bearer ${token}` }
  };
  await writeJsonWithBackup(filePath, root);
}

async function installCodexMcp(filePath: string, mcpUrl: string, token: string) {
  const existing = await fs.readFile(filePath, "utf8").catch(() => "");
  // 2026 Codex marks HTTP by `url` alone; static Authorization rides http_headers.
  const block = [
    `[mcp_servers.${mcpServerName}]`,
    `url = ${quoteEnvValue(mcpUrl)}`,
    `http_headers = { Authorization = ${quoteEnvValue(`Bearer ${token}`)} }`,
    ""
  ].join("\n");
  const withoutExisting = existing.replace(
    new RegExp(
      `(^|\\r?\\n)\\[mcp_servers\\.${escapeRegExp(mcpServerName)}\\]\\r?\\n[\\s\\S]*?(?=\\r?\\n\\[|\\s*$)`,
      "m"
    ),
    "$1"
  );
  const next = `${withoutExisting.trimEnd()}\n\n${block}`.trimStart();
  await writeTextWithBackup(filePath, next.endsWith("\n") ? next : `${next}\n`);
}

// Generic { mcpServers: { centragent: { <urlKey>, headers } } } writer.
async function installMcpServersJson(
  filePath: string,
  mcpUrl: string,
  token: string,
  urlKey: "url" | "serverUrl"
) {
  const root = (await readJsonObject(filePath, {})) as { mcpServers?: Record<string, unknown> };
  root.mcpServers ??= {};
  root.mcpServers[mcpServerName] = {
    [urlKey]: mcpUrl,
    headers: { Authorization: `Bearer ${token}` }
  };
  await writeJsonWithBackup(filePath, root);
}

async function installOpencodeMcp(filePath: string, mcpUrl: string, token: string) {
  const root = (await readJsonObject(filePath, {})) as {
    $schema?: string;
    mcp?: Record<string, unknown>;
  };
  root.$schema ??= "https://opencode.ai/config.json";
  root.mcp ??= {};
  // OpenCode uses top-level `mcp`, `type:"remote"`, and `headers`.
  root.mcp[mcpServerName] = {
    type: "remote",
    url: mcpUrl,
    enabled: true,
    headers: { Authorization: `Bearer ${token}` }
  };
  await writeJsonWithBackup(filePath, root);
}

// --- token minting + state --------------------------------------------------

async function mintAgentToken(apiUrl: string, target: McpToolTarget): Promise<InstallEntry> {
  const agent = (await postJson(`${apiUrl}/agents`, {
    name: TOOL_LABELS[target],
    provider: PROVIDER_FOR_TARGET[target]
  })) as { agent: { id: string } };
  const minted = (await postJson(`${apiUrl}/tokens`, {
    kind: "agent",
    agentId: agent.agent.id,
    label: `${TOOL_LABELS[target]} @ ${rootDir}`
  })) as { token: string; tokenInfo: { prefix: string } };
  return { agentId: agent.agent.id, token: minted.token, prefix: minted.tokenInfo.prefix };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const err = (json as { error?: { message?: string } } | null)?.error;
    throw new Error(err?.message ?? `HTTP ${response.status}`);
  }
  return json;
}

async function readInstallState(): Promise<InstallState> {
  try {
    return JSON.parse(await fs.readFile(installStatePath, "utf8")) as InstallState;
  } catch {
    return {};
  }
}

async function writeInstallState(state: InstallState) {
  await fs.mkdir(path.dirname(installStatePath), { recursive: true });
  await fs.writeFile(installStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// --- file helpers -----------------------------------------------------------

async function readJsonObject(filePath: string, fallback: Record<string, unknown>) {
  const contents = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!contents.trim()) return fallback;
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function writeJsonWithBackup(filePath: string, value: unknown) {
  await writeTextWithBackup(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextWithBackup(filePath: string, nextContents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const current = await fs.readFile(filePath, "utf8").catch(() => undefined);
  if (current === nextContents) return;
  if (current !== undefined) {
    await fs.copyFile(filePath, backupPath(filePath));
  }
  await fs.writeFile(filePath, nextContents, "utf8");
}

function backupPath(filePath: string) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `${filePath}.bak-${stamp}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
