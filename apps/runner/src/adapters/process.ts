import { spawn } from "node:child_process";

/**
 * Spawn a child in its own process group (detached) and stream stdout line by
 * line. On `signal.abort` the WHOLE group is SIGKILLed (so a cap breach kills
 * the tool and any subprocesses it spawned, not just the parent).
 */
export async function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; signal: AbortSignal },
  onLine: (line: string) => void
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let buffer = "";

    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    };
    if (opts.signal.aborted) killGroup();
    opts.signal.addEventListener("abort", killGroup, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim()) onLine(line);
        index = buffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      opts.signal.removeEventListener("abort", killGroup);
      reject(error);
    });
    child.on("close", (code) => {
      opts.signal.removeEventListener("abort", killGroup);
      if (buffer.trim()) onLine(buffer);
      resolve({ code, stderr });
    });
  });
}
