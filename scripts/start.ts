// `pnpm start:local` (and ./start.sh) — the one-command local convenience:
// bring up the dev stack, then connect your tools. Prompts ONLY for which tools
// (never embeddings — run `pnpm setup` for that). `--yes` auto-detects tools.
import { ensureEnvFile, readEnv } from "./lib/env.js";
import { createRl } from "./lib/prompt.js";
import { dockerComposeUp } from "./lib/docker.js";
import {
  chooseMcpTargets,
  hostApiUrl,
  installMcpTargets,
  localMcpUrl,
  resolveAutoTargets,
  type McpToolTarget
} from "./lib/mcp.js";

const quick = process.argv.includes("--yes") || process.argv.includes("--no-interactive");

async function main() {
  await ensureEnvFile();
  const env = await readEnv();

  console.log("\nCentragent — start dev stack + connect tools");
  console.log(`  Embeddings: ${env.EMBEDDING_PROVIDER || "disabled"}  (change with: pnpm setup)`);

  // Choose tools up front so the only prompt happens before the long build.
  let targets: McpToolTarget[];
  if (quick) {
    targets = await resolveAutoTargets(env);
  } else {
    const rl = createRl();
    try {
      targets = await chooseMcpTargets(rl);
    } finally {
      rl.close();
    }
  }

  await dockerComposeUp();
  await installMcpTargets(targets, {
    mcpUrl: localMcpUrl(env),
    tokens: { mode: "mint", apiUrl: hostApiUrl(env) }
  });

  console.log("\nCentragent is running.");
  console.log("  Web: http://127.0.0.1:3000");
  console.log("  API: http://127.0.0.1:4000");
  console.log("  MCP: http://127.0.0.1:3001/mcp");
  console.log("\n  pnpm dev:logs   ·   pnpm dev:down   ·   pnpm setup (embeddings)   ·   pnpm connect (more tools)");
}

main().catch((error: Error) => {
  console.error(`\nStart failed: ${error.message}`);
  if (error.message.toLowerCase().includes("docker")) {
    console.error(
      "Make sure Docker is running and reachable. On WSL: enable Docker Desktop → Settings → Resources → WSL Integration for this distro."
    );
  }
  process.exit(1);
});
