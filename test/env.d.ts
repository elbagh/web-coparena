/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// `env` de "cloudflare:test" es Cloudflare.Env: se declaran aquí los bindings
// que monta test/integration/vitest.config.ts.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      FOTOS: R2Bucket;
      SESSION_SECRET: string;
      TEST_MIGRATIONS: D1Migration[];
      // Secretos que declaran los endpoints en su propia interfaz Env. Van
      // vacíos en los tests: sin ellos, gmail.ts se salta el envío y el
      // registro responde `emailEnviado: false`, que es justo lo que interesa
      // comprobar sin hablar con Google.
      GMAIL_CLIENT_ID: string;
      GMAIL_CLIENT_SECRET: string;
      GMAIL_REFRESH_TOKEN: string;
      TURNSTILE_SECRET_KEY: string;
      GOOGLE_CLIENT_ID: string;
    }
  }
}

export {};
