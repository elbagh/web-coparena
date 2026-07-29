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
    /*
     * Los 5 s por defecto de vitest son para tests puros. Aquí cada test levanta
     * workerd, aplica migraciones, escribe en D1 de verdad y encima el setup
     * vacía y resiembra las tablas entre tests. Varios rondaban los 5 s y solo
     * caían cuando `unit`, `integration` y `e2e` competían por la máquina: un
     * rojo que no dice nada del código y que esconde los que sí.
     *
     * 20 s da margen sin dejar de cazar un test colgado de verdad.
     */
    testTimeout: 20000
  }
});
