import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export default defineConfig({
  // Local-first, greenfield: the schema is applied with `prisma db push` plus
  // prisma/sql/constraints.sql (see `db:setup`), not migration files.
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx src/seed.ts"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
