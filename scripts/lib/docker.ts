import { spawn } from "node:child_process";
import { rootDir } from "./env.js";

const isWindows = process.platform === "win32";

function shouldUseWindowsShell(command: string) {
  return isWindows && /\.(cmd|bat)$/i.test(command);
}

export async function runStep(label: string, command: string, args: string[]) {
  console.log(`\n${label}...`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: shouldUseWindowsShell(command)
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const prefix =
        command === "docker"
          ? "Docker step failed. Make sure Docker is running and this terminal can access the engine."
          : label;
      reject(new Error(`${prefix} Exit code ${code ?? "unknown"}.`));
    });
  });
}

export async function dockerComposeUp() {
  await runStep("Starting Centragent dev stack (Docker Compose)", "docker", [
    "compose",
    "up",
    "--build",
    "-d"
  ]);
}
