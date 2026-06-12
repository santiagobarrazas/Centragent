import { config } from "./config.js";
import { Supervisor } from "./supervisor.js";

const supervisor = new Supervisor();

const shutdown = async () => {
  console.error("[runner] shutting down");
  await supervisor.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.error(
  `[runner] Centragent agent runner starting (api=${config.CENTRAGENT_API_URL}, mcp=${config.CENTRAGENT_MCP_URL})`
);
await supervisor.start();
