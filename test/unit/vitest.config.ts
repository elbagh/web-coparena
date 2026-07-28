import { defineConfig } from "vitest/config";

// Node por defecto; los ficheros que necesitan DOM lo piden con el docblock
// `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    name: "unit",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    environment: "node"
  }
});
