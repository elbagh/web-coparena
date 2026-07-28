import { defineConfig } from "vitest/config";

// Tres proyectos, cada uno con su config:
//   unit         Node/jsdom, lógica pura y JS de cliente. No necesita build.
//   integration  workerd con D1 y R2 reales; handlers de functions/ llamados
//                directamente. No necesita build.
//   e2e          SELF.fetch contra .worker/index.js: solo comprueba que las
//                rutas y el middleware están cableados. Necesita `npm run build`.
export default defineConfig({
  test: {
    projects: [
      "test/unit/vitest.config.ts",
      "test/integration/vitest.config.ts",
      "test/e2e/vitest.config.ts"
    ]
  }
});
