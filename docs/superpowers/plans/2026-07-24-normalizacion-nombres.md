# Normalización de nombres y ocultación del segundo apellido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store jugador `nombre`/`apellidos` in Proper Case (with correct tildes when known) on every future save, backfill existing rows via an admin action, and show only Nombre + primer apellido to anyone who isn't the record's own owner.

**Architecture:** A new pure-function module (`functions/_lib/nombres.ts`) provides `capitalizarPropio` (Proper Case + dictionary-based tilde restoration) and `primerApellido` (first-token truncation). It's wired into the existing validation path (`functions/_lib/validacion.ts`, shared by alta and edición) so all future writes are normalized, into the public `GET /api/equipos` handler so third parties only ever see the first surname, and into a new admin-only batch action (`POST /api/admin?type=normalizar-nombres`) that backfills existing rows.

**Tech Stack:** Astro 5 (static) + Cloudflare Pages Functions + D1 (SQLite). No test framework in this repo (`npm run build` — astro check + astro build — is the only automated verification per `CLAUDE.md`); this plan uses disposable `npx tsx` smoke scripts for pure-function logic and real `wrangler pages dev` + `wrangler d1 execute --local` round trips for anything that touches HTTP/D1, mirroring how this project is actually tested today.

## Global Constraints

- Git Flow: branch from `development`, prefix `feature/`, merge back into `development` only — never touch `main` (`CLAUDE.md`).
- `npm run build` (astro check + astro build) must stay clean; it's the only CI-equivalent gate.
- Spanish copy uses proper accents/diacritics.
- Admin panel (`GET /api/admin`) and "Mi equipo" (`GET /api/mi-equipo`) keep returning full `apellidos` — only the public `GET /api/equipos` truncates to the first surname. (Confirmed with the user; do not extend truncation to those two endpoints.)
- The dictionary in `capitalizarPropio` only ever restores accents (á/é/í/ó/ú) on a word it recognizes exactly; it never changes a base letter (in particular, never turns a plain `n` into `ñ`) and never touches words it doesn't recognize.
- Team name (`equipos.nombre`) and `usuarios.nombre` (Google-sourced) are out of scope — only `jugadores.nombre` / `jugadores.apellidos`.

---

### Task 0: Branch setup

- [ ] **Step 1: Create the feature branch from `development`**

```bash
git checkout development
git pull
git checkout -b feature/normalizar-nombres-jugadores
```

---

### Task 1: `functions/_lib/nombres.ts` — Proper Case + tilde dictionary

**Files:**
- Create: `functions/_lib/nombres.ts`
- Test (temporary, deleted at end of task): `functions/_lib/nombres.smoke.ts`

**Interfaces:**
- Produces: `capitalizarPropio(texto: string): string`, `primerApellido(apellidos: string): string` — both pure, no I/O. Later tasks (`validacion.ts`, `equipos.ts`, `admin.ts`) import these by name.

- [ ] **Step 1: Write the smoke test**

Create `functions/_lib/nombres.smoke.ts`:

```ts
// functions/_lib/nombres.smoke.ts (temporal, se borra tras verificar)
import { capitalizarPropio, primerApellido } from "./nombres";

const casosCapitalizar: [string, string][] = [
  ["IAGO", "Iago"],
  ["garcia", "García"],
  ["MARIA JOSE NUÑEZ", "María José Núñez"],
  ["xenofonte piñeiro", "Xenofonte Piñeiro"],
  ["o'donnell", "O'Donnell"],
  ["jose-maria lopez", "José-María López"]
];

let fallos = 0;
for (const [entrada, esperado] of casosCapitalizar) {
  const real = capitalizarPropio(entrada);
  if (real !== esperado) {
    fallos++;
    console.error(`capitalizarPropio(${JSON.stringify(entrada)}) = ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);
  }
}

const casosPrimerApellido: [string, string][] = [
  ["García Hermida", "García"],
  ["Núñez", "Núñez"],
  ["  López   Pérez  ", "López"]
];

