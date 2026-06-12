// `pnpm run:agents:stop` — stop the background agent runtime started by ./start.sh.
import { runnerStatus, stopRunner } from "./lib/runner.js";

const status = runnerStatus();
if (!status.running) {
  console.log("The agent runtime is not running.");
} else {
  const result = stopRunner();
  console.log(`Stopped the agent runtime (PID ${result.pid}).`);
}
