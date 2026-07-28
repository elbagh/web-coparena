import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Este proyecto NO importa handlers: pega peticiones al bundle que genera
// `npm run build:worker`, que es el único sitio donde se puede comprobar que el
// middleware está realmente enganchado a todas las rutas.
const worker = path.resolve(import.meta.dirname, "../../.worker/index.js");
const migraciones = await readD1Migrations(path.resolve(import.meta.dirname, "../../db/migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: worker,
      miniflare: {
        compatibilityDate: "2026-07-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["FOTOS"],
        bindings: {
          SESSION_SECRET: "secreto-de-test",
          TEST_MIGRATIONS: migraciones,
          GMAIL_CLIENT_ID: "",
          GMAIL_CLIENT_SECRET: "",
          GMAIL_REFRESH_TOKEN: "",
          TURNSTILE_SECRET_KEY: "",
          GOOGLE_CLIENT_ID: ""
        },
        // El bundle de Pages delega en ASSETS cualquier ruta sin handler. Aquí
        // no hay sitio estático, así que un stub evita fallos confusos si algún
        // día un test pide una ruta que no existe.
        serviceBindings: {
          ASSETS: () => new Response("stub de assets", { status: 404 })
        }
      }
    })
  ],
  test: {
    name: "e2e",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    setupFiles: ["../integration/setup.ts"]
  }
});
