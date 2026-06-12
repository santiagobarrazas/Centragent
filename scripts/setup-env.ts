// `pnpm setup` — configure embeddings and secrets in .env. This is the ONLY
// place that asks about providers / API keys; starting and connecting never do.
import path from "node:path";
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
import { envPath, readEnv, rootDir, writeEnvFile, type EnvMap } from "./lib/env.js";
import {
  choose,
  createRl,
  promptEnvValue,
  promptOptionalEnvValue,
  type Choice,
  type Rl
} from "./lib/prompt.js";

type LauncherProvider = Exclude<EmbeddingProvider, "env">;
type ActiveEmbeddingProvider = Exclude<EmbeddingProvider, "disabled" | "env">;

async function main() {
  const env = await readEnv();
  const rl = createRl();

  try {
    console.log("\nCentragent setup — embeddings & .env");
    console.log("Press Enter to keep an existing value.\n");

    const provider = await chooseProvider(rl, env);
    const updates: EnvMap = { EMBEDDING_PROVIDER: provider };

    if (provider === "disabled") {
      const dimensions = await promptEnvValue(rl, {
        key: "EMBEDDING_DIMENSIONS",
        current: env.EMBEDDING_DIMENSIONS,
        suggested: "768",
        label: "Embedding dimensions"
      });
      updates.EMBEDDING_DIMENSIONS = dimensions;
      updates.QDRANT_COLLECTION = await chooseQdrantCollection(rl, env, {
        provider,
        dimensions: Number.parseInt(dimensions, 10)
      });
    } else if (isActiveProvider(provider)) {
      const model = await chooseModel(rl, provider, env);
      const dimensions = await chooseDimensions(rl, model, env);
      updates.EMBEDDING_DIMENSIONS = String(dimensions);
      updates.QDRANT_COLLECTION = await chooseQdrantCollection(rl, env, {
        provider,
        model: model.model,
        dimensions
      });
      const modelEnvKey = modelEnvKeyForProvider(provider);
      if (modelEnvKey) updates[modelEnvKey] = model.model;
      applyProviderDefaults(provider, updates, env);
      await maybePromptForApiKey(rl, provider, updates, env);
    }

    printSelection(provider, updates);
    await writeEnvFile(updates);
    console.log(`\nUpdated ${path.relative(rootDir, envPath)}.`);
    console.log("Next:  pnpm dev:up  (start the stack)   ·   pnpm connect  (connect your tools)");
  } finally {
    rl.close();
  }
}

async function chooseProvider(rl: Rl, env: EnvMap): Promise<LauncherProvider> {
  const choices: Array<Choice<LauncherProvider>> = EMBEDDING_PROVIDERS.filter(
    (provider) => provider.id !== "env"
  ).map((provider) => ({
    label: provider.label,
    description: provider.description,
    value: provider.id as LauncherProvider
  }));
  const current = isKnownEmbeddingProvider(env.EMBEDDING_PROVIDER ?? "")
    ? (env.EMBEDDING_PROVIDER as EmbeddingProvider)
    : "disabled";
  const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.value === current));
  return choose(rl, "Embedding provider", choices, defaultIndex);
}

async function chooseModel(rl: Rl, provider: ActiveEmbeddingProvider, env: EnvMap) {
  const models = getEmbeddingModelsForProvider(provider);
  const modelEnvKey = modelEnvKeyForProvider(provider);
  const currentModel = modelEnvKey ? env[modelEnvKey] : undefined;
  const defaultModel = currentModel
    ? models.find((model) => model.model === currentModel)
    : getDefaultEmbeddingModel(provider);
  const defaultIndex = Math.max(0, models.findIndex((m) => m.model === defaultModel?.model));
  return choose(
    rl,
    "Embedding model",
    models.map((model) => {
      const choice: Choice<EmbeddingModelDefinition> = {
        label: `${model.label} (${model.nativeDimensions} dims)`,
        value: model
      };
      if (model.notes) choice.description = model.notes;
      return choice;
    }),
    defaultIndex
  );
}

async function chooseDimensions(rl: Rl, model: EmbeddingModelDefinition, env: EnvMap) {
  const suggested = String(model.nativeDimensions);
  const value = await promptEnvValue(rl, {
    key: "EMBEDDING_DIMENSIONS",
    current: env.EMBEDDING_DIMENSIONS,
    suggested,
    label: "Embedding dimensions"
  });
  const dimensions = Number.parseInt(value, 10);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    console.log(`Invalid dimensions "${value}". Using ${suggested}.`);
    return model.nativeDimensions;
  }
  return dimensions;
}

async function chooseQdrantCollection(
  rl: Rl,
  env: EnvMap,
  input: { provider: EmbeddingProvider; model?: string; dimensions?: number }
) {
  return promptEnvValue(rl, {
    key: "QDRANT_COLLECTION",
    current: env.QDRANT_COLLECTION,
    suggested: defaultQdrantCollectionName(input),
    label: "Qdrant collection"
  });
}

function applyProviderDefaults(
  provider: ActiveEmbeddingProvider,
  updates: EnvMap,
  env: EnvMap
) {
  if (provider === "ollama") {
    updates.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  } else if (provider === "openai") {
    updates.OPENAI_BASE_URL = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  } else if (provider === "google") {
    updates.GOOGLE_GENERATIVE_LANGUAGE_BASE_URL =
      env.GOOGLE_GENERATIVE_LANGUAGE_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
  }
}

async function maybePromptForApiKey(
  rl: Rl,
  provider: ActiveEmbeddingProvider,
  updates: EnvMap,
  env: EnvMap
) {
  if (provider === "openai") {
    await promptOptionalEnvValue({ rl, env, updates, key: "OPENAI_API_KEY", label: "OpenAI API key" });
  } else if (provider === "google" && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
    await promptOptionalEnvValue({ rl, env, updates, key: "GEMINI_API_KEY", label: "Gemini API key" });
  }
}

function printSelection(provider: EmbeddingProvider, updates: EnvMap) {
  console.log("\nSelected configuration");
  console.log(`  Provider: ${provider}`);
  const modelEnvKey = provider === "disabled" || provider === "env" ? undefined : modelEnvKeyForProvider(provider);
  const modelId = modelEnvKey ? updates[modelEnvKey] : undefined;
  if (modelId) console.log(`  Model: ${modelId}`);
  console.log(`  Dimensions: ${updates.EMBEDDING_DIMENSIONS ?? "n/a"}`);
  console.log(`  Qdrant collection: ${updates.QDRANT_COLLECTION ?? "centragent_memory"}`);
}

function isActiveProvider(provider: LauncherProvider): provider is ActiveEmbeddingProvider {
  return provider !== "disabled";
}

main().catch((error: Error) => {
  console.error(`\nSetup failed: ${error.message}`);
  process.exit(1);
});
