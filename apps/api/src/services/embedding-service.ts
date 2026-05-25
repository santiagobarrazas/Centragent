import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";

export type EmbeddingPurpose = "document" | "query";

type EmbedOptions = {
  purpose: EmbeddingPurpose;
};

export class EmbeddingService {
  private readonly warnings = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger
  ) {}

  isConfigured() {
    if (this.config.EMBEDDING_PROVIDER === "disabled") {
      return false;
    }

    if (this.config.EMBEDDING_PROVIDER === "openai") {
      return Boolean(this.config.OPENAI_API_KEY);
    }

    if (this.config.EMBEDDING_PROVIDER === "google") {
      return Boolean(this.config.GEMINI_API_KEY || this.config.GOOGLE_API_KEY);
    }

    if (this.config.EMBEDDING_PROVIDER === "env") {
      return false;
    }

    return true;
  }

  dimensions() {
    return this.config.EMBEDDING_DIMENSIONS;
  }

  async embed(text: string, options: EmbedOptions): Promise<number[] | null> {
    if (!this.isConfigured()) {
      this.warnIfMisconfigured();
      return null;
    }

    if (this.config.EMBEDDING_PROVIDER === "ollama") {
      return this.embedWithOllama(text);
    }

    if (this.config.EMBEDDING_PROVIDER === "openai") {
      return this.embedWithOpenAI(text);
    }

    if (this.config.EMBEDDING_PROVIDER === "google") {
      return this.embedWithGoogle(text, options);
    }

    this.log.warn(
      "EMBEDDING_PROVIDER=env is reserved for later provider wiring; embeddings disabled"
    );
    return null;
  }

  private async embedWithOllama(text: string) {
    const baseUrl = this.config.OLLAMA_BASE_URL.replace(/\/$/, "");
    const model = this.config.OLLAMA_EMBEDDING_MODEL;

    try {
      const response = await fetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: text })
      });

      if (response.ok) {
        const json = (await response.json()) as {
          embeddings?: number[][];
          embedding?: number[];
        };
        return json.embeddings?.[0] ?? json.embedding ?? null;
      }
    } catch (error) {
      this.log.warn({ error }, "Ollama /api/embed failed");
    }

    try {
      const response = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: text })
      });

      if (!response.ok) {
        this.log.warn(
          { status: response.status },
          "Ollama embedding request failed"
        );
        return null;
      }

      const json = (await response.json()) as { embedding?: number[] };
      return json.embedding ?? null;
    } catch (error) {
      this.log.warn({ error }, "Ollama /api/embeddings failed");
      return null;
    }
  }

  private async embedWithOpenAI(text: string) {
    const apiKey = this.config.OPENAI_API_KEY;
    if (!apiKey) {
      this.warnOnce(
        "openai_api_key_missing",
        "EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY; embeddings disabled"
      );
      return null;
    }

    const baseUrl = this.config.OPENAI_BASE_URL.replace(/\/$/, "");
    const model = this.config.OPENAI_EMBEDDING_MODEL;
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    };

    if (this.config.OPENAI_ORGANIZATION) {
      headers["OpenAI-Organization"] = this.config.OPENAI_ORGANIZATION;
    }

    if (this.config.OPENAI_PROJECT) {
      headers["OpenAI-Project"] = this.config.OPENAI_PROJECT;
    }

    const body: Record<string, unknown> = {
      model,
      input: text,
      encoding_format: "float"
    };

    if (this.openAiModelSupportsDimensions(model)) {
      body.dimensions = this.config.EMBEDDING_DIMENSIONS;
    }

    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this.log.warn(
          { status: response.status, errorBody },
          "OpenAI embedding request failed"
        );
        return null;
      }

      const json = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };

      return json.data?.[0]?.embedding ?? null;
    } catch (error) {
      this.log.warn({ error }, "OpenAI embedding request failed");
      return null;
    }
  }

  private async embedWithGoogle(text: string, options: EmbedOptions) {
    const apiKey = this.config.GEMINI_API_KEY || this.config.GOOGLE_API_KEY;
    if (!apiKey) {
      this.warnOnce(
        "google_api_key_missing",
        "EMBEDDING_PROVIDER=google requires GEMINI_API_KEY or GOOGLE_API_KEY; embeddings disabled"
      );
      return null;
    }

    const baseUrl = this.config.GOOGLE_GENERATIVE_LANGUAGE_BASE_URL.replace(
      /\/$/,
      ""
    );
    const model = this.config.GOOGLE_EMBEDDING_MODEL.replace(/^models\//, "");
    const taskType =
      options.purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";

    try {
      const response = await fetch(
        `${baseUrl}/models/${model}:embedContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: `models/${model}`,
            content: {
              parts: [{ text }]
            },
            taskType,
            outputDimensionality: this.config.EMBEDDING_DIMENSIONS
          })
        }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this.log.warn(
          { status: response.status, errorBody },
          "Google embedding request failed"
        );
        return null;
      }

      const json = (await response.json()) as {
        embedding?: { values?: number[] };
      };

      return json.embedding?.values ?? null;
    } catch (error) {
      this.log.warn({ error }, "Google embedding request failed");
      return null;
    }
  }

  private openAiModelSupportsDimensions(model: string) {
    return model.startsWith("text-embedding-3");
  }

  private warnOnce(key: string, message: string) {
    if (this.warnings.has(key)) {
      return;
    }

    this.warnings.add(key);
    this.log.warn(message);
  }

  private warnIfMisconfigured() {
    if (this.config.EMBEDDING_PROVIDER === "disabled") {
      return;
    }

    if (this.config.EMBEDDING_PROVIDER === "openai") {
      this.warnOnce(
        "openai_api_key_missing",
        "EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY; embeddings disabled"
      );
    }

    if (this.config.EMBEDDING_PROVIDER === "google") {
      this.warnOnce(
        "google_api_key_missing",
        "EMBEDDING_PROVIDER=google requires GEMINI_API_KEY or GOOGLE_API_KEY; embeddings disabled"
      );
    }

    if (this.config.EMBEDDING_PROVIDER === "env") {
      this.warnOnce(
        "env_provider_reserved",
        "EMBEDDING_PROVIDER=env is reserved for later provider wiring; embeddings disabled"
      );
    }
  }
}
