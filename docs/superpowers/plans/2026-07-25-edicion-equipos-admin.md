# Edición de equipos desde el panel admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins edit a registered team's name and each player's data (name, surnames, phone, email, social, order/titular-suplente, add/remove players, replace or delete a player's photo) from `/admin`, with a mandatory "review changes" confirmation step before saving, and photo thumbnails visible in the panel.

**Architecture:** Two new Pages Functions routes dispatched by the existing `type` query param on `functions/api/admin.ts` (`GET ?type=foto` to stream a private R2 photo, `PATCH ?type=equipo&id=` to save edits via a diff against the current DB rows so untouched players keep their photo). The frontend adds a `<dialog>` to `src/pages/admin.astro` (same pattern as the existing `match-dialog`) driven by new logic in `public/assets/admin.js`, reusing the `.player-card`/`.field` markup and CSS already used by the registration form.

**Tech Stack:** Astro 5 (static), Cloudflare Pages Functions (TypeScript), D1, R2, vanilla JS (`public/assets/admin.js`), no test runner — verification is `npm run build` (runs `astro check`, which type-checks `functions/**/*.ts` too, per `tsconfig.json`'s `"include": ["**/*"]`) plus manual checks with `npx wrangler pages dev dist --port 8788`.

## Global Constraints

- Spanish copy uses proper accents/diacritics; spell the sport "volley" (never "vóley").
- No scoped `<style>` blocks — all CSS goes in `src/styles/global.css` using existing custom properties.
- Base CSS values are the mobile scale; desktop density lives in the single `@media (min-width: 901px)` block starting at `src/styles/global.css:2752` — check whether new components need an entry there.
- `npm run build` (`astro check` + `astro build`) is the only automated verification; there is no test framework.
- Client-side validation in `public/assets/admin.js` must mirror `functions/_lib/validacion.ts` exactly (same patterns/messages), per the existing convention documented for `public/assets/team-form.js`.
- Git Flow: branch from `development` as `feature/editar-equipos-admin`, merge back into `development` when done — never touch `main` directly.
- No revert-after-save / history feature — the pre-save review step is the only safety net (explicit product decision).

---

### Task 1: Compartir validación de duplicados y aceptar `id`/`eliminarFoto` por jugador

**Files:**
- Modify: `functions/_lib/validacion.ts`
- Modify: `functions/_lib/equipos.ts`
- Modify: `functions/api/mi-equipo.ts`

**Interfaces:**
- Produces (used by Task 3 and by `mi-equipo.ts`):
  - `JugadorValidado` gains `id?: number` and `eliminarFoto: boolean`.
  - `functions/_lib/equipos.ts` exports `buscarDuplicadosEdicion(db: D1Database, registro: RegistroValidado, equipoId: number): Promise<Record<string, string>>`.
  - `functions/_lib/equipos.ts` exports `mapearConflictoUnicoEdicion(err: unknown): Record<string, string> | null`.

- [ ] **Step 1: Add `id` and `eliminarFoto` to `JugadorValidado` and parse them in `validarRegistro`**

In `functions/_lib/validacion.ts`, update the interface (around line 12):

```ts
export interface JugadorValidado {
  id?: number;
  nombre: string;
  apellidos: string;
  nombreCompletoNormalizado: string;
  telefono: string;
  telefonoNormalizado: string;
  email: string | null;
  emailNormalizado: string | null;
  redSocial: string | null;
  eliminarFoto: boolean;
}
```

Then, in the `jugadoresRaw.slice(0, MAX_JUGADORES).forEach(...)` loop, right before the existing `jugadores.push({...})` call (around line 145), add:

```ts
    const idRaw = j.id;
    const id =
      typeof idRaw === "number" && Number.isInteger(idRaw) && idRaw > 0
        ? idRaw
        : typeof idRaw === "string" && /^\d+$/.test(idRaw)
          ? Number(idRaw)
          : undefined;
```

And update the `jugadores.push({...})` call to include the two new fields:

```ts
    jugadores.push({
      id,
      nombre,
      apellidos,
      nombreCompletoNormalizado: normalizarTexto(`${nombre} ${apellidos}`),
      telefono,
      telefonoNormalizado,
      email,
      emailNormalizado,
      redSocial,
      eliminarFoto: j.eliminarFoto === true
    });
```

`equipos.ts` and `mi-equipo.ts` never send `id`/`eliminarFoto` in their payloads, so this is additive and doesn't change their behavior.

- [ ] **Step 2: Move `buscarDuplicadosEdicion` and a shared `mapearConflictoUnicoEdicion` into `functions/_lib/equipos.ts`**

Read `functions/api/mi-equipo.ts` lines 178-234 (`buscarDuplicadosEdicion`) and 255-274 (`mapearConflictoUnique`) — these are the functions being relocated.

Append to `functions/_lib/equipos.ts` (after the existing `registroIncluyeEmailUsuario` function):

```ts
export async function buscarDuplicadosEdicion(
  db: D1Database,
  registro: RegistroValidado,
  equipoId: number
): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};

  const equipoExistente = await db
    .prepare("SELECT 1 FROM equipos WHERE nombre_normalizado = ?1 AND id <> ?2")
    .bind(registro.equipoNormalizado, equipoId)
    .first();
  if (equipoExistente) {
    campos.equipo = "Ya hay un equipo inscrito con ese nombre.";
  }

  const nombres = registro.jugadores.map((j) => j.nombreCompletoNormalizado);
  const telefonos = registro.jugadores.map((j) => j.telefonoNormalizado);
  const emails = registro.jugadores.flatMap((j) => (j.emailNormalizado ? [j.emailNormalizado] : []));

  const clausulas = [
    `nombre_completo_normalizado IN (${nombres.map(() => "?").join(",")})`,
    `telefono_normalizado IN (${telefonos.map(() => "?").join(",")})`
  ];
  const binds: (string | number)[] = [...nombres, ...telefonos];
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }
  binds.push(equipoId);

  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (${clausulas.join(" OR ")}) AND equipo_id <> ?`
    )
    .bind(...binds)
    .all<{ nombre_completo_normalizado: string; telefono_normalizado: string; email_normalizado: string | null }>();

  const nombresOcupados = new Set(results.map((r) => r.nombre_completo_normalizado));
  const telefonosOcupados = new Set(results.map((r) => r.telefono_normalizado));
  const emailsOcupados = new Set(results.flatMap((r) => (r.email_normalizado ? [r.email_normalizado] : [])));

  registro.jugadores.forEach((j, i) => {
    if (nombresOcupados.has(j.nombreCompletoNormalizado)) {
      campos[`jugadores.${i}.nombre`] = "Esta persona ya está inscrita en otro equipo.";
    }
    if (telefonosOcupados.has(j.telefonoNormalizado)) {
      campos[`jugadores.${i}.telefono`] = "Este móvil ya está registrado en otra inscripción.";
    }
    if (j.emailNormalizado && emailsOcupados.has(j.emailNormalizado)) {
      campos[`jugadores.${i}.email`] = "Este correo ya está registrado en otra inscripción.";
    }
  });

  return campos;
}

