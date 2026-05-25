export const EMBEDDING_PROVIDER_IDS = [
  "disabled",
  "ollama",
  "openai",
  "google",
  "env"
] as const;

export type EmbeddingProvider = (typeof EMBEDDING_PROVIDER_IDS)[number];

export type EmbeddingProviderDefinition = {
  id: EmbeddingProvider;
  label: string;
  description: string;
  requiresApiKey: boolean;
  modelEnvKey?: string;
  apiKeyEnvKeys?: readonly string[];
};

export type EmbeddingModelDefinition = {
  provider: Exclude<EmbeddingProvider, "disabled" | "env">;
  model: string;
  label: string;
  nativeDimensions: number;
  supportsDimensionOverride: boolean;
  defaultForProvider?: boolean;
  docsUrl?: string;
  notes?: string;
};

export const EMBEDDING_PROVIDERS: readonly EmbeddingProviderDefinition[] = [
  {
    id: "disabled",
    label: "Disabled",
    description: "Run Centragent without semantic indexing.",
    requiresApiKey: false
  },
  {
    id: "ollama",
    label: "Ollama local",
    description: "Use a local Ollama embedding model.",
    requiresApiKey: false,
    modelEnvKey: "OLLAMA_EMBEDDING_MODEL"
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Use the OpenAI embeddings API.",
    requiresApiKey: true,
    modelEnvKey: "OPENAI_EMBEDDING_MODEL",
    apiKeyEnvKeys: ["OPENAI_API_KEY"]
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Use the Google Gemini Developer API embeddings endpoint.",
    requiresApiKey: true,
    modelEnvKey: "GOOGLE_EMBEDDING_MODEL",
    apiKeyEnvKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
  }
] as const;

export const EMBEDDING_MODELS: readonly EmbeddingModelDefinition[] = [
  {
    provider: "ollama",
    model: "nomic-embed-text",
    label: "nomic-embed-text",
    nativeDimensions: 768,
    supportsDimensionOverride: false,
    defaultForProvider: true,
    docsUrl: "https://ollama.com/library/nomic-embed-text",
    notes: "Good local default with a compact vector size."
  },
  {
    provider: "ollama",
    model: "mxbai-embed-large",
    label: "mxbai-embed-large",
    nativeDimensions: 1024,
    supportsDimensionOverride: false,
    docsUrl: "https://ollama.com/library/mxbai-embed-large",
    notes: "Larger local embedding model."
  },
  {
    provider: "ollama",
    model: "all-minilm",
    label: "all-minilm",
    nativeDimensions: 384,
    supportsDimensionOverride: false,
    docsUrl: "https://ollama.com/library/all-minilm",
    notes: "Small local embedding model for fast experiments."
  },
  {
    provider: "openai",
    model: "text-embedding-3-small",
    label: "text-embedding-3-small",
    nativeDimensions: 1536,
    supportsDimensionOverride: true,
    defaultForProvider: true,
    docsUrl: "https://platform.openai.com/docs/guides/embeddings",
    notes: "OpenAI's lower-cost third-generation embedding model."
  },
  {
    provider: "openai",
    model: "text-embedding-3-large",
    label: "text-embedding-3-large",
    nativeDimensions: 3072,
    supportsDimensionOverride: true,
    docsUrl: "https://platform.openai.com/docs/guides/embeddings",
    notes: "OpenAI's most capable third-generation embedding model."
  },
  {
    provider: "openai",
    model: "text-embedding-ada-002",
    label: "text-embedding-ada-002",
    nativeDimensions: 1536,
    supportsDimensionOverride: false,
    docsUrl: "https://platform.openai.com/docs/api-reference/embeddings",
    notes: "Legacy OpenAI embedding model retained for compatibility."
  },
  {
    provider: "google",
    model: "gemini-embedding-001",
    label: "gemini-embedding-001",
    nativeDimensions: 3072,
    supportsDimensionOverride: true,
    defaultForProvider: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/embeddings",
    notes: "Google's current Gemini Developer API embedding model."
  }
] as const;

export function getEmbeddingProviderDefinition(provider: EmbeddingProvider) {
  return EMBEDDING_PROVIDERS.find((definition) => definition.id === provider);
}

export function getEmbeddingModelsForProvider(provider: EmbeddingProvider) {
  return EMBEDDING_MODELS.filter((definition) => definition.provider === provider);
}

export function getDefaultEmbeddingModel(provider: EmbeddingProvider) {
  return (
    getEmbeddingModelsForProvider(provider).find(
      (definition) => definition.defaultForProvider
    ) ?? getEmbeddingModelsForProvider(provider)[0]
  );
}

export function getEmbeddingModelDefinition(
  provider: EmbeddingProvider,
  model?: string
) {
  if (!model) {
    return getDefaultEmbeddingModel(provider);
  }

  return getEmbeddingModelsForProvider(provider).find(
    (definition) => definition.model === model
  );
}

export function isKnownEmbeddingProvider(
  provider: string
): provider is EmbeddingProvider {
  return EMBEDDING_PROVIDERS.some((definition) => definition.id === provider);
}

export function slugifyEmbeddingModelId(model: string) {
  return model
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function defaultQdrantCollectionName(input: {
  provider: EmbeddingProvider;
  model?: string;
  dimensions?: number;
}) {
  if (input.provider === "disabled" || input.provider === "env") {
    return "centragent_memory";
  }

  const model = input.model ?? getDefaultEmbeddingModel(input.provider)?.model;
  const modelSlug = model ? slugifyEmbeddingModelId(model) : "custom";
  const dimensionSuffix = input.dimensions ? `_${input.dimensions}` : "";

  return `centragent_memory_${input.provider}_${modelSlug}${dimensionSuffix}`;
}

export function modelEnvKeyForProvider(provider: EmbeddingProvider) {
  return getEmbeddingProviderDefinition(provider)?.modelEnvKey;
}