for (const [entrada, esperado] of casosPrimerApellido) {
  const real = primerApellido(entrada);
  if (real !== esperado) {
    fallos++;
    console.error(`primerApellido(${JSON.stringify(entrada)}) = ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);
  }
}

if (fallos > 0) {
  console.error(`${fallos} caso(s) fallaron.`);
  process.exit(1);
}
console.log("OK: capitalizarPropio y primerApellido se comportan como se espera.");
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx --yes tsx functions/_lib/nombres.smoke.ts`
Expected: fails with a module-resolution error (`./nombres` doesn't exist yet).

- [ ] **Step 3: Create `functions/_lib/nombres.ts`**

```ts
// functions/_lib/nombres.ts
// Normaliza nombres/apellidos de jugadores a Proper Case. Cuando una palabra
// completa coincide (sin tildes, en minúsculas) con una entrada del
// diccionario de nombres/apellidos españoles y gallegos frecuentes, se usa
// su forma con tilde correcta. Fuera del diccionario solo se capitaliza: no
// se inventan tildes ni se cambian letras (una "ñ" que el usuario no
// escribió nunca se añade).

const DICCIONARIO: Record<string, string> = {
  // Nombres
  jose: "José",
  maria: "María",
  jesus: "Jesús",
  angel: "Ángel",
  angela: "Ángela",
  angelica: "Angélica",
  ruben: "Rubén",
  andres: "Andrés",
  ivan: "Iván",
  oscar: "Óscar",
  adrian: "Adrián",
  sebastian: "Sebastián",
  joaquin: "Joaquín",
  raul: "Raúl",
  victor: "Víctor",
  alvaro: "Álvaro",
  nicolas: "Nicolás",
  martin: "Martín",
  julian: "Julián",
  cristobal: "Cristóbal",
  cesar: "César",
  damian: "Damián",
  elias: "Elías",
  fabian: "Fabián",
  gines: "Ginés",
  hector: "Héctor",
  isaias: "Isaías",
  jeronimo: "Jerónimo",
  jonas: "Jonás",
  leon: "León",
  maximo: "Máximo",
  moises: "Moisés",
  nestor: "Néstor",
  ramon: "Ramón",
  saul: "Saúl",
  simon: "Simón",
  tomas: "Tomás",
  anibal: "Aníbal",
  adan: "Adán",
  agustin: "Agustín",
  benjamin: "Benjamín",
  fermin: "Fermín",
  german: "Germán",
  lazaro: "Lázaro",
  matias: "Matías",
  roman: "Román",
  salomon: "Salomón",
  teofilo: "Teófilo",
  valentin: "Valentín",
  xoan: "Xoán",
  monica: "Mónica",
  veronica: "Verónica",
  barbara: "Bárbara",
  africa: "África",
  agueda: "Águeda",
  belen: "Belén",
  eloisa: "Eloísa",
  erika: "Érika",
  fatima: "Fátima",
  ines: "Inés",
  lucia: "Lucía",
  rosalia: "Rosalía",
  sofia: "Sofía",
  aida: "Aída",
  asuncion: "Asunción",
  aurea: "Áurea",
  brigida: "Brígida",
  concepcion: "Concepción",
  rocio: "Rocío",
  // Apellidos
  garcia: "García",
  rodriguez: "Rodríguez",
  gonzalez: "González",
  fernandez: "Fernández",
  lopez: "López",
  martinez: "Martínez",
  sanchez: "Sánchez",
  perez: "Pérez",
  gomez: "Gómez",
  jimenez: "Jiménez",
  gimenez: "Giménez",
  hernandez: "Hernández",
  diaz: "Díaz",
  alvarez: "Álvarez",
  "nuñez": "Núñez",
  dominguez: "Domínguez",
  gutierrez: "Gutiérrez",
  vazquez: "Vázquez",
  ramirez: "Ramírez",
  suarez: "Suárez",
  "ibañez": "Ibáñez",
  cortes: "Cortés",
  marquez: "Márquez",
  velazquez: "Velázquez",
  saenz: "Sáenz",
  paez: "Páez",
  baez: "Báez",
  valdes: "Valdés",
  cordoba: "Córdoba",
  avila: "Ávila",
  galvan: "Galván",
  beltran: "Beltrán",
  "zuñiga": "Zúñiga",
  bermudez: "Bermúdez",
  galan: "Galán",
  rua: "Rúa",
  novoa: "Nóvoa",
  boveda: "Bóveda",
  dieguez: "Diéguez"
};

function quitarTildes(palabra: string): string {
  return palabra
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u");
}

function capitalizarToken(token: string): string {
  const minuscula = token.toLowerCase();
  const clave = quitarTildes(minuscula);
  const conocido = DICCIONARIO[clave];
  if (conocido) return conocido;
  return minuscula.replace(/(^|['])(\p{L})/gu, (_, previo, letra) => previo + letra.toUpperCase());
}

function capitalizarPalabra(palabra: string): string {
  return palabra
    .split("-")
    .map((token) => capitalizarToken(token))
    .join("-");
}

/**
 * Convierte un nombre o apellidos a Proper Case, restituyendo la tilde
 * correcta cuando la palabra coincide con el diccionario.
 */
export function capitalizarPropio(texto: string): string {
  return texto
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((palabra) => (palabra ? capitalizarPalabra(palabra) : palabra))
    .join(" ");
}

/** Devuelve solo el primer apellido (primer token) de una cadena de apellidos. */
export function primerApellido(apellidos: string): string {
  return apellidos.trim().split(/\s+/)[0] ?? "";
}
```

- [ ] **Step 4: Run the smoke test again and confirm it passes**

Run: `npx --yes tsx functions/_lib/nombres.smoke.ts`
Expected: `OK: capitalizarPropio y primerApellido se comportan como se espera.`

- [ ] **Step 5: Delete the smoke test and type-check**

```bash
rm functions/_lib/nombres.smoke.ts
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/nombres.ts
git commit -m "feat: normalizar nombres/apellidos de jugadores a Proper Case"
```

---

### Task 2: Apply `capitalizarPropio` on every save (alta y edición)

**Files:**
- Modify: `functions/_lib/validacion.ts:1-4` (import), `:99-107` (nombre/apellidos assignment)
- Test (temporary): `functions/_lib/validacion.smoke.ts`

**Interfaces:**
- Consumes: `capitalizarPropio` from `./nombres` (Task 1).
- Produces: `validarRegistro(...).registro.jugadores[i].nombre/apellidos` now Proper Case — `functions/api/equipos.ts` (POST) and `functions/api/mi-equipo.ts` (PATCH) already call `validarRegistro` and store its output verbatim, so no change needed in either of those files for this task.

- [ ] **Step 1: Write the smoke test**

Create `functions/_lib/validacion.smoke.ts`:

```ts
// functions/_lib/validacion.smoke.ts (temporal, se borra tras verificar)
import { validarRegistro } from "./validacion";

const payload = {
  equipo: "Equipo Smoke",
  consentimiento: true,
  jugadores: [
    { nombre: "IAGO", apellidos: "GARCIA HERMIDA", telefono: "611111111", email: "iago@example.com" },
    { nombre: "maria jose", apellidos: "nuñez lopez", telefono: "622222222", email: "maria@example.com" }
  ]
};

const resultado = validarRegistro(payload, { ownerEmail: "iago@example.com" });
if (!("registro" in resultado)) {
  console.error("Se esperaba un registro válido, llegaron errores:", resultado.campos);
  process.exit(1);
}

const [j1, j2] = resultado.registro.jugadores;
const esperado = {
  j1nombre: "Iago",
  j1apellidos: "García Hermida",
  j2nombre: "María José",
  j2apellidos: "Núñez López"
};

if (
  j1.nombre !== esperado.j1nombre ||
  j1.apellidos !== esperado.j1apellidos ||
  j2.nombre !== esperado.j2nombre ||
  j2.apellidos !== esperado.j2apellidos
) {
  console.error("Normalización inesperada:", { j1, j2 }, "esperado:", esperado);
  process.exit(1);
}
console.log("OK: validarRegistro aplica capitalizarPropio a nombre y apellidos.");
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx --yes tsx functions/_lib/validacion.smoke.ts`
Expected: fails — `j1.nombre` is `"IAGO"`, not `"Iago"` yet.

- [ ] **Step 3: Wire `capitalizarPropio` into `validarRegistro`**

In `functions/_lib/validacion.ts`, add the import after the existing top comment (before `export const MIN_JUGADORES = 2;`):

```ts
import { capitalizarPropio } from "./nombres";
```

Then replace:

```ts
    const nombre = limpiar(j.nombre);
    if (nombre.length < 2 || nombre.length > 60 || !NOMBRE_PATTERN.test(nombre)) {
      campos[clave("nombre")] = "Introduce el nombre (solo letras, entre 2 y 60 caracteres).";
    }

    const apellidos = limpiar(j.apellidos);
    if (apellidos.length < 2 || apellidos.length > 80 || !NOMBRE_PATTERN.test(apellidos)) {
      campos[clave("apellidos")] = "Introduce los apellidos (solo letras, entre 2 y 80 caracteres).";
    }
```

with:

```ts
    const nombre = capitalizarPropio(limpiar(j.nombre));
    if (nombre.length < 2 || nombre.length > 60 || !NOMBRE_PATTERN.test(nombre)) {
      campos[clave("nombre")] = "Introduce el nombre (solo letras, entre 2 y 60 caracteres).";
    }

    const apellidos = capitalizarPropio(limpiar(j.apellidos));
    if (apellidos.length < 2 || apellidos.length > 80 || !NOMBRE_PATTERN.test(apellidos)) {
      campos[clave("apellidos")] = "Introduce los apellidos (solo letras, entre 2 y 80 caracteres).";
    }
```

- [ ] **Step 4: Run the smoke test again and confirm it passes**

Run: `npx --yes tsx functions/_lib/validacion.smoke.ts`
Expected: `OK: validarRegistro aplica capitalizarPropio a nombre y apellidos.`

- [ ] **Step 5: Delete the smoke test and type-check**

```bash
rm functions/_lib/validacion.smoke.ts
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/validacion.ts
git commit -m "feat: capitalizar nombre y apellidos al validar altas y ediciones de equipo"
```

---

### Task 3: Truncar a primer apellido en el listado público

**Files:**
- Modify: `functions/api/equipos.ts:1-13` (import), `:230-236` (mapeo de jugador en `onRequestGet`)

**Interfaces:**
- Consumes: `primerApellido` from `../_lib/nombres` (Task 1).
- Produces: `GET /api/equipos` response `equipos[].jugadores[].apellidos` is now only the first token.

- [ ] **Step 1: Add the import**

In `functions/api/equipos.ts`, after the existing `import { json } from "../_lib/http";` block, add:

```ts
import { primerApellido } from "../_lib/nombres";
```

- [ ] **Step 2: Truncate in the public GET handler**

Replace:

```ts
      if (fila.jugador_nombre) {
        equipo.jugadores.push({
          nombre: fila.jugador_nombre,
          apellidos: fila.jugador_apellidos ?? "",
          instagram: fila.red_social
        });
      }
```

with:

```ts
      if (fila.jugador_nombre) {
        equipo.jugadores.push({
          nombre: fila.jugador_nombre,
          apellidos: primerApellido(fila.jugador_apellidos ?? ""),
          instagram: fila.red_social
        });
      }
```

- [ ] **Step 3: Type-check**

```bash
npm run build
```

- [ ] **Step 4: End-to-end check against local D1**

Start the local server in the background (build first if you haven't already run Step 3's `npm run build` in this shell session):

```bash
npx wrangler pages dev dist --port 8788
```

In a second shell, seed a throwaway team + player with a two-word `apellidos`:

```bash
npx wrangler d1 execute copa-arena-db --local --command "INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at) VALUES ('Equipo Smoke Test', 'equipo smoke test truncado', '2026-07-24T00:00:00.000Z');"
npx wrangler d1 execute copa-arena-db --local --command "INSERT INTO jugadores (equipo_id, nombre, apellidos, nombre_completo_normalizado, telefono, telefono_normalizado, es_suplente, orden) VALUES ((SELECT id FROM equipos WHERE nombre_normalizado='equipo smoke test truncado'), 'Iago', 'Garcia Hermida', 'iago garcia hermida truncadosmoke', '699000001', '699000001', 0, 1);"
curl -s http://127.0.0.1:8788/api/equipos
```

Expected: the JSON contains `"nombre":"Equipo Smoke Test"` with a jugador `"nombre":"Iago","apellidos":"Garcia"` — note `apellidos` is only the first word (`Garcia`, not `Garcia Hermida`). (The seeded values aren't run through `capitalizarPropio` — that's Task 2's job on the write path, not this read path — so the casing here is whatever was inserted; only the *truncation* is what this task checks.)

- [ ] **Step 5: Clean up the seeded rows and stop the server**

```bash
npx wrangler d1 execute copa-arena-db --local --command "DELETE FROM jugadores WHERE nombre_completo_normalizado = 'iago garcia hermida truncadosmoke';"
npx wrangler d1 execute copa-arena-db --local --command "DELETE FROM equipos WHERE nombre_normalizado = 'equipo smoke test truncado';"
```

Stop the `wrangler pages dev` process (Ctrl+C, or kill the backgrounded process).

- [ ] **Step 6: Commit**

```bash
git add functions/api/equipos.ts
git commit -m "feat: no exponer el segundo apellido en el listado publico de equipos"
```

---

### Task 4: Backfill de admin — `POST /api/admin?type=normalizar-nombres`

**Files:**
- Modify: `functions/api/admin.ts` (new interface, new exported pure function, new branch in `onRequestPost`)
- Test (temporary): `functions/api/admin.smoke.ts`, `functions/_lib/session.smoke.mjs`
- May modify: `.dev.vars` (add `SESSION_SECRET` for local testing only — this file is gitignored)

**Interfaces:**
- Consumes: `capitalizarPropio` from `../_lib/nombres` (Task 1).
- Produces: exported `calcularNombresNormalizados(jugadores: {id:number; nombre:string; apellidos:string}[]): {id:number; nombre:string; apellidos:string}[]` (pure — returns only the rows that changed, already normalized) and the HTTP action `POST /api/admin?type=normalizar-nombres` → `{ ok: true, actualizados: number }`.

- [ ] **Step 1: Write the pure-function smoke test**

Create `functions/api/admin.smoke.ts`:

```ts
// functions/api/admin.smoke.ts (temporal, se borra tras verificar)
import { calcularNombresNormalizados } from "./admin";

const entrada = [
  { id: 1, nombre: "IAGO", apellidos: "GARCIA HERMIDA" },
  { id: 2, nombre: "Ya Bien", apellidos: "Puesto Ya" }
];

const cambios = calcularNombresNormalizados(entrada);

if (cambios.length !== 1) {
  console.error(`Se esperaba 1 cambio, hubo ${cambios.length}:`, cambios);
  process.exit(1);
}
const [cambio] = cambios;
if (cambio.id !== 1 || cambio.nombre !== "Iago" || cambio.apellidos !== "García Hermida") {
  console.error("Cambio inesperado:", cambio);
  process.exit(1);
}
console.log("OK: calcularNombresNormalizados solo devuelve las filas que cambian, ya normalizadas.");
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx --yes tsx functions/api/admin.smoke.ts`
Expected: fails — `calcularNombresNormalizados` isn't exported yet.

- [ ] **Step 3: Implement the pure function and the HTTP action**

In `functions/api/admin.ts`, add the import at the top (alongside the existing imports):

```ts
import { capitalizarPropio } from "../_lib/nombres";
```

Add this interface and function anywhere after the existing interfaces (e.g. right after `JugadorRow`):

```ts
interface JugadorNombreRow {
  id: number;
  nombre: string;
  apellidos: string;
}

export function calcularNombresNormalizados(jugadores: JugadorNombreRow[]): JugadorNombreRow[] {
  return jugadores.reduce<JugadorNombreRow[]>((cambios, jugador) => {
    const nombre = capitalizarPropio(jugador.nombre);
    const apellidos = capitalizarPropio(jugador.apellidos);
    if (nombre !== jugador.nombre || apellidos !== jugador.apellidos) {
      cambios.push({ id: jugador.id, nombre, apellidos });
    }
    return cambios;
  }, []);
}

async function normalizarNombresJugadores(db: D1Database): Promise<Response> {
  const { results } = await db.prepare("SELECT id, nombre, apellidos FROM jugadores").all<JugadorNombreRow>();
  const cambios = calcularNombresNormalizados(results);
  if (cambios.length > 0) {
    await db.batch(
      cambios.map((c) =>
        db.prepare("UPDATE jugadores SET nombre = ?1, apellidos = ?2 WHERE id = ?3").bind(c.nombre, c.apellidos, c.id)
      )
    );
  }
  return json({ ok: true, actualizados: cambios.length }, 200, { "Cache-Control": "no-store" });
}
```

Then change the start of `onRequestPost` from:

```ts
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (type !== "camiseta") {
    return json({ error: "La acción no es válida." }, 400);
  }
```

to:

```ts
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  if (type === "normalizar-nombres") {
    try {
      return await normalizarNombresJugadores(env.DB);
    } catch (err) {
      console.error("Error normalizando nombres desde panel admin:", err);
      return json({ error: "No se ha podido normalizar los nombres." }, 500, { "Cache-Control": "no-store" });
    }
  }

  if (type !== "camiseta") {
    return json({ error: "La acción no es válida." }, 400);
  }
```

(The rest of `onRequestPost` — the `camiseta` branch — is unchanged.)

- [ ] **Step 4: Run the smoke test again and confirm it passes**

Run: `npx --yes tsx functions/api/admin.smoke.ts`
Expected: `OK: calcularNombresNormalizados solo devuelve las filas que cambian, ya normalizadas.`

- [ ] **Step 5: Delete the smoke test and type-check**

```bash
rm functions/api/admin.smoke.ts
npm run build
```

- [ ] **Step 6: End-to-end check of the HTTP action against local D1**

This endpoint requires an admin session cookie. Forge one locally (same HMAC scheme as `functions/_lib/auth.ts`) instead of doing a real Google login:

Check whether `.dev.vars` already has `SESSION_SECRET`:

```bash
grep SESSION_SECRET .dev.vars
```

If it's missing, append a local-only value (the file is gitignored, this never reaches git):

```bash
echo "SESSION_SECRET=local-dev-secret-normalizar-nombres" >> .dev.vars
```

Create `functions/_lib/session.smoke.mjs`:

```js
// functions/_lib/session.smoke.mjs (temporal, se borra tras verificar)
import { webcrypto } from "node:crypto";

const [, , secret, uidRaw] = process.argv;
const uid = Number(uidRaw);

function b64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const payload = JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 3600 });
const payloadPart = b64url(Buffer.from(payload));
const key = await webcrypto.subtle.importKey(
  "raw",
  Buffer.from(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const signatureBytes = await webcrypto.subtle.sign("HMAC", key, Buffer.from(payloadPart));
const signature = b64url(new Uint8Array(signatureBytes));
console.log(`${payloadPart}.${signature}`);
```

Restart `wrangler pages dev` (it needs to pick up the `.dev.vars` change) and, in a second shell, seed an admin user and a jugador with mixed-case data:

```bash
npx wrangler pages dev dist --port 8788
```

```bash
npx wrangler d1 execute copa-arena-db --local --command "INSERT INTO usuarios (google_sub, email, email_verified, nombre, is_admin) VALUES ('smoke-test-admin', 'smoke-admin@example.com', 1, 'Admin Smoke', 1);"
npx wrangler d1 execute copa-arena-db --local --command "INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at, owner_user_id) VALUES ('Equipo Backfill Test', 'equipo backfill test', '2026-07-24T00:00:00.000Z', (SELECT id FROM usuarios WHERE google_sub='smoke-test-admin'));"
npx wrangler d1 execute copa-arena-db --local --command "INSERT INTO jugadores (equipo_id, nombre, apellidos, nombre_completo_normalizado, telefono, telefono_normalizado, es_suplente, orden) VALUES ((SELECT id FROM equipos WHERE nombre_normalizado='equipo backfill test'), 'IAGO', 'GARCIA HERMIDA', 'iago garcia hermida backfillsmoke', '699000002', '699000002', 0, 1);"

ADMIN_UID=$(npx wrangler d1 execute copa-arena-db --local --command "SELECT id FROM usuarios WHERE google_sub='smoke-test-admin';" --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0].results[0].id))")
COOKIE=$(node functions/_lib/session.smoke.mjs "local-dev-secret-normalizar-nombres" "$ADMIN_UID")

curl -s -X POST "http://127.0.0.1:8788/api/admin?type=normalizar-nombres" -H "Cookie: copa_session=${COOKIE}" -H "Accept: application/json"
```

Expected: a JSON response `{"ok":true,"actualizados":N}` with `N >= 1` (there may be other pre-existing mixed-case rows in your local DB too — that's fine).

Confirm the seeded row specifically got normalized:

```bash
npx wrangler d1 execute copa-arena-db --local --command "SELECT nombre, apellidos FROM jugadores WHERE nombre_completo_normalizado = 'iago garcia hermida backfillsmoke';"
```

Expected: `nombre` is `Iago`, `apellidos` is `García Hermida`.

Run the same POST curl command a second time — expected `"actualizados":0` for this row (idempotent).

- [ ] **Step 7: Clean up**

```bash
npx wrangler d1 execute copa-arena-db --local --command "DELETE FROM jugadores WHERE nombre_completo_normalizado = 'iago garcia hermida backfillsmoke';"
npx wrangler d1 execute copa-arena-db --local --command "DELETE FROM equipos WHERE nombre_normalizado = 'equipo backfill test';"
npx wrangler d1 execute copa-arena-db --local --command "DELETE FROM usuarios WHERE google_sub = 'smoke-test-admin';"
rm functions/_lib/session.smoke.mjs
```

Stop `wrangler pages dev`. If you added `SESSION_SECRET` to `.dev.vars` in this step and it wasn't there before, you may leave it — it's needed again for Task 5's manual check and for any future local auth testing, and it never leaves your machine.

- [ ] **Step 8: Commit**

```bash
git add functions/api/admin.ts
git commit -m "feat: accion de admin para normalizar nombres de jugadores existentes"
```

---

### Task 5: Botón "Normalizar nombres" en el panel admin

**Files:**
- Modify: `src/pages/admin.astro:69-78` (Equipos panel head)
- Modify: `public/assets/admin.js:1-14` (element refs), append a `normalizeNames` function, wire the click listener

**Interfaces:**
- Consumes: `POST /api/admin?type=normalizar-nombres` (Task 4), reusing the existing `.admin-actions` / `.add-player` markup pattern already used in the "Partidos" panel — no new CSS needed.

- [ ] **Step 1: Add the button in `admin.astro`**

Replace:

```astro
        <article class="teams-panel admin-panel">
          <div class="admin-panel-head">
            <div>
              <p class="eyebrow">Equipos</p>
              <h2>Equipos registrados</h2>
            </div>
            <button type="button" class="add-player" data-admin-refresh>Actualizar</button>
          </div>
          <div class="admin-list" data-admin-teams></div>
        </article>
```

with:

```astro
        <article class="teams-panel admin-panel">
          <div class="admin-panel-head">
            <div>
              <p class="eyebrow">Equipos</p>
              <h2>Equipos registrados</h2>
            </div>
            <div class="admin-actions">
              <button type="button" class="add-player" data-admin-normalize>Normalizar nombres</button>
              <button type="button" class="add-player" data-admin-refresh>Actualizar</button>
            </div>
          </div>
          <div class="admin-list" data-admin-teams></div>
        </article>
```

- [ ] **Step 2: Wire it in `admin.js`**

In `public/assets/admin.js`, add the element reference next to the existing ones near the top:

```js
  const refresh = root.querySelector("[data-admin-refresh]");
  const normalize = root.querySelector("[data-admin-normalize]");
```

(replacing the existing single `const refresh = root.querySelector("[data-admin-refresh]");` line with both lines above)

Add this function right after `deleteItem`:

```js
  async function normalizeNames() {
    if (!window.confirm("¿Normalizar mayúsculas y tildes en los nombres de todos los jugadores?")) return;
    try {
      const response = await fetch("/api/admin?type=normalizar-nombres", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido normalizar los nombres.");
      window.alert(`Nombres actualizados: ${data.actualizados}.`);
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido normalizar los nombres.");
    }
  }
```

And add the listener next to the existing `refresh?.addEventListener(...)` line:

```js
  refresh?.addEventListener("click", loadAdmin);
  normalize?.addEventListener("click", normalizeNames);
```

- [ ] **Step 3: Type-check**

```bash
npm run build
```

(`astro check` validates the `.astro` markup; `admin.js` is plain JS served as-is, same as every other file in `public/assets/`.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin.astro public/assets/admin.js
git commit -m "feat: boton de admin para normalizar nombres de jugadores"
```

---

### Task 6: Manual QA (requires a real Google login — can't be automated)

This task can't be delegated to a subagent: it needs an actual Google OAuth session in the browser against the deployed admin account. Do this yourself once before considering the feature done:

- [ ] Run `npm run build && npx wrangler pages dev dist --port 8788`, open `http://127.0.0.1:8788/inscripcion/`, register a test team with a lowercase/uppercase mixed player name (e.g. `iago`/`GARCIA`), and confirm the confirmation flow succeeds.
- [ ] Open `http://127.0.0.1:8788/mi-equipo/` logged in as that team's owner: confirm the player now shows as `Iago` / `Garcia` (Proper Case) — full apellidos, not truncated.
- [ ] Open `http://127.0.0.1:8788/equipos/`, expand that team: confirm only `Iago García`-style first-surname names show, never a second surname.
- [ ] Log in as an admin (`is_admin = 1` user), open `http://127.0.0.1:8788/admin/`: confirm players still show full apellidos, click "Normalizar nombres", confirm the alert shows a count and the list still reads correctly afterwards.
- [ ] Check the page at both a mobile width (~390px) and desktop width to confirm the new button doesn't break the "Equipos" panel header layout (per `CLAUDE.md`'s responsive requirement — it reuses the already-responsive `.admin-actions` pattern from the "Partidos" panel, so this should just be a quick confirmation, not new work).
- [ ] Delete any test data created during this manual pass from D1 (local and, if you tested against a deployed preview, remote too).

---

## Self-Review Notes

- **Spec coverage:** Backfill of existing data → Task 4. Proper Case on future writes → Task 2. First-surname-only in public listing → Task 3. Admin/Mi equipo keep full apellidos → unchanged by design (no task touches those read paths). Dictionary-based tilde restoration, best-effort → Task 1.
- **Type consistency:** `capitalizarPropio`/`primerApellido` (Task 1) are imported with the same names and signatures in Tasks 2, 3 and 4. `calcularNombresNormalizados`'s row shape (`{id, nombre, apellidos}`) matches the `JugadorNombreRow` interface used both for the D1 `SELECT` and the smoke test fixture in Task 4.
- **No placeholders:** every step above has literal, complete code — no "similar to Task N" or "add validation" left unstated.