export function mapearConflictoUnicoEdicion(err: unknown): Record<string, string> | null {
  const mensaje = err instanceof Error ? err.message : String(err);
  if (!mensaje.includes("UNIQUE constraint failed")) return null;
  if (mensaje.includes("equipos.nombre_normalizado")) {
    return { equipo: "Ya hay un equipo inscrito con ese nombre." };
  }
  if (mensaje.includes("jugadores.nombre_completo_normalizado")) {
    return { jugadores: "Alguna de las personas ya está inscrita en otro equipo." };
  }
  if (mensaje.includes("jugadores.telefono_normalizado")) {
    return { jugadores: "Alguno de los móviles ya está registrado en otra inscripción." };
  }
  if (mensaje.includes("jugadores.email_normalizado")) {
    return { jugadores: "Alguno de los correos ya está registrado en otra inscripción." };
  }
  return { jugadores: "Hay datos que ya están registrados en otra inscripción." };
}
```

- [ ] **Step 3: Update `mi-equipo.ts` to use the shared helpers and remove the local copies**

In `functions/api/mi-equipo.ts`:

1. Change the import on line 2 from:
   ```ts
   import { equipoDeUsuario, registroIncluyeEmailUsuario } from "../_lib/equipos";
   ```
   to:
   ```ts
   import {
     equipoDeUsuario,
     registroIncluyeEmailUsuario,
     buscarDuplicadosEdicion,
     mapearConflictoUnicoEdicion
   } from "../_lib/equipos";
   ```
2. Delete the local `async function buscarDuplicadosEdicion(...) { ... }` definition (lines 178-234).
3. Delete the local `function mapearConflictoUnique(...) { ... }` definition (lines 255-274).
4. In `onRequestPatch`, change the call `mapearConflictoUnique(err)` (around line 81) to `mapearConflictoUnicoEdicion(err)`. The call to `buscarDuplicadosEdicion(...)` (around line 69) stays the same — it's now imported instead of local.

- [ ] **Step 4: Verify with `npm run build`**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this also confirms `mi-equipo.ts` compiles against the relocated helpers and that the new `JugadorValidado` fields don't break `equipos.ts`/`mi-equipo.ts`, which never read `.id`/`.eliminarFoto`).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/validacion.ts functions/_lib/equipos.ts functions/api/mi-equipo.ts
git commit -m "refactor: compartir deteccion de duplicados de edicion y aceptar id/eliminarFoto por jugador"
```

---

### Task 2: Endpoint para servir la foto de un jugador

**Files:**
- Modify: `functions/api/admin.ts`

**Interfaces:**
- Consumes: `Env.FOTOS?: R2Bucket`, `Env.DB: D1Database` (already declared in `admin.ts`), `requireAdmin` (already imported).
- Produces: `GET /api/admin?type=foto&jugadorId=<id>` — 200 with the raw image bytes and the stored `Content-Type` on success; 404 JSON `{ error }` if the player, its photo, or the R2 object doesn't exist; 403 (via `requireAdmin`) if not an admin.

- [ ] **Step 1: Add the `type=foto` branch to `onRequestGet`**

In `functions/api/admin.ts`, the current `onRequestGet` (line 77) always loads and returns the full panel. Change its start to branch on `type` before doing that work:

```ts
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  if (url.searchParams.get("type") === "foto") {
    return servirFotoJugador(env, url.searchParams.get("jugadorId"));
  }

  try {
    // ...existing body of onRequestGet stays exactly as is...
```

(The rest of the existing `try { ... } catch { ... }` block is unchanged — only the new branch above it is added.)

- [ ] **Step 2: Add the `servirFotoJugador` helper**

Add this function near the other helpers at the bottom of `functions/api/admin.ts` (e.g. right after `cargarCamisetas`):

```ts
async function servirFotoJugador(env: Env, jugadorIdRaw: string | null): Promise<Response> {
  const jugadorId = Number(jugadorIdRaw);
  const noEncontrada = json({ error: "Foto no encontrada." }, 404, { "Cache-Control": "no-store" });
  if (!Number.isInteger(jugadorId) || jugadorId <= 0 || !env.FOTOS) {
    return noEncontrada;
  }

  const jugador = await env.DB
    .prepare("SELECT foto_key FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ foto_key: string | null }>();
  if (!jugador?.foto_key) {
    return noEncontrada;
  }

  const objeto = await env.FOTOS.get(jugador.foto_key);
  if (!objeto) {
    return noEncontrada;
  }

  return new Response(objeto.body, {
    status: 200,
    headers: {
      "Content-Type": objeto.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "no-store"
    }
  });
}
```

- [ ] **Step 3: Verify with `npm run build`**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Manual verification with `wrangler pages dev`**

Run: `npx wrangler pages dev dist --port 8788` (after `npm run build`).

Without a session cookie:
Run: `curl -i "http://127.0.0.1:8788/api/admin?type=foto&jugadorId=1"`
Expected: `401` or `403` (whatever `requireAdmin`/`requireUser` already returns for anonymous requests — matches existing behavior of `GET /api/admin`).

