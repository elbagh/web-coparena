import { defineConfig } from "vitest/config";

// Node por defecto; los ficheros que necesitan DOM lo piden con el docblock
// `// @vitest-environment jsdom`.
//
// TZ=UTC porque `anotador-partido.test.ts` formatea `ultimaActividad` (que
// llega en UTC) a la hora local para comprobar el texto: sin fijar la zona,
// la máquina donde corran los tests decide si la comprobación pasa.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    name: "unit",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    environment: "node"
  }
});
