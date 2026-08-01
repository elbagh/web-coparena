import { defineConfig } from "vitest/config";

// Node por defecto; los ficheros que necesitan DOM lo piden con el docblock
// `// @vitest-environment jsdom`.
//
// Nada de `process.env.TZ` aquí: forzar UTC para todo el proyecto dejaría sin
// comprobar nada a cualquier test futuro que dependa de la hora local, y el
// público del sitio está en Europe/Madrid. `anotador-partido.test.ts` compara
// contra un valor calculado con el mismo formateador (como
// `torneo-page-clasificacion.test.ts`), no contra un literal, así que no
// depende de la zona de la máquina.
export default defineConfig({
  test: {
    name: "unit",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    environment: "node"
  }
});