With a real admin session (log in as an admin in the browser at `http://127.0.0.1:8788/admin/`): open devtools Network tab, find a player with `tieneFoto: true` in the `/api/admin` response, then navigate the browser directly to `http://127.0.0.1:8788/api/admin?type=foto&jugadorId=<that id>`.
Expected: the image renders in the browser tab; for a player with no photo or a non-existent id, expect a `404` JSON body.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin.ts
git commit -m "feat: endpoint admin para servir la foto de un jugador"
```

---

### Task 3: Endpoint `PATCH /api/admin?type=equipo&id=` para editar equipo y jugadores

**Files:**
- Modify: `functions/api/admin.ts`

**Interfaces:**
- Consumes: `validarRegistro`, `validarFoto`, `MAX_BODY_BYTES` from `../_lib/validacion`; `buscarDuplicadosEdicion`, `mapearConflictoUnicoEdicion` from `../_lib/equipos` (Task 1); existing `JugadorRow`, `mapJugador`, `Env` in `admin.ts`.
- Produces: `PATCH /api/admin?type=equipo&id=<id>` — multipart body (`payload` JSON + optional `foto_<i>` files). Success: `200 { ok: true, equipo: <same shape as one item of the GET /api/admin "equipos" array> }`. Validation error: `400 { error, campos }`. Duplicate: `409 { error, campos }`. Missing team: `404 { error }`.
- `payload` shape:
  ```ts
  {
    nombre: string;
    jugadores: Array<{
      id?: number;          // omit for a new player
      nombre: string;
      apellidos: string;
      telefono: string;
      email?: string;
      redSocial?: string;
      eliminarFoto?: boolean;
    }>;
  }
  ```
  Array order sets `orden` (1-based) and `es_suplente` (index 0/1 = titular, rest = suplente), matching `equipos.ts`/`mi-equipo.ts`.

- [ ] **Step 1: Add imports and the small photo constants needed for uploads**

At the top of `functions/api/admin.ts`, change the imports (currently just `capitalizarPropio` from `nombres` plus `requireAdmin`/`publicUser`/`json`) to also pull in validation and the shared duplicate helpers:

```ts
import { requireAdmin } from "../_lib/admin";
import { publicUser } from "../_lib/auth";
import { json } from "../_lib/http";
import { capitalizarPropio } from "../_lib/nombres";
import { MAX_BODY_BYTES, validarRegistro, validarFoto } from "../_lib/validacion";
import { buscarDuplicadosEdicion, mapearConflictoUnicoEdicion } from "../_lib/equipos";
```

Add this constant near the top-level `TALLAS` constant (it mirrors the one in `functions/api/equipos.ts`, needed to set R2 `Content-Type` on upload):

```ts
const CONTENT_TYPE_POR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};
```

- [ ] **Step 2: Add a `cargarEquipoConJugadores` helper and a shared `limpiarFotos` helper**

Add near the other loader functions (after `cargarCamisetas`):

```ts
async function cargarEquipoConJugadores(db: D1Database, equipoId: number) {
  const equipo = await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at, u.email AS owner_email, u.nombre AS owner_name
       FROM equipos e
       LEFT JOIN usuarios u ON u.id = e.owner_user_id
       WHERE e.id = ?1`
    )
    .bind(equipoId)
    .first<{ id: number; nombre: string; created_at: string; owner_email: string | null; owner_name: string | null }>();
  if (!equipo) return null;

  const { results: jugadores } = await db
    .prepare(
      `SELECT id, equipo_id, nombre, apellidos, telefono, email, red_social, foto_key, es_suplente, orden
       FROM jugadores WHERE equipo_id = ?1 ORDER BY orden ASC, id ASC`
    )
    .bind(equipoId)
    .all<JugadorRow>();

  return {
    id: equipo.id,
    nombre: equipo.nombre,
    createdAt: equipo.created_at,
    ownerEmail: equipo.owner_email,
    ownerName: equipo.owner_name,
    jugadores: jugadores.map(mapJugador),
    jugadoresTotal: jugadores.length
  };
}

async function limpiarFotos(bucket: R2Bucket | undefined, claves: string[]): Promise<void> {
  if (!bucket) return;
  for (const key of claves) {
    try {
      await bucket.delete(key);
    } catch {
      // Borrado best-effort: si falla queda un objeto huérfano inofensivo.
    }
  }
}
```

`limpiarFotos` replaces the inline `try { await env.FOTOS.delete(...) } catch {}` loop that currently lives inside `borrarEquipo` (around line 333-339). Update `borrarEquipo` to call it instead of its inline loop:

```ts
  if (!env.FOTOS) return true;
  await limpiarFotos(env.FOTOS, results.map((item) => item.foto_key));
  return true;
```

(replacing the existing `for (const item of results) { try { await env.FOTOS.delete(item.foto_key); } catch {} }` block).

- [ ] **Step 3: Add `onRequestPatch`**

Add this exported handler in `functions/api/admin.ts` (e.g. after `onRequestDelete`):

```ts
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const equipoId = Number(url.searchParams.get("id"));
  if (url.searchParams.get("type") !== "equipo" || !Number.isInteger(equipoId) || equipoId <= 0) {
    return json({ error: "La acción no es válida." }, 400);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "La petición es demasiado grande. Cada foto puede ocupar como máximo 4 MB." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "El formulario debe enviarse como multipart/form-data." }, 400);
  }

  const payloadRaw = formData.get("payload");
  let payload: unknown;
  try {
    payload = JSON.parse(typeof payloadRaw === "string" ? payloadRaw : "");
  } catch {
    return json({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarRegistro(payload, { requireConsent: false, requirePlayerEmail: true });
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }
  const registro = resultado.registro;

  const equipoActual = await env.DB.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
  if (!equipoActual) {
    return json({ error: "Ese equipo ya no existe." }, 404, { "Cache-Control": "no-store" });
  }

  const { results: jugadoresActuales } = await env.DB
    .prepare("SELECT id, foto_key FROM jugadores WHERE equipo_id = ?1")
    .bind(equipoId)
    .all<{ id: number; foto_key: string | null }>();
  const actualesPorId = new Map(jugadoresActuales.map((j) => [j.id, j.foto_key]));

  for (const j of registro.jugadores) {
    if (j.id !== undefined && !actualesPorId.has(j.id)) {
      return json({ error: "Alguno de los jugadores no pertenece a este equipo." }, 400);
    }
  }

  const duplicados = await buscarDuplicadosEdicion(env.DB, registro, equipoId);
  if (Object.keys(duplicados).length > 0) {
    return json({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409, { "Cache-Control": "no-store" });
  }

  // Fotos nuevas: validar por tamaño/tipo/magic bytes antes de tocar R2 o D1.
  const fotosNuevas = new Map<number, { buffer: ArrayBuffer; ext: "jpg" | "png" | "webp" }>();
  const camposFoto: Record<string, string> = {};
  for (let i = 0; i < registro.jugadores.length; i++) {
    const entrada = formData.get(`foto_${i}`);
    if (!(entrada instanceof File) || entrada.size === 0) continue;
    const buffer = await entrada.arrayBuffer();
    const foto = validarFoto(buffer, entrada.type, entrada.size);
    if ("error" in foto) {
      camposFoto[`jugadores.${i}.foto`] = foto.error;
    } else {
      fotosNuevas.set(i, { buffer, ext: foto.ext });
    }
  }
  if (Object.keys(camposFoto).length > 0) {
    return json({ error: "Revisa los campos marcados.", campos: camposFoto }, 400);
  }
  if (fotosNuevas.size > 0 && !env.FOTOS) {
    return json({ error: "No se han podido guardar las fotos." }, 500);
  }

  // Subida de fotos nuevas a R2 (antes del batch de D1, igual que en equipos.ts).
  const clavesNuevas: string[] = [];
  const clavePorIndice = new Map<number, string>();
  if (env.FOTOS) {
    const lote = crypto.randomUUID();
    try {
      for (const [i, foto] of fotosNuevas) {
        const key = `equipos/${lote}/jugador-${i + 1}.${foto.ext}`;
        await env.FOTOS.put(key, foto.buffer, { httpMetadata: { contentType: CONTENT_TYPE_POR_EXT[foto.ext] } });
        clavesNuevas.push(key);
        clavePorIndice.set(i, key);
      }
    } catch (err) {
      console.error("Error subiendo foto a R2 desde admin:", err);
      await limpiarFotos(env.FOTOS, clavesNuevas);
      return json({ error: "No se han podido guardar las fotos." }, 500);
    }
  }

  // Diff: jugadores actuales cuyo id no viene en el payload se borran.
  const idsEnviados = new Set(registro.jugadores.filter((j) => j.id !== undefined).map((j) => j.id as number));
  const idsABorrar = jugadoresActuales.filter((j) => !idsEnviados.has(j.id)).map((j) => j.id);
  const clavesABorrar: string[] = jugadoresActuales
    .filter((j) => idsABorrar.includes(j.id) && j.foto_key)
    .map((j) => j.foto_key as string);

  const statements = [
    env.DB
      .prepare("UPDATE equipos SET nombre = ?1, nombre_normalizado = ?2 WHERE id = ?3")
      .bind(registro.equipo, registro.equipoNormalizado, equipoId)
  ];

  if (idsABorrar.length > 0) {
    statements.push(
      env.DB.prepare(`DELETE FROM jugadores WHERE id IN (${idsABorrar.map(() => "?").join(",")})`).bind(...idsABorrar)
    );
  }

  registro.jugadores.forEach((j, i) => {
    const esSuplente = i >= 2 ? 1 : 0;
    const orden = i + 1;
    const fotoNueva = clavePorIndice.get(i);

    if (j.id !== undefined) {
      const fotoActual = actualesPorId.get(j.id) ?? null;
      let fotoKey: string | null;
      if (fotoNueva) {
        fotoKey = fotoNueva;
        if (fotoActual) clavesABorrar.push(fotoActual);
      } else if (j.eliminarFoto) {
        fotoKey = null;
        if (fotoActual) clavesABorrar.push(fotoActual);
      } else {
        fotoKey = fotoActual;
      }
      statements.push(
        env.DB
          .prepare(
            `UPDATE jugadores SET nombre = ?1, apellidos = ?2, nombre_completo_normalizado = ?3,
               telefono = ?4, telefono_normalizado = ?5, email = ?6, email_normalizado = ?7,
               red_social = ?8, foto_key = ?9, es_suplente = ?10, orden = ?11
             WHERE id = ?12`
          )
          .bind(
            j.nombre,
            j.apellidos,
            j.nombreCompletoNormalizado,
            j.telefono,
            j.telefonoNormalizado,
            j.email,
            j.emailNormalizado,
            j.redSocial,
            fotoKey,
            esSuplente,
            orden,
            j.id
          )
      );
    } else {
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO jugadores (
               equipo_id, nombre, apellidos, nombre_completo_normalizado,
               telefono, telefono_normalizado, email, email_normalizado,
               red_social, foto_key, es_suplente, orden
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
          )
          .bind(
            equipoId,
            j.nombre,
            j.apellidos,
            j.nombreCompletoNormalizado,
            j.telefono,
            j.telefonoNormalizado,
            j.email,
            j.emailNormalizado,
            j.redSocial,
            fotoNueva ?? null,
            esSuplente,
            orden
          )
      );
    }
  });

  try {
    await env.DB.batch(statements);
  } catch (err) {
    await limpiarFotos(env.FOTOS, clavesNuevas);
    const conflicto = mapearConflictoUnicoEdicion(err);
    if (conflicto) {
      return json({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409, { "Cache-Control": "no-store" });
    }
    console.error("Error actualizando equipo desde panel admin:", err);
    return json({ error: "No se ha podido guardar el equipo." }, 500, { "Cache-Control": "no-store" });
  }

  await limpiarFotos(env.FOTOS, clavesABorrar);

  const equipo = await cargarEquipoConJugadores(env.DB, equipoId);
  return json({ ok: true, equipo }, 200, { "Cache-Control": "no-store" });
};
```

- [ ] **Step 4: Verify with `npm run build`**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification with `wrangler pages dev`**

Run `npm run build && npx wrangler pages dev dist --port 8788`, log in as admin in the browser, and use devtools/console `fetch` (cookies are sent automatically since it's same-origin) to exercise the endpoint against a real team id from `GET /api/admin`:

- Edit only the team name, keep the same `jugadores` (with their `id`s, no files) → expect `200`, and the team name changes in a follow-up `GET /api/admin`, players and their `foto_key` untouched.
- Add a new player object without `id` → expect `200` and a new row appears; team total `jugadoresTotal` increases by one.
- Omit an existing player's `id` from the array → expect `200` and that player disappears from `GET /api/admin`.
- Resubmit with a phone number that belongs to a player on a *different* team → expect `409` with `campos["jugadores.<i>.telefono"]` set.
- Resubmit with only 1 player → expect `400` (`campos.jugadores`, `MIN_JUGADORES` rule from `validarRegistro`).

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin.ts
git commit -m "feat: PATCH /api/admin para editar equipo y jugadores conservando fotos"
```

---

### Task 4: Markup del diálogo de edición y la miniatura de foto

**Files:**
- Modify: `src/pages/admin.astro`

**Interfaces:**
- Produces: a `<dialog data-team-edit-dialog>` and a `<template id="team-edit-player-template">` that Task 6/7/8's JS will query via the `data-team-edit-*` attributes below.

- [ ] **Step 1: Add an "Editar" button to the team card head and a thumbnail per player row**

This step only prepares markup that `admin.js` will *generate dynamically* per team (the existing `renderTeams` function in `public/assets/admin.js` builds team cards from JS, there's no static markup for them in `admin.astro`) — so this step is actually just Task 6, not `admin.astro`. Skip static markup for team cards; go directly to Step 2 for the dialog and template, which are the only new static markup.

- [ ] **Step 2: Add the edit dialog and player-row `<template>` to `admin.astro`**

In `src/pages/admin.astro`, add this markup right after the existing `<dialog class="match-dialog" data-match-dialog>` block (after its closing `</dialog>`, before `<SiteFooter />`):

```astro
  <dialog class="match-dialog" data-team-edit-dialog>
    <form method="dialog" class="match-dialog-close">
      <button type="submit" aria-label="Cerrar">x</button>
    </form>
    <div class="match-dialog-body">
      <div class="match-dialog-head">
        <p class="eyebrow">Editar equipo</p>
        <h2 data-team-edit-title>Equipo</h2>
      </div>

      <div class="form-banner" role="alert" data-team-edit-banner hidden></div>

      <form data-team-edit-form novalidate>
        <div class="field">
          <label for="team-edit-name">Nombre del equipo</label>
          <input id="team-edit-name" type="text" maxlength="60" autocomplete="off" data-team-edit-field="equipo" />
          <p class="field-error" data-team-edit-error="equipo" hidden></p>
        </div>

        <div class="players" data-team-edit-players></div>

        <button type="button" class="add-player" data-team-edit-add>+ Añadir jugador</button>

        <div class="admin-diff" data-team-edit-diff hidden>
          <h3>Vas a guardar estos cambios</h3>
          <ul data-team-edit-diff-list></ul>
        </div>

        <div class="admin-shirt-form-actions">
          <button type="button" class="button button-secondary" data-team-edit-review>Revisar cambios</button>
          <button type="button" class="button button-secondary" data-team-edit-back hidden>Volver a editar</button>
          <button type="button" class="button button-primary" data-team-edit-confirm hidden>Confirmar cambios</button>
        </div>
      </form>
    </div>
  </dialog>

  <template id="team-edit-player-template">
    <article class="player-card" data-team-edit-player>
      <header class="player-head">
        <span class="player-dorsal" data-dorsal aria-hidden="true">1</span>
        <span class="player-role" data-role>Titular</span>
        <div class="admin-player-order">
          <button type="button" data-move-up aria-label="Subir en el orden">↑</button>
          <button type="button" data-move-down aria-label="Bajar en el orden">↓</button>
        </div>
        <button type="button" class="player-remove" data-remove>Quitar</button>
      </header>
      <div class="player-grid">
        <div class="field admin-photo-field">
          <span class="admin-photo-label">Foto</span>
          <div class="admin-photo-row">
            <img class="admin-edit-photo" data-photo-preview alt="" hidden />
            <span class="admin-photo-thumb is-empty admin-edit-photo" data-photo-empty aria-hidden="true"></span>
            <div class="admin-photo-actions">
              <label class="add-player admin-photo-upload">
                Cambiar foto
                <input type="file" data-field="foto" accept="image/jpeg,image/png,image/webp" hidden />
              </label>
              <label class="admin-photo-delete">
                <input type="checkbox" data-field="eliminarFoto" />
                Eliminar foto
              </label>
            </div>
          </div>
          <p class="field-error" data-field-error="foto" hidden></p>
        </div>
        <div class="field">
          <label data-label="nombre">Nombre</label>
          <input type="text" data-field="nombre" maxlength="60" autocomplete="off" />
          <p class="field-error" data-field-error="nombre" hidden></p>
        </div>
        <div class="field">
          <label data-label="apellidos">Apellidos</label>
          <input type="text" data-field="apellidos" maxlength="80" autocomplete="off" />
          <p class="field-error" data-field-error="apellidos" hidden></p>
        </div>
        <div class="field">
          <label data-label="telefono">Móvil</label>
          <input type="tel" data-field="telefono" maxlength="18" autocomplete="off" />
          <p class="field-error" data-field-error="telefono" hidden></p>
        </div>
        <div class="field">
          <label data-label="email">Correo</label>
          <input type="email" data-field="email" maxlength="120" autocomplete="off" />
          <p class="field-error" data-field-error="email" hidden></p>
        </div>
        <div class="field">
          <label data-label="redSocial">Instagram u otra red <span class="field-opt">(opcional)</span></label>
          <input type="text" data-field="redSocial" maxlength="120" autocomplete="off" />
          <p class="field-error" data-field-error="redSocial" hidden></p>
        </div>
      </div>
    </article>
  </template>
```

- [ ] **Step 3: Verify with `npm run build`**

Run: `npm run build`
Expected: succeeds (Astro syntax check passes — no dynamic behavior yet, the dialog just won't be reachable until Task 6 wires it up).

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin.astro
git commit -m "feat: markup del dialogo de edicion de equipo en /admin"
```

---

### Task 5: Estilos del diálogo de edición y las miniaturas

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add base (mobile-first) rules**

Insert these rules right after `.admin-danger` (`src/styles/global.css:2741-2743`), before the `/* ------------------------------ media queries ------------------------------ */` comment:

```css
.admin-photo-thumb {
  display: inline-block;
  width: 40px;
  height: 40px;
  border: 2px solid var(--ink);
  border-radius: 8px;
  object-fit: cover;
  background: var(--foam);
  flex-shrink: 0;
}

.admin-photo-thumb.is-empty {
  background: repeating-linear-gradient(
    45deg,
    rgba(16, 21, 22, 0.08),
    rgba(16, 21, 22, 0.08) 6px,
    transparent 6px,
    transparent 12px
  );
}

.admin-subitem-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.admin-edit-photo {
  width: 72px;
  height: 72px;
  border-radius: 10px;
}

.admin-photo-field {
  grid-column: 1 / -1;
}

.admin-photo-label {
  font-weight: 900;
  color: var(--ink);
}

.admin-photo-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.admin-photo-actions {
  display: grid;
  gap: 6px;
}

.admin-photo-upload {
  cursor: pointer;
  text-align: center;
}

.admin-photo-delete {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 800;
  color: var(--muted);
}

.admin-player-order {
  display: flex;
  gap: 4px;
}

.admin-player-order button {
  width: 32px;
  height: 32px;
  border: 2px solid var(--ink);
  border-radius: 8px;
  background: var(--foam);
  box-shadow: 2px 2px 0 var(--ink);
  cursor: pointer;
  font-weight: 900;
}

.admin-player-order button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.admin-diff {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 2px solid var(--ink);
  border-radius: 8px;
  background: rgba(231, 218, 181, 0.35);
}

.admin-diff h3 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--deep);
}

.admin-diff ul {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  color: var(--ink);
}
```

- [ ] **Step 2: Wire up the thumbnail in the existing player subitem layout**

The team list's `.admin-subitem` (rendered by `renderTeams` in `admin.js`, updated in Task 6) will place the thumbnail and the name/role text side by side. The `.admin-subitem-head` flex rule added in Step 1 covers this — no further CSS needed since `.admin-photo-thumb` is already sized.

- [ ] **Step 3: Verify with `npm run build`**

Run: `npm run build`
Expected: succeeds (CSS isn't type-checked, this just confirms the build pipeline still completes).

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "style: miniaturas de foto, orden de jugador y resumen de cambios en /admin"
```

---

### Task 6: Miniaturas en la lista y apertura/población del diálogo de edición

**Files:**
- Modify: `public/assets/admin.js`

**Interfaces:**
- Consumes: `data-team-edit-dialog`, `data-team-edit-players`, `data-team-edit-field="equipo"`, `#team-edit-player-template` (Task 4).
- Produces (used by Task 7/8): module-scope `let equipoEnEdicion = null;` holding `{ id, jugadores: [...] }` snapshot taken at open time (used later to compute the diff), and a `crearFilaJugador(jugador)` function that returns a populated player-card DOM node.

- [ ] **Step 1: Add thumbnails to `renderTeams`**

In `public/assets/admin.js`, replace the player-loop body inside `renderTeams` (currently):

```js
      (team.jugadores || []).forEach((player) => {
        const item = el("div", "admin-subitem");
        item.append(el("strong", "", `${player.nombre} ${player.apellidos}`));
        item.append(el("span", "", `${player.esSuplente ? "Suplente" : "Titular"} · ${text(player.telefono)} · ${text(player.email)}`));
        players.append(item);
      });
```

with:

```js
      (team.jugadores || []).forEach((player) => {
        const item = el("div", "admin-subitem");
        const head = el("div", "admin-subitem-head");
        if (player.tieneFoto) {
          const img = document.createElement("img");
          img.className = "admin-photo-thumb";
          img.alt = "";
          img.src = `/api/admin?type=foto&jugadorId=${encodeURIComponent(player.id)}`;
          head.append(img);
        } else {
          head.append(el("span", "admin-photo-thumb is-empty"));
        }
        const info = el("div", "");
        info.append(el("strong", "", `${player.nombre} ${player.apellidos}`));
        info.append(el("span", "", `${player.esSuplente ? "Suplente" : "Titular"} · ${text(player.telefono)} · ${text(player.email)}`));
        head.append(info);
        item.append(head);
        players.append(item);
      });
```

This requires `player.id` to exist on the objects returned by `GET /api/admin` — confirm `mapJugador` in `functions/api/admin.ts` already includes `id: jugador.id` (it does, no backend change needed here).

- [ ] **Step 2: Add an "Editar" button to the team card head**

In the same `renderTeams` function, right after the existing line `head.append(dangerButton("Borrar", () => deleteItem("equipo", team.id, ...)));`, add:

```js
      head.append(editButton(() => openTeamEditDialog(team)));
```

Add this small helper near `dangerButton`:

```js
  function editButton(onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-remove";
    button.textContent = "Editar";
    button.addEventListener("click", onClick);
    return button;
  }
```

- [ ] **Step 3: Add dialog element references and the player-row template getter**

Near the top of the IIFE, alongside the other `root.querySelector(...)` declarations, add:

```js
  const teamEditDialog = document.querySelector("[data-team-edit-dialog]");
  const teamEditForm = teamEditDialog?.querySelector("[data-team-edit-form]");
  const teamEditPlayers = teamEditDialog?.querySelector("[data-team-edit-players]");
  const teamEditBanner = teamEditDialog?.querySelector("[data-team-edit-banner]");
  const teamEditTitle = teamEditDialog?.querySelector("[data-team-edit-title]");
  const teamEditAdd = teamEditDialog?.querySelector("[data-team-edit-add]");
  const teamEditDiff = teamEditDialog?.querySelector("[data-team-edit-diff]");
  const teamEditDiffList = teamEditDialog?.querySelector("[data-team-edit-diff-list]");
  const teamEditReview = teamEditDialog?.querySelector("[data-team-edit-review]");
  const teamEditBack = teamEditDialog?.querySelector("[data-team-edit-back]");
  const teamEditConfirm = teamEditDialog?.querySelector("[data-team-edit-confirm]");
  const teamEditTemplate = document.getElementById("team-edit-player-template");
  const MIN_JUGADORES = 2;
  const MAX_JUGADORES = 15;
  const MAX_FOTO_BYTES = 4 * 1024 * 1024;
  const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
  const NOMBRE_RE = /^[\p{L}\p{M}'’. -]+$/u;
  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const HANDLE_RE = /^@?[a-zA-Z0-9._]{2,30}$/;
  const URL_SOCIAL_RE = /^https:\/\/\S{5,110}$/;

  let equipoEnEdicion = null;
```

- [ ] **Step 4: Add `crearFilaJugador` and `openTeamEditDialog`**

```js
  function crearFilaJugador(jugador) {
    const carta = teamEditTemplate.content.firstElementChild.cloneNode(true);
    if (jugador && jugador.id) carta.dataset.playerId = String(jugador.id);

    const setValor = (campo, valor) => {
      const input = carta.querySelector(`[data-field="${campo}"]`);
      if (input) input.value = valor || "";
    };
    setValor("nombre", jugador?.nombre);
    setValor("apellidos", jugador?.apellidos);
    setValor("telefono", jugador?.telefono);
    setValor("email", jugador?.email);
    setValor("redSocial", jugador?.redSocial);

    const preview = carta.querySelector("[data-photo-preview]");
    const empty = carta.querySelector("[data-photo-empty]");
    if (jugador?.tieneFoto && jugador?.id) {
      preview.src = `/api/admin?type=foto&jugadorId=${encodeURIComponent(jugador.id)}`;
      preview.hidden = false;
      empty.hidden = true;
      carta.dataset.tieneFotoOriginal = "1";
    } else {
      preview.hidden = true;
      empty.hidden = false;
      carta.dataset.tieneFotoOriginal = "";
    }

    carta.querySelector("[data-remove]").addEventListener("click", () => {
      carta.remove();
      reindexarEdicion();
    });
    carta.querySelector("[data-move-up]").addEventListener("click", () => moverJugador(carta, -1));
    carta.querySelector("[data-move-down]").addEventListener("click", () => moverJugador(carta, 1));

    carta.querySelectorAll("input[data-field]").forEach((input) => {
      if (input.dataset.field === "foto") return;
      input.addEventListener("blur", () => validarCampoEdicion(input));
    });

    const fotoInput = carta.querySelector('[data-field="foto"]');
    const eliminarFotoInput = carta.querySelector('[data-field="eliminarFoto"]');
    fotoInput.addEventListener("change", () => {
      const archivo = fotoInput.files && fotoInput.files[0];
      if (!archivo) return;
      if (archivo.size > MAX_FOTO_BYTES || !TIPOS_FOTO.includes(archivo.type)) {
        pintarErrorEdicion(carta, "foto", "Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB.");
        fotoInput.value = "";
        return;
      }
      pintarErrorEdicion(carta, "foto", "");
      eliminarFotoInput.checked = false;
      preview.src = URL.createObjectURL(archivo);
      preview.hidden = false;
      empty.hidden = true;
    });
    eliminarFotoInput.addEventListener("change", () => {
      if (eliminarFotoInput.checked) {
        fotoInput.value = "";
        preview.hidden = true;
        empty.hidden = false;
      } else if (carta.dataset.tieneFotoOriginal && !fotoInput.files?.[0]) {
        preview.hidden = false;
        empty.hidden = true;
      }
    });

    return carta;
  }

  function openTeamEditDialog(team) {
    if (!teamEditDialog) return;
    equipoEnEdicion = {
      id: team.id,
      nombre: team.nombre,
      jugadores: (team.jugadores || []).map((j) => ({ ...j }))
    };
    teamEditTitle.textContent = team.nombre;
    teamEditForm.querySelector('[data-team-edit-field="equipo"]').value = team.nombre;
    teamEditPlayers.innerHTML = "";
    (team.jugadores || []).forEach((jugador) => {
      teamEditPlayers.append(crearFilaJugador(jugador));
    });
    reindexarEdicion();
    mostrarPasoEdicion();
    limpiarBannerEdicion();
    teamEditDialog.showModal();
  }

  function reindexarEdicion() {
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    cartas.forEach((carta, i) => {
      carta.querySelector("[data-dorsal]").textContent = String(i + 1);
      carta.querySelector("[data-role]").textContent = i < MIN_JUGADORES ? "Titular" : "Suplente";
      carta.classList.toggle("is-suplente", i >= MIN_JUGADORES);
      carta.querySelector("[data-remove]").hidden = cartas.length <= MIN_JUGADORES;
      carta.querySelector("[data-move-up]").disabled = i === 0;
      carta.querySelector("[data-move-down]").disabled = i === cartas.length - 1;
    });
    teamEditAdd.disabled = cartas.length >= MAX_JUGADORES;
  }

  function moverJugador(carta, delta) {
    const hermano = delta < 0 ? carta.previousElementSibling : carta.nextElementSibling;
    if (!hermano) return;
    if (delta < 0) teamEditPlayers.insertBefore(carta, hermano);
    else teamEditPlayers.insertBefore(hermano, carta);
    reindexarEdicion();
  }
```

- [ ] **Step 5: Wire up "Añadir jugador" and dialog reset on close**

```js
  teamEditAdd?.addEventListener("click", () => {
    const carta = crearFilaJugador(null);
    teamEditPlayers.append(carta);
    reindexarEdicion();
    carta.querySelector('[data-field="nombre"]')?.focus();
  });

  teamEditDialog?.addEventListener("close", () => {
    equipoEnEdicion = null;
    teamEditPlayers.innerHTML = "";
  });
```

- [ ] **Step 6: Add the small helpers used above (`pintarErrorEdicion`, `limpiarBannerEdicion`, `mostrarPasoEdicion` stub)**

```js
  function pintarErrorEdicion(carta, campo, mensaje) {
    const p = carta.querySelector(`[data-field-error="${campo}"]`);
    if (!p) return;
    p.textContent = mensaje || "";
    p.hidden = !mensaje;
  }

  function limpiarBannerEdicion() {
    teamEditBanner.textContent = "";
    teamEditBanner.hidden = true;
  }

  function mostrarPasoEdicion() {
    teamEditPlayers.hidden = false;
    teamEditAdd.hidden = false;
    teamEditDiff.hidden = true;
    teamEditReview.hidden = false;
    teamEditBack.hidden = true;
    teamEditConfirm.hidden = true;
  }
```

(`validarCampoEdicion` is referenced in Step 4 but implemented in Task 7 — leave the call in place, it will be defined by the time this file is fully edited after Task 7.)

- [ ] **Step 7: Verify manually with `wrangler pages dev`**

Run `npm run build && npx wrangler pages dev dist --port 8788`, log in as admin, open `/admin/`. Confirm:
- Each player row in "Equipos registrados" shows a thumbnail (photo or the striped placeholder).
- Clicking "Editar" on a team opens the dialog with the team name and one row per player pre-filled, photos previewed for players that have one.
- The up/down and "Quitar" buttons are present (their behavior is exercised again in Task 7's manual check).

Note: this step will show a JS error in the console for `validarCampoEdicion is not defined` until Task 7 is done — that's expected and resolved there. If executing tasks in strict one-by-one order with review gates, it's fine to note this in the review rather than treat it as a regression.

- [ ] **Step 8: Commit**

```bash
git add public/assets/admin.js
git commit -m "feat: miniaturas de foto y apertura del dialogo de edicion en /admin"
```

---

### Task 7: Validación de campos y edición de jugadores en el diálogo

**Files:**
- Modify: `public/assets/admin.js`

**Interfaces:**
- Produces: `validarCampoEdicion(input): boolean` (referenced by Task 6), `validarFormularioEdicion(): boolean` (used by Task 8's "Revisar cambios" handler).

- [ ] **Step 1: Add `validarCampoEdicion` mirroring `functions/_lib/validacion.ts`**

Add near the other edit-dialog functions in `public/assets/admin.js`:

```js
  function mensajeCampoEdicion(input) {
    const campo = input.dataset.field;
    const v = limpiar(input.value || "");
    switch (campo) {
      case "nombre":
        return v.length < 2 || v.length > 60 || !NOMBRE_RE.test(v)
          ? "Introduce el nombre (solo letras, entre 2 y 60 caracteres)."
          : "";
      case "apellidos":
        return v.length < 2 || v.length > 80 || !NOMBRE_RE.test(v)
          ? "Introduce los apellidos (solo letras, entre 2 y 80 caracteres)."
          : "";
      case "telefono":
        return !/^[67]\d{8}$/.test(v.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, ""))
          ? "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
          : "";
      case "email":
        if (!v) return "El correo de cada jugador es obligatorio.";
        return !EMAIL_RE.test(v) || v.length > 120 ? "Ese correo no parece válido." : "";
      case "redSocial":
        return v && (v.length > 120 || !(HANDLE_RE.test(v) || URL_SOCIAL_RE.test(v)))
          ? "Usa un usuario tipo @nombre o un enlace https://."
          : "";
      default:
        return "";
    }
  }

  function validarCampoEdicion(input) {
    const carta = input.closest("[data-team-edit-player]");
    const mensaje = mensajeCampoEdicion(input);
    pintarErrorEdicion(carta, input.dataset.field, mensaje);
    return !mensaje;
  }

  function validarNombreEquipoEdicion() {
    const input = teamEditForm.querySelector('[data-team-edit-field="equipo"]');
    const v = limpiar(input.value || "");
    const mensaje = v.length < 2 || v.length > 60 ? "El nombre del equipo debe tener entre 2 y 60 caracteres." : "";
    const p = teamEditForm.querySelector('[data-team-edit-error="equipo"]');
    p.textContent = mensaje;
    p.hidden = !mensaje;
    return !mensaje;
  }

  function validarFormularioEdicion() {
    let valido = validarNombreEquipoEdicion();
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    cartas.forEach((carta) => {
      carta.querySelectorAll("input[data-field]").forEach((input) => {
        if (input.dataset.field === "foto" || input.dataset.field === "eliminarFoto") return;
        if (!validarCampoEdicion(input)) valido = false;
      });
    });
    return valido;
  }
```

`limpiar` is already defined earlier in `admin.js` (used by the shirt form) — reused here, no redefinition needed.

- [ ] **Step 2: Manual verification with `wrangler pages dev`**

Run `npm run build && npx wrangler pages dev dist --port 8788`, open `/admin/`, click "Editar" on a team:
- Clear a player's "Nombre" field and blur it → error message appears under that field.
- Type a phone number that doesn't start with 6/7 → error message appears.
- Add a new player row via "+ Añadir jugador", leave it empty → its fields show errors once blurred.
- Reorder with ↑/↓: confirm the role label ("Titular"/"Suplente") and dorsal number update immediately, and the first row's ↑ is disabled, the last row's ↓ is disabled.
- Reduce to exactly 2 players → confirm the "Quitar" buttons disappear (can't drop below the minimum) — re-add to restore state before continuing to Task 8's checks.

- [ ] **Step 3: Commit**

```bash
git add public/assets/admin.js
git commit -m "feat: validacion de campos en el dialogo de edicion de /admin"
```

---

### Task 8: Resumen de cambios, confirmación y guardado

**Files:**
- Modify: `public/assets/admin.js`

**Interfaces:**
- Consumes: `equipoEnEdicion` snapshot (Task 6), `validarFormularioEdicion` (Task 7), `PATCH /api/admin?type=equipo&id=` (Task 3).

- [ ] **Step 1: Add diff computation**

```js
  function etiquetaJugador(jugador) {
    const nombre = limpiar(jugador.nombre || "");
    const apellidos = limpiar(jugador.apellidos || "");
    return `${nombre} ${apellidos}`.trim() || "Jugador sin nombre";
  }

  function datosFilaEdicion(carta) {
    const valor = (campo) => {
      const input = carta.querySelector(`[data-field="${campo}"]`);
      return limpiar(input ? input.value : "");
    };
    const datos = {
      id: carta.dataset.playerId ? Number(carta.dataset.playerId) : undefined,
      nombre: valor("nombre"),
      apellidos: valor("apellidos"),
      telefono: valor("telefono"),
      email: valor("email"),
      redSocial: valor("redSocial"),
      eliminarFoto: carta.querySelector('[data-field="eliminarFoto"]').checked
    };
    const fotoInput = carta.querySelector('[data-field="foto"]');
    datos.fotoNueva = fotoInput.files && fotoInput.files[0] ? fotoInput.files[0] : null;
    return datos;
  }

  function calcularDiff() {
    const cambios = [];
    const nombreEquipoActual = limpiar(teamEditForm.querySelector('[data-team-edit-field="equipo"]').value);
    if (nombreEquipoActual !== equipoEnEdicion.nombre) {
      cambios.push(`Nombre del equipo: «${equipoEnEdicion.nombre}» → «${nombreEquipoActual}»`);
    }

    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    const idsActuales = new Set();
    const CAMPOS = [
      ["nombre", "Nombre"],
      ["apellidos", "Apellidos"],
      ["telefono", "Móvil"],
      ["email", "Correo"],
      ["redSocial", "Red social"]
    ];

    cartas.forEach((carta) => {
      const datos = datosFilaEdicion(carta);
      if (datos.id === undefined) {
        cambios.push(`Se añade a ${etiquetaJugador(datos)}.`);
      } else {
        idsActuales.add(datos.id);
        const original = equipoEnEdicion.jugadores.find((j) => j.id === datos.id);
        if (original) {
          CAMPOS.forEach(([campo, etiqueta]) => {
            const antes = limpiar(original[campo] || "");
            const despues = datos[campo] || "";
            if (antes !== despues) {
              cambios.push(`${etiquetaJugador(original)} — ${etiqueta}: «${antes || "—"}» → «${despues || "—"}»`);
            }
          });
          if (datos.fotoNueva) {
            cambios.push(`${etiquetaJugador(original)}: cambia la foto.`);
          } else if (datos.eliminarFoto && original.tieneFoto) {
            cambios.push(`${etiquetaJugador(original)}: se elimina la foto.`);
          }
        }
      }
    });

    equipoEnEdicion.jugadores.forEach((original) => {
      if (original.id && !idsActuales.has(original.id)) {
        cambios.push(`Se quita a ${etiquetaJugador(original)}.`);
      }
    });

    return cambios;
  }
```

- [ ] **Step 2: Wire "Revisar cambios" / "Volver a editar"**

```js
  teamEditReview?.addEventListener("click", () => {
    limpiarBannerEdicion();
    if (!validarFormularioEdicion()) {
      mostrarBannerEdicion("Revisa los campos marcados.");
      return;
    }
    const cambios = calcularDiff();
    if (cambios.length === 0) {
      mostrarBannerEdicion("No hay cambios que guardar.");
      return;
    }
    teamEditDiffList.innerHTML = "";
    cambios.forEach((linea) => {
      const li = document.createElement("li");
      li.textContent = linea;
      teamEditDiffList.append(li);
    });
    teamEditPlayers.hidden = true;
    teamEditAdd.hidden = true;
    teamEditDiff.hidden = false;
    teamEditReview.hidden = true;
    teamEditBack.hidden = false;
    teamEditConfirm.hidden = false;
  });

  teamEditBack?.addEventListener("click", () => {
    mostrarPasoEdicion();
  });

  function mostrarBannerEdicion(mensaje, kind = "error") {
    teamEditBanner.textContent = mensaje;
    teamEditBanner.dataset.kind = kind;
    teamEditBanner.hidden = !mensaje;
  }
```

- [ ] **Step 3: Wire "Confirmar cambios" to build the `FormData` and `PATCH`**

```js
  function pintarErroresServidorEdicion(campos) {
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    const sueltos = [];
    Object.entries(campos || {}).forEach(([clave, mensaje]) => {
      if (clave === "equipo") {
        const p = teamEditForm.querySelector('[data-team-edit-error="equipo"]');
        p.textContent = mensaje;
        p.hidden = false;
        return;
      }
      const partes = clave.match(/^jugadores\.(\d+)\.(\w+)$/);
      if (partes && cartas[Number(partes[1])]) {
        pintarErrorEdicion(cartas[Number(partes[1])], partes[2], mensaje);
        return;
      }
      sueltos.push(mensaje);
    });
    return sueltos;
  }

  teamEditConfirm?.addEventListener("click", async () => {
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    const jugadores = cartas.map((carta) => {
      const datos = datosFilaEdicion(carta);
      const jugador = {
        nombre: datos.nombre,
        apellidos: datos.apellidos,
        telefono: datos.telefono,
        eliminarFoto: datos.eliminarFoto
      };
      if (datos.id !== undefined) jugador.id = datos.id;
      if (datos.email) jugador.email = datos.email;
      if (datos.redSocial) jugador.redSocial = datos.redSocial;
      return jugador;
    });

    const payload = {
      nombre: limpiar(teamEditForm.querySelector('[data-team-edit-field="equipo"]').value),
      jugadores
    };

    const datosEnvio = new FormData();
    datosEnvio.append("payload", JSON.stringify(payload));
    cartas.forEach((carta, i) => {
      const fotoInput = carta.querySelector('[data-field="foto"]');
      if (fotoInput.files && fotoInput.files[0]) {
        datosEnvio.append(`foto_${i}`, fotoInput.files[0]);
      }
    });

    teamEditConfirm.disabled = true;
    teamEditConfirm.setAttribute("aria-busy", "true");
    const textoOriginal = teamEditConfirm.textContent;
    teamEditConfirm.textContent = "Guardando...";

    try {
      const respuesta = await fetch(`/api/admin?type=equipo&id=${encodeURIComponent(equipoEnEdicion.id)}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { Accept: "application/json" },
        credentials: "include",
        body: datosEnvio
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !cuerpo.ok) {
        mostrarPasoEdicion();
        const sueltos = cuerpo.campos ? pintarErroresServidorEdicion(cuerpo.campos) : [];
        mostrarBannerEdicion([cuerpo.error || "No se ha podido guardar el equipo.", ...sueltos].join(" "));
        return;
      }
      teamEditDialog.close();
      await loadAdmin();
    } catch {
      mostrarPasoEdicion();
      mostrarBannerEdicion("No hay conexión. Comprueba la red e inténtalo de nuevo.");
    } finally {
      teamEditConfirm.disabled = false;
      teamEditConfirm.removeAttribute("aria-busy");
      teamEditConfirm.textContent = textoOriginal;
    }
  });
```

- [ ] **Step 4: Verify with `npm run build`**

Run: `npm run build`
Expected: succeeds with no errors (Astro's build doesn't type-check plain `.js` under `public/`, so this mainly confirms nothing else broke; syntax errors in `admin.js` would only surface at runtime — covered by the manual pass below).

- [ ] **Step 5: Full manual end-to-end verification with `wrangler pages dev`**

Run `npm run build && npx wrangler pages dev dist --port 8788`, log in as admin at `/admin/`:

1. Edit a team: change the team name and one player's phone number, click "Revisar cambios" → confirm the diff lists exactly those two changes with correct before/after values, click "Confirmar cambios" → dialog closes, panel refreshes, new values visible in the list and thumbnail unaffected.
2. Reopen the same team, click "Revisar cambios" with no changes made → confirm it shows "No hay cambios que guardar." and stays on the edit step (no PATCH sent — check the Network tab).
3. Add a new player (fill all required fields, including a unique phone/email), review, confirm → new player appears in the list with correct titular/suplente based on its position.
4. Remove a player, review (confirm the diff says "Se quita a ..."), confirm → player count decreases, D1 row gone (re-open edit and confirm the removed player isn't there).
5. Replace an existing player's photo with a new file, review (diff says "cambia la foto"), confirm → the thumbnail in the list updates to the new image; reopen edit and confirm the old R2 object is gone (can't check R2 directly locally, but confirm the app no longer 404s/serves a stale image for that player).
6. Tick "Eliminar foto" on a player that has one, review, confirm → thumbnail becomes the empty placeholder.
7. Try to set a player's phone to one used by another team → server 409 comes back, dialog returns to the edit step with the error under that player's phone field, banner shows the message.
8. On a small viewport (resize the wrangler-served page to ~390–560px per the CLAUDE.md mobile-testing note, remembering Chrome's ~500px headless clamp is a capture artifact, not a real bug), open the edit dialog and confirm the player rows, photo controls, and diff list all stay usable without horizontal overflow.

- [ ] **Step 6: Commit**

```bash
git add public/assets/admin.js
git commit -m "feat: resumen de cambios, confirmacion y guardado en el dialogo de edicion de /admin"
```

---

## Self-review notes

- Spec coverage: team name edit (Task 3/8), player field edits (Task 3/7/8), add/remove players (Task 3/7), titular/suplente + orden via position (Task 3/6/7), photo replace/delete with preview (Task 2/3/4/6/8), pre-save confirmation with diff (Task 8), thumbnails in the list (Task 5/6) — all covered.
- No revert-after-save logic was added anywhere, matching the explicit decision in the spec.
- Type consistency checked: `JugadorValidado.id`/`eliminarFoto` (Task 1) flow through `validarRegistro` → `onRequestPatch` (Task 3) → the `payload.jugadores[].id`/`.eliminarFoto` shape built by `admin.js` (Task 8) — names match end to end. `cargarEquipoConJugadores`'s return shape matches the `equipos` array item shape from the existing `onRequestGet`, which `renderTeams`/`openTeamEditDialog` (Task 6) already know how to read.
