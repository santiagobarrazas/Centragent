import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  EMBEDDING_PROVIDERS,
  defaultQdrantCollectionName,
  getDefaultEmbeddingModel,
  getEmbeddingModelsForProvider,
  isKnownEmbeddingProvider,
  modelEnvKeyForProvider,
  type EmbeddingModelDefinition,
  type EmbeddingProvider
} from "../packages/shared/src/embedding-models.js";

type LauncherProvider = Exclude<EmbeddingProvider, "env">;
type ActiveEmbeddingProvider = Exclude<EmbeddingProvider, "disabled" | "env">;

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env");
const envExamplePath = path.join(rootDir, ".env.example");

type EnvMap = Record<string, string>;

type Choice<TValue> = {
  label: string;
  description?: string;
  value: TValue;
};

const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";

async function main() {
  await ensureEnvFile();
  const env = parseEnvFile(await fs.readFile(envPath, "utf8"));
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    printHeader();
    const provider = await chooseProvider(rl, env);
    const updates: EnvMap = {
      EMBEDDING_PROVIDER: provider
    };

    if (provider === "disabled") {
      updates.QDRANT_COLLECTION = defaultQdrantCollectionName({ provider });
      updates.EMBEDDING_DIMENSIONS = env.EMBEDDING_DIMENSIONS || "768";
    } else if (isActiveProvider(provider)) {
      const model = await chooseModel(rl, provider, env);
      const dimensions = model.nativeDimensions;
      const collection = defaultQdrantCollectionName({
        provider,
        model: model.model,
        dimensions
      });

      updates.EMBEDDING_DIMENSIONS = String(dimensions);
      updates.QDRANT_COLLECTION = collection;

      const modelEnvKey = modelEnvKeyForProvider(provider);
      if (modelEnvKey) {
        updates[modelEnvKey] = model.model;
      }

      applyProviderDefaults(provider, updates, env);
      await maybePromptForApiKey(rl, provider, updates, env);
    }

    printSelection(provider, updates);

    const shouldStart = await confirm(
      rl,
      "Start Docker Compose, migrate/seed, and run API/MCP/web now?",
      true
    );

    await writeEnvFile(updates);
    console.log(`\nUpdated ${path.relative(rootDir, envPath)}.`);

    if (!shouldStart) {
      console.log("Configuration saved. Start later with pnpm start:local.");
      return;
    }
  } finally {
    rl.close();
  }

  await runSetupCommands();
  await startDevProcesses();
}

async function ensureEnvFile() {
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

function parseEnvFile(contents: string): EnvMap {
  const values: EnvMap = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2] ?? "";
    if (!key) {
      continue;
    }
    values[key] = unquoteEnvValue(rawValue.trim());
  }

  return values;
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

