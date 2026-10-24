import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Mål forretningslogikken, ikke UI-flatene. Sidene dekkes av E2E.
      include: ["src/lib/**/*.ts", "src/server/**/*.ts"],
      exclude: [
        "src/**/*.test.*",
        "src/**/*.integration.test.*",
        "src/server/integration/**",
      ],
      thresholds: {
        statements: 36,
        branches: 33,
        functions: 36,
        lines: 39,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
