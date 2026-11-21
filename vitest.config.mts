import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 180000,
    pool: "forks",
    fileParallelism: false,
    // Tests never touch the development database.
    env: { DATABASE_URL: "", PGLITE_DATA_DIR: "memory://", ENABLE_DEMO_UNIVERSITY: "true" },
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/stubs/empty.ts"),
    },
  },
});
