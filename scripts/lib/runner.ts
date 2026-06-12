import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rootDir } from "./env.js";

const stateDir = path.join(rootDir, ".centragent");
const pidPath = path.join(stateDir, "runner.pid");
export const runnerLogPath = path.join(stateDir, "runner.log");

export function runnerStatus(): { running: boolean; pid?: number } {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
    if (!Number.isInteger(pid)) return { running: false };
    process.kill(pid, 0); // throws if the process is gone
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}

/** Launch the agent runtime as a detached background daemon (idempotent). */
export function startRunner(): {
  started: boolean;
  alreadyRunning: boolean;
  pid?: number | undefined;
} {
  const status = runnerStatus();
  if (status.running) {
    return { started: false, alreadyRunning: true, pid: status.pid };
  }
  fs.mkdirSync(stateDir, { recursive: true });
  const out = fs.openSync(runnerLogPath, "a");
  const child = spawn("corepack", ["pnpm", "--filter", "@centragent/runner", "start"], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env
  });
  child.unref();
  if (child.pid) {
    fs.writeFileSync(pidPath, String(child.pid));
  }
  return { started: true, alreadyRunning: false, pid: child.pid };
}

export function stopRunner(): { stopped: boolean; pid?: number } {
  const status = runnerStatus();
  if (!status.running || !status.pid) {
    return { stopped: false };
  }
  try {
    process.kill(-status.pid, "SIGTERM"); // kill the whole group
  } catch {
    try {
      process.kill(status.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // ignore
  }
  return { stopped: true, pid: status.pid };
}
