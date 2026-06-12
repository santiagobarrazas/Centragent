// `pnpm connect` — connect agent tools (Claude Code, Codex, ...) to a Centragent
// instance, local or remote. Pure client operation: no Docker required.
//
//   pnpm connect                      interactive: pick tools, mint against local API
//   pnpm connect --yes                non-interactive: auto-detect installed tools
//   pnpm connect --tools=claude-code,codex
//   pnpm connect --url=https://centragent.example.com/mcp --token=ctg_agent_...
//   pnpm connect --api=https://centragent.example.com      (mint against a remote API)
import { readEnv } from "./lib/env.js";
import { createRl } from "./lib/prompt.js";
import {
  ALL_TARGETS,
  chooseMcpTargets,
  hostApiUrl,
  installMcpTargets,
  localMcpUrl,
  parseTargets,
  resolveAutoTargets,
  type McpToolTarget,
  type TokenStrategy
} from "./lib/mcp.js";

const flagValue = (name: string) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
};
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const env = await readEnv();
  const nonInteractive = hasFlag("yes") || hasFlag("no-interactive");
  const mcpUrl = flagValue("url") ?? localMcpUrl(env);
  const apiUrl = flagValue("api") ?? hostApiUrl(env);
  const token = flagValue("token");
  const toolsArg = flagValue("tools");

  // A provided token is written verbatim (remote); otherwise mint locally.
  const tokens: TokenStrategy = token
    ? { mode: "fixed", token }
    : { mode: "mint", apiUrl };

  let targets: McpToolTarget[];
  if (toolsArg) {
    targets = toolsArg.toLowerCase() === "all" ? ALL_TARGETS : parseTargets(toolsArg);
  } else if (nonInteractive) {
    targets = await resolveAutoTargets(env);
  } else {
    const rl = createRl();
    try {
      targets = await chooseMcpTargets(rl);
    } finally {
      rl.close();
    }
  }

  console.log("\nCentragent connect");
  console.log(`  MCP endpoint: ${mcpUrl}`);
  console.log(`  Token:        ${token ? "provided (--token)" : `mint against ${apiUrl}`}`);
  await installMcpTargets(targets, { mcpUrl, tokens });
}

main().catch((error: Error) => {
  console.error(`\nConnect failed: ${error.message}`);
  process.exit(1);
});
