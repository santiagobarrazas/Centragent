import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import {
  DEFAULT_MASTER_USER_ID,
  EMBEDDING_PROVIDER_IDS
} from "@centragent/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config();

const csv = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  QDRANT_URL: z.string().url().default("http://127.0.0.1:6333"),
  QDRANT_COLLECTION: z.string().default("centragent_memory"),
  MASTER_USER_ID: z.string().uuid().default(DEFAULT_MASTER_USER_ID),
  MASTER_USER_NAME: z.string().default("Local Owner"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  // Auth / security.
  // Comma-separated allowed browser origins for the web app (replaces origin:true).
  API_CORS_ORIGINS: z
    .string()
    .default("http://127.0.0.1:3000,http://localhost:3000")
    .transform(csv),
  // Local-first convenience: when true, unauthenticated requests are treated as
  // the local owner. Set false before exposing Centragent beyond your machine.
  AUTH_ALLOW_LOCAL_OWNER: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(720),

  // Embeddings.
  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDER_IDS).default("disabled"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_ORGANIZATION: z.string().optional(),
  OPENAI_PROJECT: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_LANGUAGE_BASE_URL: z
    .string()
    .url()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  GOOGLE_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).optional()
});

export const config = envSchema.parse(process.env);

export type AppConfig = typeof config;
