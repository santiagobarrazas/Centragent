import { defineConfig } from "vitest/config";

export default defineConfig({
  // The source uses ESM ".js" import specifiers that point at ".ts" files.
  resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
