import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";

export class EmbeddingService {
  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger
  ) {}

  isConfigured() {
    return this.config.EMBEDDING_PROVIDER !== "disabled";
  }

  dimensions() {
    return this.config.EMBEDDING_DIMENSIONS;
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.isConfigured()) {
      return null;
    }

    if (this.config.EMBEDDING_PROVIDER === "ollama") {
      return this.embedWithOllama(text);
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
}
