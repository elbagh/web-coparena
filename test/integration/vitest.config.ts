import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Las migraciones se leen aquí (en Node) y viajan al worker como binding, porque
// dentro de workerd no hay sistema de ficheros. El setup las aplica antes de
// que corra ningún test.
const migraciones = await readD1Migrations(path.resolve(import.meta.dirname, "../../db/migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["FOTOS"],
        bindings: {
          SESSION_SECRET: "secreto-de-test",
          TEST_MIGRATIONS: migraciones,
          // Vacíos a propósito: sin credenciales, gmail.ts no intenta enviar
          // nada y ningún test habla con Google.
          GMAIL_CLIENT_ID: "",
          GMAIL_CLIENT_SECRET: "",
          GMAIL_REFRESH_TOKEN: "",
          TURNSTILE_SECRET_KEY: "",
          GOOGLE_CLIENT_ID: ""
        }
      }
    })
  ],
  test: {
    name: "integration",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    setupFiles: ["./setup.ts"],
    // Los 5 s por defecto de Vitest son para tests en memoria. Aquí cada test
    // habla con una D1 de verdad dentro de workerd, y el `afterEach` del setup
    // vacía y resiembra todas las tablas. Los de anotación son los más largos
    // con diferencia: recorren un partido punto a punto y cada punto recalcula
    // el marcador entero desde el log, que es justamente el diseño (hay UN solo
    // camino de recálculo). Uno de ~6 s cabe de sobra suelto, pero se pasaba de
    // los 5 s cuando corre toda la suite en paralelo, y fallaba un test
    // distinto en cada ejecución.
    //
    // Subir el techo no debilita ninguna aserción: un timeout no comprueba
    // nada. Sigue habiendo tope para que un test colgado no bloquee la suite.
    testTimeout: 30000
  }
});