async function writeEnvFile(updates: EnvMap) {
  const contents = await fs.readFile(envPath, "utf8").catch(() => "");
  const seen = new Set<string>();
  const lines = contents.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=).*$/);
    if (!match) {
      return line;
    }

    const prefix = match[1] ?? "";
    const key = match[2];
    const separator = match[3] ?? "=";
    if (!key) {
      return line;
    }
    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${prefix}${key}${separator}${quoteEnvValue(updates[key] ?? "")}`;
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

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function printHeader() {
  console.log("\nCentragent local launcher");
  console.log("This configures embeddings, starts Docker infrastructure, runs migrations, and launches API/MCP/web.\n");
}

async function chooseProvider(
  rl: ReturnType<typeof createInterface>,
  env: EnvMap
): Promise<LauncherProvider> {
  const providerChoices = EMBEDDING_PROVIDERS.filter(
    (provider) => provider.id !== "env"
  ).map((provider) => ({
    label: provider.label,
    description: provider.description,
    value: provider.id as LauncherProvider
  }));

  const currentProvider = isKnownEmbeddingProvider(env.EMBEDDING_PROVIDER ?? "")
    ? (env.EMBEDDING_PROVIDER as EmbeddingProvider)
    : "disabled";
  const defaultIndex = Math.max(
    0,
    providerChoices.findIndex((choice) => choice.value === currentProvider)
  );

  return choose(rl, "Embedding provider", providerChoices, defaultIndex);
}

async function chooseModel(
  rl: ReturnType<typeof createInterface>,
  provider: ActiveEmbeddingProvider,
  env: EnvMap
) {
  const models = getEmbeddingModelsForProvider(provider);
  const modelEnvKey = modelEnvKeyForProvider(provider);
  const currentModel = modelEnvKey ? env[modelEnvKey] : undefined;
  const defaultModel = currentModel
    ? models.find((model) => model.model === currentModel)
    : getDefaultEmbeddingModel(provider);
  const defaultIndex = Math.max(
    0,
    models.findIndex((model) => model.model === defaultModel?.model)
  );

  return choose(
    rl,
    "Embedding model",
    models.map((model) => {
      const choice: Choice<EmbeddingModelDefinition> = {
        label: `${model.label} (${model.nativeDimensions} dims)`,
        value: model
      };

      if (model.notes) {
        choice.description = model.notes;
      }

      return choice;
    }),
    defaultIndex
  );
}

async function choose<TValue>(
  rl: ReturnType<typeof createInterface>,
  title: string,
  choices: Array<Choice<TValue>>,
  defaultIndex: number
) {
  if (choices.length === 0) {
    throw new Error(`No choices available for ${title}`);
  }

  console.log(title);
  choices.forEach((choice, index) => {
    const defaultMarker = index === defaultIndex ? " [default]" : "";
    const description = choice.description ? ` - ${choice.description}` : "";
    console.log(`  ${index + 1}. ${choice.label}${defaultMarker}${description}`);
  });

  while (true) {
    const answer = await rl.question(`Select 1-${choices.length}: `);
    const trimmed = answer.trim();
    if (!trimmed) {
      console.log("");
      const defaultChoice = choices[defaultIndex] ?? choices[0];
      if (!defaultChoice) {
        throw new Error(`No default choice available for ${title}`);
      }
      return defaultChoice.value;
    }

    const selected = Number.parseInt(trimmed, 10);
    if (Number.isInteger(selected) && selected >= 1 && selected <= choices.length) {
      console.log("");
      const choice = choices[selected - 1];
      if (choice) {
        return choice.value;
      }
    }

    console.log("Please enter one of the listed numbers.");
  }
}

function applyProviderDefaults(
  provider: ActiveEmbeddingProvider,
  updates: EnvMap,
  env: EnvMap
) {
  if (provider === "ollama") {
    updates.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  }

  if (provider === "openai") {
    updates.OPENAI_BASE_URL = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }

  if (provider === "google") {
    updates.GOOGLE_GENERATIVE_LANGUAGE_BASE_URL =
      env.GOOGLE_GENERATIVE_LANGUAGE_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
  }
}

async function maybePromptForApiKey(
  rl: ReturnType<typeof createInterface>,
  provider: ActiveEmbeddingProvider,
  updates: EnvMap,
  env: EnvMap
) {
  if (provider === "openai") {
    await promptOptionalEnvValue({
      rl,
      env,
      updates,
      key: "OPENAI_API_KEY",
      label: "OpenAI API key"
    });
  }

  if (provider === "google" && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
    await promptOptionalEnvValue({
      rl,
      env,
      updates,
      key: "GEMINI_API_KEY",
      label: "Gemini API key"
    });
  }
}

async function promptOptionalEnvValue(input: {
  rl: ReturnType<typeof createInterface>;
  env: EnvMap;
  updates: EnvMap;
  key: string;
  label: string;
}) {
  const existing = input.env[input.key];
  const prompt = existing
    ? `${input.label} is already set. Press Enter to keep it, or paste a replacement: `
    : `${input.label} is not set. Paste it now, or press Enter to continue without embeddings: `;
  const answer = await input.rl.question(prompt);

  if (answer.trim()) {
    input.updates[input.key] = answer.trim();
  }
}

async function confirm(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: boolean
) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${suffix}) `)).trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }

  return answer === "y" || answer === "yes";
}

