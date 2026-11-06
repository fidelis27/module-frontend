import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/browser/**/*.test.ts"],
    testTimeout: 30000,
  },
});
