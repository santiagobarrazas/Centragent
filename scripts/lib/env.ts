import fs from "node:fs/promises";
import path from "node:path";

export type EnvMap = Record<string, string>;

export const rootDir = process.cwd();
export const envPath = path.join(rootDir, ".env");
export const envExamplePath = path.join(rootDir, ".env.example");

/** Create .env from .env.example (or empty) if it does not exist yet. */
export async function ensureEnvFile() {
  try {
    await fs.access(envPath);
  } catch {
    try {
      await fs.copyFile(envExamplePath, envPath);
    } catch {
      await fs.writeFile(envPath, "", "utf8");
    }
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvFile(contents: string): EnvMap {
  const values: EnvMap = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    values[key] = unquoteEnvValue((match[2] ?? "").trim());
  }
  return values;
}

/** Ensure .env exists, then read + parse it. */
export async function readEnv(): Promise<EnvMap> {
  await ensureEnvFile();
  return parseEnvFile(await fs.readFile(envPath, "utf8"));
}

export function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

/** Merge `updates` into .env in place, preserving comments and order. */
export async function writeEnvFile(updates: EnvMap) {
  const contents = await fs.readFile(envPath, "utf8").catch(() => "");
  const seen = new Set<string>();
  const lines = contents.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=).*$/);
    if (!match) return line;
    const key = match[2];
    if (!key || !(key in updates)) return line;
    seen.add(key);
    return `${match[1] ?? ""}${key}${match[3] ?? "="}${quoteEnvValue(updates[key] ?? "")}`;
  });

  const missing = Object.entries(updates).filter(([key]) => !seen.has(key));
  if (missing.length > 0 && lines.at(-1)?.trim()) {
    lines.push("");
  }
  for (const [key, value] of missing) {
    lines.push(`${key}=${quoteEnvValue(value)}`);
  }
  await fs.writeFile(envPath, `${lines.join("\n").replace(/\s+$/, "")}\n`, "utf8");
}