function printSelection(provider: EmbeddingProvider, updates: EnvMap) {
  console.log("Selected configuration");
  console.log(`  Provider: ${provider}`);

  const model = selectedModelFromUpdates(provider, updates);
  if (model) {
    console.log(`  Model: ${model.model}`);
  }

  console.log(`  Dimensions: ${updates.EMBEDDING_DIMENSIONS ?? "n/a"}`);
  console.log(`  Qdrant collection: ${updates.QDRANT_COLLECTION ?? "centragent_memory"}`);
  console.log("");
}

function selectedModelFromUpdates(
  provider: EmbeddingProvider,
  updates: EnvMap
): EmbeddingModelDefinition | undefined {
  if (provider === "disabled" || provider === "env") {
    return undefined;
  }

  const modelEnvKey = modelEnvKeyForProvider(provider);
  const model = modelEnvKey ? updates[modelEnvKey] : undefined;
  return getEmbeddingModelsForProvider(provider).find(
    (definition) => definition.model === model
  );
}

function isActiveProvider(
  provider: LauncherProvider
): provider is ActiveEmbeddingProvider {
  return provider !== "disabled";
}

async function runSetupCommands() {
  await runStep("Starting Postgres, Redis, and Qdrant", "docker", [
    "compose",
    "up",
    "-d"
  ]);
  await runStep("Generating Prisma client", corepackCommand, [
    "pnpm",
    "db:generate"
  ]);
  await runStep("Applying database migrations", corepackCommand, [
    "pnpm",
    "db:migrate"
  ]);
  await runStep("Seeding singleton master user", corepackCommand, [
    "pnpm",
    "db:seed"
  ]);
}

async function runStep(label: string, command: string, args: string[]) {
  console.log(`\n${label}...`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

async function startDevProcesses() {
  console.log("\nStarting API, MCP, and web dev servers.");
  console.log("Web: http://127.0.0.1:3000");
  console.log("API: http://127.0.0.1:4000");
  console.log("MCP: http://127.0.0.1:3001/mcp");
  console.log("Press Ctrl+C to stop the dev processes. Docker services are left running.\n");

  const children = [
    startProcess("api", ["pnpm", "--filter", "@centragent/api", "dev"]),
    startProcess("mcp", ["pnpm", "--filter", "@centragent/mcp", "dev"]),
    startProcess("web", ["pnpm", "--filter", "@centragent/web", "dev"])
  ];

  const stopAll = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGINT");
      }
    }
  };

  process.once("SIGINT", () => {
    console.log("\nStopping Centragent dev processes...");
    stopAll();
  });

  process.once("SIGTERM", () => {
    stopAll();
  });

  await new Promise<void>((resolve) => {
    let remaining = children.length;
    for (const child of children) {
      child.on("exit", () => {
        remaining -= 1;
        if (remaining === 0) {
          resolve();
        }
      });
    }
  });
}

function startProcess(label: string, args: string[]) {
  const child = spawn(corepackCommand, args, {
    cwd: rootDir,
    env: process.env,
    shell: false
  });

  prefixStream(label, child.stdout);
  prefixStream(label, child.stderr);

  child.on("error", (error) => {
    console.error(`[${label}] failed to start: ${error.message}`);
  });

  return child;
}

function prefixStream(
  label: string,
  stream: ChildProcessWithoutNullStreams["stdout"]
) {
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${label}] ${line}`);
      }
    }
  });
}

main().catch((error: Error) => {
  console.error(`\nLocal launcher failed: ${error.message}`);
  if (error.message.toLowerCase().includes("docker")) {
    console.error("Make sure Docker Desktop is running, then try again.");
  }
  process.exit(1);
});
