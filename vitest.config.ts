import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: { include: ["packages/*/test/**/*.test.ts"], passWithNoTests: true, environment: "node" },
});
