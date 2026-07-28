# Capitán del equipo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada equipo tenga un capitán explícito —el único con móvil y correo obligatorios, el único que puede editar o borrar el equipo, y que puede ceder el puesto— sustituyendo a `equipos.owner_user_id`.

**Arquitectura:** Una columna nueva, `equipos.capitan_jugador_id`, apunta a la fila de `jugadores` que manda. La autorización de escritura deja de mirar la cuenta propietaria y pasa a comparar el correo de la sesión con el del capitán. El resto de jugadores puede quedarse sin móvil y sin correo; los formularios avisan de lo que eso implica.

**Tech Stack:** Astro 5 (estático), Cloudflare Pages Functions + D1 + R2, TypeScript en `functions/`, JavaScript plano sin bundler en `public/assets/`, Vitest (proyectos `unit`, `integration`, `e2e`).

**Spec:** `docs/superpowers/specs/2026-07-29-capitan-equipo-design.md`

## Global Constraints

- Todo el texto de cara al usuario va en **español con acentos correctos** ("Música", "información"). El deporte se escribe siempre **"volley"**, nunca "vóley".
- Tono de la copia: corto y seguro, sin chistes.
- `functions/_lib/validacion.ts` y `public/assets/team-form.js` son espejo el uno del otro. Si cambia una regla, cambian los dos; `test/unit/paridad-validacion.test.ts` lo vigila.
- Los mensajes en pantalla se pintan siempre con `textContent`, nunca con `innerHTML`.
- Todo cambio de frontend debe ser responsive: se comprueba con las media queries de 900 px y 560 px de `src/styles/global.css`. Los valores base de global.css son la escala **móvil**; la densidad de escritorio vive en el bloque `@media (min-width: 901px)`.
- Antes de tocar estilos, invocar la skill `frontend-design:frontend-design`.
- Nada de `window.confirm` en `/admin/*`: allí se usa `CopaAdmin.confirmar()`.
- El panel usa un IIFE por página sobre `window.CopaAdmin` (`api`, `apiJson`, `onReady`, `recargar`, `tabla`, `confirmar`).
- Cada tarea acaba con su commit. No se mezcla con `development` sin `npm run verify` en verde.
- Rama de trabajo: `feature/capitan-equipo` (ya creada desde `development`).

## Convenciones de este plan

- Ejecutar un test suelto: `npx vitest run --project unit test/unit/<fichero>` o `npx vitest run --project integration test/integration/<fichero>`.
- Todo (menos `e2e`) corre sin build previo.
- `''` (cadena vacía) es «sin móvil» **en la base**; la API expone `null`. La conversión ocurre en dos sitios y solo dos: al validar (entra `''`) y al mapear la respuesta (sale `null`).

---

### Task 1: Migración 0011 y el capitán como propietario

Sustituye `equipos.owner_user_id` por `equipos.capitan_jugador_id` en la base y en todo el backend, **sin cambiar todavía las reglas de validación**. Al terminar, el comportamiento visible es el mismo que antes (el capitán heredado es quien era propietario), pero el mando ya se lee de la nueva columna.

**Files:**
- Create: `db/migrations/0011_capitan.sql`
- Modify: `functions/_lib/equipos.ts`, `functions/_lib/equipo-editor.ts`, `functions/_lib/admin.ts`, `functions/api/equipos.ts`, `functions/api/mi-equipo.ts`, `functions/api/admin/equipos.ts`, `functions/api/admin/index.ts`, `public/assets/admin/equipos.js`, `CLAUDE.md`
- Test: `test/helpers/db.ts`, `test/integration/mi-equipo.test.ts`, `test/integration/equipos-alta.test.ts`, `test/integration/avatar.test.ts`, `test/integration/perfil.test.ts`, `test/integration/capitan.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `equipos.capitan_jugador_id INTEGER REFERENCES jugadores(id) ON DELETE SET NULL`
  - `EquipoUsuarioRow { id: number; nombre: string; created_at: string; edicion_id: number | null; capitan_jugador_id: number | null }` en `functions/_lib/equipos.ts`
  - `equipoDelCapitan(db: D1Database, user: UsuarioSesion, edicionId?: number): Promise<EquipoUsuarioRow | null>` — sustituye a `equipoPropioDeUsuario`
  - `equipoDeUsuario(db, user, edicionId?)` mantiene su firma
  - `crearEquipo(opciones)` en `test/helpers/db.ts` acepta `capitan?: number` (índice del jugador, por defecto 0) y **ya no** acepta `ownerUserId`
  - `cargarEquipoConJugadores` devuelve `capitanJugadorId`, `capitanEmail`, `capitanNombre` en vez de `ownerUserId`, `ownerEmail`, `ownerName`

- [ ] **Step 1: Escribir la migración**

Crear `db/migrations/0011_capitan.sql`:

```sql
-- Migration number: 0011 	 capitan del equipo
-- El capitan sustituye a equipos.owner_user_id: es la fila de jugadores que
-- manda en el equipo. Autoriza a escribir quien inicie sesion con el correo de
-- esa fila, no una cuenta apuntada aparte. Un solo concepto, imposible de
-- contradecir.
--
-- El movil pasa a ser opcional para quien no es capitan. La columna sigue
-- siendo NOT NULL y se guarda cadena vacia: reconstruir la tabla para admitir
-- NULL se llevaria por delante estadisticas y jugador_atributos, que cuelgan de
-- jugadores con ON DELETE CASCADE.

ALTER TABLE equipos ADD COLUMN capitan_jugador_id INTEGER
  REFERENCES jugadores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipos_capitan ON equipos (capitan_jugador_id);

-- Backfill 1: el jugador cuyo correo es el de la cuenta propietaria.
UPDATE equipos SET capitan_jugador_id = (
  SELECT j.id FROM jugadores j
  JOIN usuarios u ON u.id = equipos.owner_user_id
  WHERE j.equipo_id = equipos.id
    AND j.email_normalizado = lower(trim(u.email))
  ORDER BY j.orden ASC, j.id ASC
  LIMIT 1
);

-- Backfill 2: los que se quedan sin capitan (equipos creados desde el panel,
-- o cuyo propietario no figura en la plantilla) van al jugador de menor orden.
UPDATE equipos SET capitan_jugador_id = (
  SELECT j.id FROM jugadores j
  WHERE j.equipo_id = equipos.id
  ORDER BY j.orden ASC, j.id ASC
  LIMIT 1
) WHERE capitan_jugador_id IS NULL;

-- El indice de movil pasa a parcial: si no, dos jugadores sin movil (ambos con
-- telefono_normalizado = '') chocarian entre si.
DROP INDEX IF EXISTS idx_jugadores_telefono;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_telefono
  ON jugadores (telefono_normalizado) WHERE telefono_normalizado <> '';

-- Fuera la columna anterior: dos columnas que dicen quien manda acaban
-- contradiciendose. El indice va primero, no se puede soltar una columna
-- indexada.
DROP INDEX IF EXISTS idx_equipos_owner_user_id;
ALTER TABLE equipos DROP COLUMN owner_user_id;
```

- [ ] **Step 2: Adaptar el sembrador de tests**

En `test/helpers/db.ts`, sustituir `ownerUserId` por `capitan` en `OpcionesEquipo`, quitar la columna del INSERT y fijar el capitán después de insertar los jugadores.

```ts
export interface OpcionesEquipo {
  nombre?: string;
  jugadores?: JugadorSemilla[];
  /** Índice del jugador que es capitán. Por defecto, el primero. */
  capitan?: number;
  fotoKey?: string | null;
  /** Por defecto, la edición actual. Se pasa para sembrar historial. */
  edicionId?: number;
  posicionFinal?: number | null;
}
```

En el INSERT del equipo, quitar `owner_user_id` de la lista de columnas y `opciones.ownerUserId ?? null` de los binds (los parámetros posteriores se renumeran):

```ts
  const equipo = await env.DB.prepare(
    `INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at, edicion_id, foto_key, posicion_final)
     VALUES (?1, ?2, datetime('now'), ?3, ?4, ?5)
     RETURNING id, edicion_id`
  )
    .bind(
      nombre,
      normalizarTexto(nombre),
      edicionId,
      opciones.fotoKey ?? null,
      opciones.posicionFinal ?? null
    )
    .first<{ id: number; edicion_id: number | null }>();
```

Y justo antes del `return`, después del bucle que inserta jugadores:

```ts
  // El capitán se fija al final: hasta aquí no existen los ids de jugador.
  const capitan = jugadores[opciones.capitan ?? 0];
  if (capitan) {
    await env.DB.prepare("UPDATE equipos SET capitan_jugador_id = ?1 WHERE id = ?2")
      .bind(capitan.id, equipo!.id)
      .run();
  }

  return { id: equipo!.id, nombre, edicionId: equipo!.edicion_id, capitanId: capitan?.id ?? null, jugadores };
```

Añadir `capitanId` a `EquipoSembrado`:

```ts
export interface EquipoSembrado {
  id: number;
  nombre: string;
  edicionId: number | null;
  capitanId: number | null;
  jugadores: { id: number; nombre: string; apellidos: string; telefono: string; email: string | null }[];
}
```

También hay que admitir jugadores sin móvil, que es lo que la migración habilita:

```ts
export interface JugadorSemilla {
  nombre?: string;
  apellidos?: string;
  /** `""` siembra un jugador sin móvil. */
  telefono?: string;
  email?: string | null;
  redSocial?: string | null;
  fotoKey?: string | null;
}
```

(El cuerpo ya hace `semilla.telefono ?? …`, así que `""` pasa tal cual; `normalizarTelefono("")` devuelve `""`. No hace falta tocar nada más.)

- [ ] **Step 3: Actualizar las cinco llamadas con `ownerUserId`**

Los tests que ataban un equipo a una cuenta lo hacían con `ownerUserId`. Ahora se ata poniendo el correo de esa cuenta en el jugador capitán:

- `test/integration/avatar.test.ts:35` — `ownerUserId: user.id,` → borrar la línea y asegurarse de que la lista de jugadores empieza por `{ email: user.email }`.
- `test/integration/perfil.test.ts:16` — `crearEquipo({ ownerUserId: user.id, jugadores: [{ email: "capi@example.com" }, {}] })` → `crearEquipo({ jugadores: [{ email: user.email }, {}] })`.
- `test/integration/equipos-alta.test.ts:37` y `:52` — misma sustitución, usando el correo del usuario que el test considera dueño.
- `test/integration/mi-equipo.test.ts:55` — `ownerUserId: dueño.id` → quitar; el primer jugador ya lleva el correo del dueño (comprobarlo y, si no, ponerlo).

En cada fichero, leer alrededor para no romper la intención del test: donde el equipo era «de nadie» (sin `ownerUserId`), sembrar los jugadores con correos ajenos.

- [ ] **Step 4: Escribir el test de la migración**

Crear `test/integration/capitan.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { crearEquipo, crearUsuario } from "../helpers/db";

/*
 * La migración 0011 mueve el mando de equipos.owner_user_id a
 * equipos.capitan_jugador_id y hace opcional el móvil. Estos dos hechos son la
 * base de todo lo demás, así que se comprueban contra la base real.
 */
describe("esquema del capitán", () => {
  it("el equipo sembrado guarda a su capitán", async () => {
    const equipo = await crearEquipo({ jugadores: [{ email: "capi@example.com" }, {}] });

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();

    expect(fila?.capitan_jugador_id).toBe(equipo.jugadores[0]!.id);
  });

  it("admite dos jugadores sin móvil en equipos distintos", async () => {
    await crearEquipo({ jugadores: [{ telefono: "" }, {}] });
    await expect(crearEquipo({ jugadores: [{ telefono: "" }, {}] })).resolves.toBeTruthy();
  });

  it("ya no existe la columna owner_user_id", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(equipos)").all<{ name: string }>();
    expect(results.map((c) => c.name)).not.toContain("owner_user_id");
    expect(results.map((c) => c.name)).toContain("capitan_jugador_id");
  });

  it("borrar al capitán deja el equipo sin capitán en vez de fallar", async () => {
    const equipo = await crearEquipo();
    await env.DB.prepare("DELETE FROM jugadores WHERE id = ?1").bind(equipo.capitanId).run();

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();

    expect(fila?.capitan_jugador_id).toBeNull();
  });

  it("una cuenta puede ser capitana de un equipo aunque otro la tuviera antes", async () => {
    const user = await crearUsuario({ email: "doble@example.com" });
    await crearEquipo({ jugadores: [{ email: "otro@example.com" }, {}] });
    await expect(
      crearEquipo({ jugadores: [{ email: user.email }, {}] })
    ).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 5: Ver el test fallar**

Ejecutar: `npx vitest run --project integration test/integration/capitan.test.ts`
Esperado: FALLA — `no such column: capitan_jugador_id` (la migración todavía no se ha aplicado en el runner) o error de tipos en `crearEquipo`. Si la migración ya se recoge sola, fallará igualmente el resto del backend, que sigue leyendo `owner_user_id`.

- [ ] **Step 6: Reescribir `functions/_lib/equipos.ts`**

Sustituir `EquipoUsuarioRow`, `equipoDeUsuario` y `equipoPropioDeUsuario`, y borrar `registroIncluyeEmailUsuario`:

```ts
export interface EquipoUsuarioRow {
  id: number;
  nombre: string;
  created_at: string;
  edicion_id: number | null;
  capitan_jugador_id: number | null;
}

/**
 * Equipo en el que el usuario figura: como capitán, o como jugador con su
 * correo en la plantilla. Vale para **mirar**. El capitán tiene preferencia
 * cuando hay más de uno.
 */
export async function equipoDeUsuario(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<EquipoUsuarioRow | null> {
  const emailNormalizado = normalizarEmail(user.email);
  const filtroEdicion = edicionId != null ? "AND e.edicion_id = ?2" : "";

  const stmt = db.prepare(
    `SELECT e.id, e.nombre, e.created_at, e.edicion_id, e.capitan_jugador_id
     FROM equipos e
     LEFT JOIN jugadores j
       ON j.equipo_id = e.id AND j.email_normalizado = ?1
     LEFT JOIN jugadores c
       ON c.id = e.capitan_jugador_id AND c.email_normalizado = ?1
     WHERE (j.id IS NOT NULL OR c.id IS NOT NULL)
       ${filtroEdicion}
     GROUP BY e.id
     ORDER BY
       CASE WHEN c.id IS NOT NULL THEN 0 ELSE 1 END ASC,
       e.created_at ASC,
       e.id ASC
     LIMIT 1`
  );

  return await (edicionId != null
    ? stmt.bind(emailNormalizado, edicionId)
    : stmt.bind(emailNormalizado)
  ).first<EquipoUsuarioRow>();
}

/**
 * Equipo del que el usuario es **capitán**, y solo eso. Es lo que autoriza a
 * escribir.
 *
 * La otra vía de equipoDeUsuario —figurar en la plantilla con tu correo— vale
 * para mirar, pero no para modificar: ese correo lo teclea quien inscribe el
 * equipo, sin que su dueño confirme nada. La fila del capitán es distinta: o la
 * verificó Google al inscribir, o la designó el capitán anterior a propósito.
 */
export async function equipoDelCapitan(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<EquipoUsuarioRow | null> {
  const emailNormalizado = normalizarEmail(user.email);
  const filtroEdicion = edicionId != null ? "AND e.edicion_id = ?2" : "";

  const stmt = db.prepare(
    `SELECT e.id, e.nombre, e.created_at, e.edicion_id, e.capitan_jugador_id
     FROM equipos e
     JOIN jugadores c ON c.id = e.capitan_jugador_id
     WHERE c.email_normalizado = ?1
       ${filtroEdicion}
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT 1`
  );

  return await (edicionId != null
    ? stmt.bind(emailNormalizado, edicionId)
    : stmt.bind(emailNormalizado)
  ).first<EquipoUsuarioRow>();
}
```

Borrar la función `registroIncluyeEmailUsuario` entera y su import de `RegistroValidado` si queda sin uso (`buscarDuplicadosEdicion` lo sigue usando, así que el import se queda).

- [ ] **Step 7: Fijar el capitán al guardar (`functions/_lib/equipo-editor.ts`)**

En `guardarEquipo`, **después** del `forEach` que empuja los UPDATE/INSERT de jugadores y **antes** del `try { await env.DB.batch(statements) }`, añadir la última sentencia del batch:

```ts
  // El capitán se resuelve por `orden`, que este mismo batch acaba de fijar
  // (orden = índice + 1, único dentro del equipo). Va al final porque los
  // jugadores nuevos no tienen id hasta que se insertan.
  statements.push(
    env.DB
      .prepare(
        `UPDATE equipos SET capitan_jugador_id =
           (SELECT id FROM jugadores WHERE equipo_id = ?1 AND orden = ?2)
         WHERE id = ?1`
      )
      .bind(equipoId, registro.capitan + 1)
  );
```

`registro.capitan` todavía no existe en `RegistroValidado` — lo añade la Tarea 2. Para que esta tarea compile y no cambie comportamiento, usar de momento:

```ts
      .bind(equipoId, (registro.capitan ?? 0) + 1)
```

y declarar el campo opcional en `RegistroValidado` (`capitan?: number`). La Tarea 2 lo hace obligatorio y quita el `?? 0`.

- [ ] **Step 8: Alta de equipo (`functions/api/equipos.ts`)**

1. En el INSERT del equipo, quitar `owner_user_id` de columnas y binds:

```ts
      env.DB
        .prepare(
          "INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at, edicion_id) VALUES (?1, ?2, ?3, ?4)"
        )
        .bind(registro.equipo, registro.equipoNormalizado, new Date().toISOString(), edicion.id),
```

2. Añadir al final del array `statements` (después del `...registro.jugadores.map(...)`) la sentencia que nombra capitán al jugador que lleva el correo de la sesión —que hoy la validación garantiza que existe—:

```ts
      env.DB
        .prepare(
          `UPDATE equipos SET capitan_jugador_id = (
             SELECT j.id FROM jugadores j
             WHERE j.equipo_id = equipos.id AND j.email_normalizado = ?2
             ORDER BY j.orden ASC LIMIT 1
           ) WHERE nombre_normalizado = ?1`
        )
        .bind(registro.equipoNormalizado, normalizarEmail(user.email))
```

(La Tarea 2 lo cambia por el índice explícito `registro.capitan`.) Importar `normalizarEmail` desde `../_lib/validacion`.

3. En `mapearConflictoUnique`, borrar la rama de `equipos.owner_user_id`.
4. En `mapearErrorEsquema`, borrar la rama de `no such column: owner_user_id` y dejar solo la de `usuarios`.
5. Sustituir el import y el uso de `equipoPropioDeUsuario` por `equipoDelCapitan`.

- [ ] **Step 9: `functions/api/mi-equipo.ts`**

1. Cambiar los tres usos de `equipoPropioDeUsuario` por `equipoDelCapitan` (PATCH y DELETE) y el import.
2. En `cargarEquipo`, sustituir la consulta de la fila del equipo y el cálculo de `puedeEditar`:

```ts
  // La foto de grupo la gestiona solo el administrador; aquí el capitán la ve.
  const fila = await db
    .prepare(
      `SELECT e.foto_key, e.capitan_jugador_id, c.email_normalizado AS capitan_email
       FROM equipos e
       LEFT JOIN jugadores c ON c.id = e.capitan_jugador_id
       WHERE e.id = ?1`
    )
    .bind(team.id)
    .first<{ foto_key: string | null; capitan_jugador_id: number | null; capitan_email: string | null }>();

  return {
    id: team.id,
    nombre: team.nombre,
    createdAt: team.created_at,
    tieneFoto: Boolean(fila?.foto_key),
    capitanJugadorId: fila?.capitan_jugador_id ?? null,
    // Quien no es el capitán ve la ficha, pero el editor se pinta en modo
    // lectura: el PATCH le respondería 403 igualmente.
    puedeEditar: Boolean(fila?.capitan_email) && fila!.capitan_email === normalizarEmail(user.email),
    jugadores: results.map((jugador) => ({
      id: jugador.id,
      nombre: jugador.nombre,
      apellidos: jugador.apellidos,
      telefono: jugador.telefono || null,
      email: jugador.email,
      redSocial: jugador.red_social,
      tieneFoto: Boolean(jugador.foto_key),
      esSuplente: jugador.es_suplente === 1,
      orden: jugador.orden
    }))
  };
```

Importar `normalizarEmail` de `../_lib/validacion`.

3. Quitar el bloque `if (!registroIncluyeEmailUsuario(...))` del PATCH y su import (la Tarea 3 pone la regla nueva en su lugar).
4. Actualizar los mensajes de `noEsTuEquipo()` y `sinPermisoParaEscribir` para hablar de capitán:

```ts
const noEsTuEquipo = (): Response =>
  json(
    {
      error:
        "Solo el capitán puede cambiar el equipo. Pídeselo a esa persona o escríbenos a copa.arena.2000@gmail.com."
    },
    403,
    { "Cache-Control": "no-store" }
  );
```

- [ ] **Step 10: `functions/_lib/admin.ts` y `functions/api/admin/index.ts`**

En `mapJugador`, exponer el móvil vacío como nulo:

```ts
    telefono: jugador.telefono || null,
```

En `cargarEquipoConJugadores`, cambiar el JOIN de `usuarios` por el del capitán:

```ts
  const equipo = await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at, e.foto_key, e.edicion_id, e.capitan_jugador_id,
              c.email AS capitan_email, c.nombre AS capitan_nombre, c.apellidos AS capitan_apellidos
       FROM equipos e
       LEFT JOIN jugadores c ON c.id = e.capitan_jugador_id
       WHERE e.id = ?1`
    )
    .bind(equipoId)
    .first<{
      id: number;
      nombre: string;
      created_at: string;
      foto_key: string | null;
      edicion_id: number | null;
      capitan_jugador_id: number | null;
      capitan_email: string | null;
      capitan_nombre: string | null;
      capitan_apellidos: string | null;
    }>();
```

y en el objeto devuelto, sustituir las tres claves `owner*`:

```ts
    capitanJugadorId: equipo.capitan_jugador_id,
    capitanEmail: equipo.capitan_email,
    capitanNombre: [equipo.capitan_nombre, equipo.capitan_apellidos].filter(Boolean).join(" ") || null,
```

En `functions/api/admin/index.ts`, hacer el mismo cambio en la consulta de `cargarEquipos` (mismo JOIN, mismos alias) y en el objeto de `equipos.map(...)`. **No** tocar el bloque de `camisetas`: su `ownerEmail` viene de `camisetas_reservas.owner_user_id`, que es otra columna y sigue igual.

- [ ] **Step 11: `functions/api/admin/equipos.ts` — la ficha manda capitán**

Sustituir el bloque `if (body.ownerUserId !== undefined)` de `actualizarFicha` por:

```ts
  if (body.capitanJugadorId !== undefined) {
    const capitanId =
      body.capitanJugadorId === null || body.capitanJugadorId === "" ? null : Number(body.capitanJugadorId);
    if (capitanId !== null) {
      if (!Number.isInteger(capitanId)) return accionNoValida();
      const jugador = await db
        .prepare("SELECT id, telefono, email FROM jugadores WHERE id = ?1 AND equipo_id = ?2")
        .bind(capitanId, equipoId)
        .first<{ id: number; telefono: string; email: string | null }>();
      if (!jugador) {
        return jsonAdmin(
          { error: "Ese jugador no está en el equipo.", campos: { capitanJugadorId: "Elige un jugador de la plantilla." } },
          400
        );
      }
      // El capitán es el contacto del equipo y quien puede editarlo: sin móvil
      // ni correo el equipo se quedaría sin nadie con quien hablar y sin editor.
      if (!jugador.telefono || !jugador.email) {
        return jsonAdmin(
          {
            error: "El capitán necesita móvil y correo.",
            campos: { capitanJugadorId: "Rellena su móvil y su correo antes de nombrarle capitán." }
          },
          400
        );
      }
    }
    statements.push(db.prepare("UPDATE equipos SET capitan_jugador_id = ?1 WHERE id = ?2").bind(capitanId, equipoId));
  }
```

Actualizar también el comentario de cabecera del fichero (línea 5): `PATCH ?id=N&accion=ficha      edición y capitán del equipo`.

- [ ] **Step 12: Cliente del panel — columna «Capitán»**

En `public/assets/admin/equipos.js`:

```js
          { etiqueta: "Capitán", clase: "is-clip", render: (e) => text(e.capitanEmail) },
```

y en `textoBuscable`:

```js
    return `${equipo.nombre} ${equipo.capitanEmail || ""} ${jugadores}`.toLowerCase();
```

- [ ] **Step 13: Actualizar CLAUDE.md**

En la sección «Admin panel», sustituir el párrafo que empieza por **«Two ways to belong to a team, only one of them authorizes writes»** por:

```markdown
- **Two ways to belong to a team, only one of them authorizes writes.** `equipoDeUsuario` matches any player row carrying your email — but that email is typed by whoever registered the team, with no confirmation from its owner. So `GET /api/mi-equipo` uses it (any listed player sees the roster, with `puedeEditar: false`), while `PATCH`/`DELETE` go through `equipoDelCapitan`, which only matches the team's **captain** (`equipos.capitan_jugador_id` → the player row whose email is yours). The captain is the only player whose phone and email are mandatory, and the only one who can hand the team over — by designating another player as captain. A team created from the admin panel has no captain until one is set, and until then nobody can edit it from `/mi-equipo/`.
```

En la sección «Backend», en la frase sobre migraciones, añadir tras «Main tables: `equipos`, `jugadores` (0002)»: «`equipos.capitan_jugador_id` (0011) sustituyó a `owner_user_id`; el móvil de los jugadores que no son capitán es opcional y se guarda como cadena vacía».

- [ ] **Step 14: Ver los tests en verde**

Ejecutar: `npx vitest run --project integration test/integration/capitan.test.ts`
Esperado: PASA (5 tests).

Ejecutar: `npm test`
Esperado: todo verde. Si algún test de `mi-equipo`/`equipos-alta`/`perfil`/`avatar` falla por la semilla, corregir la semilla (no el aserto): el comportamiento no ha cambiado en esta tarea.

Ejecutar: `npm run test:types`
Esperado: sin errores.

- [ ] **Step 15: Commit**

```bash
git add db/migrations/0011_capitan.sql functions/ public/assets/admin/equipos.js test/ CLAUDE.md
git commit -m "feat: el capitán del equipo sustituye a owner_user_id"
```

---

### Task 2: `capitan` en la validación y contacto opcional

Hace explícito el capitán en el payload y deja móvil y correo como opcionales para el resto.

**Files:**
- Modify: `functions/_lib/validacion.ts`, `functions/_lib/equipos.ts`, `functions/_lib/equipo-editor.ts`, `functions/api/equipos.ts`, `functions/api/mi-equipo.ts`, `functions/api/admin/equipos.ts`
- Test: `test/unit/validacion.test.ts`, `test/integration/equipos-alta.test.ts`, `test/integration/equipo-editor.test.ts`, `test/integration/mi-equipo.test.ts`

**Interfaces:**
- Consumes: `equipoDelCapitan`, `equipos.capitan_jugador_id` (Tarea 1).
- Produces:
  - `RegistroValidado { equipo: string; equipoNormalizado: string; capitan: number; jugadores: JugadorValidado[] }` — `capitan` es el índice dentro de `jugadores`, obligatorio.
  - `OpcionesValidacion { requireConsent?: boolean; emailCapitanObligatorio?: string }` — desaparecen `ownerEmail` y `requirePlayerEmail`.
  - `MENSAJE_CAPITAN_CONTACTO` exportado desde `validacion.ts` (mismo literal en `team-form.js`).
  - `JugadorValidado.telefono` y `.telefonoNormalizado` pueden ser `""`.

- [ ] **Step 1: Escribir los tests de validación**

Añadir a `test/unit/validacion.test.ts` (usando el helper `registroValido()` que ya existe en el fichero; comprobar su forma y añadirle `capitan: 0`):

```ts
describe("capitán", () => {
  it("exige que el payload diga quién es el capitán", () => {
    const errores = campos(validarRegistro({ ...registroValido(), capitan: undefined }));
    expect(errores.capitan).toBe("Indica quién es el capitán del equipo.");
  });

  it("rechaza un capitán fuera de la plantilla", () => {
    const errores = campos(validarRegistro({ ...registroValido(), capitan: 7 }));
    expect(errores.capitan).toBe("Indica quién es el capitán del equipo.");
  });

  it("exige móvil y correo al capitán", () => {
    const base = registroValido();
    base.jugadores[0].telefono = "";
    base.jugadores[0].email = "";
    const errores = campos(validarRegistro({ ...base, capitan: 0 }));
    expect(errores["jugadores.0.telefono"]).toBe(MENSAJE_CAPITAN_CONTACTO);
    expect(errores["jugadores.0.email"]).toBe(MENSAJE_CAPITAN_CONTACTO);
  });

  it("deja sin móvil ni correo a quien no es capitán", () => {
    const base = registroValido();
    base.jugadores[1].telefono = "";
    base.jugadores[1].email = "";
    const resultado = validarRegistro({ ...base, capitan: 0 });
    expect("registro" in resultado).toBe(true);
    if ("registro" in resultado) {
      expect(resultado.registro.jugadores[1]!.telefono).toBe("");
      expect(resultado.registro.jugadores[1]!.telefonoNormalizado).toBe("");
      expect(resultado.registro.jugadores[1]!.email).toBeNull();
      expect(resultado.registro.capitan).toBe(0);
    }
  });

  it("valida el formato del móvil cuando sí se rellena", () => {
    const base = registroValido();
    base.jugadores[1].telefono = "123";
    const errores = campos(validarRegistro({ ...base, capitan: 0 }));
    expect(errores["jugadores.1.telefono"]).toBe(
      "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
    );
  });

  it("no toma por duplicados a dos jugadores sin móvil", () => {
    const base = registroValido();
    base.jugadores[1].telefono = "";
    base.jugadores.push({ nombre: "Tres", apellidos: "Tercero", telefono: "", email: "" });
    const errores = campos(validarRegistro({ ...base, capitan: 0 }));
    expect(errores["jugadores.1.telefono"]).toBeUndefined();
    expect(errores["jugadores.2.telefono"]).toBeUndefined();
  });

  it("exige que el correo del capitán sea el de la sesión cuando se pide", () => {
    const errores = campos(
      validarRegistro({ ...registroValido(), capitan: 0 }, { emailCapitanObligatorio: "otra@example.com" })
    );
    expect(errores["jugadores.0.email"]).toBe(
      "El capitán debe usar el correo con el que has iniciado sesión."
    );
  });
});
```

Importar `MENSAJE_CAPITAN_CONTACTO` en la cabecera del fichero de test. Además: borrar el test existente que usaba `requirePlayerEmail: false` (línea ~191) y el que usaba `ownerEmail` (líneas ~277-283), sustituidos por los de arriba; y añadir `capitan: 0` a `registroValido()` para que el resto del fichero siga pasando.

- [ ] **Step 2: Ver los tests fallar**

Ejecutar: `npx vitest run --project unit test/unit/validacion.test.ts`
Esperado: FALLA — `MENSAJE_CAPITAN_CONTACTO` no se exporta y `capitan` no se valida.

- [ ] **Step 3: Implementar en `functions/_lib/validacion.ts`**

Cambiar interfaces y opciones:

```ts
export const MENSAJE_CAPITAN_CONTACTO = "El capitán necesita móvil y correo para que podamos avisaros.";

export interface RegistroValidado {
  equipo: string;
  equipoNormalizado: string;
  /** Índice, dentro de `jugadores`, de quien manda en el equipo. */
  capitan: number;
  jugadores: JugadorValidado[];
}

interface OpcionesValidacion {
  requireConsent?: boolean;
  /** Correo que debe llevar el capitán (el de la sesión, en el alta). */
  emailCapitanObligatorio?: string;
}
```

En `validarRegistro`, sustituir las tres primeras líneas de opciones por:

```ts
  const campos: Record<string, string> = {};
  const requireConsent = opciones.requireConsent !== false;
  const emailCapitan = opciones.emailCapitanObligatorio
    ? normalizarEmail(opciones.emailCapitanObligatorio)
    : "";
```

Después del bloque que valida `jugadoresRaw.length`, resolver el capitán:

```ts
  // El capitán llega como índice dentro de la plantilla enviada. No hay valor
  // por defecto a propósito: dar por supuesto el jugador 1 en un guardado
  // podría cambiar el mando de un equipo sin que nadie lo pidiera.
  const capitanRaw = body.capitan;
  const capitan =
    typeof capitanRaw === "number" && Number.isInteger(capitanRaw)
      ? capitanRaw
      : typeof capitanRaw === "string" && /^\d+$/.test(capitanRaw)
        ? Number(capitanRaw)
        : -1;
  const totalJugadores = Math.min(jugadoresRaw.length, MAX_JUGADORES);
  if (capitan < 0 || capitan >= totalJugadores) {
    campos.capitan = "Indica quién es el capitán del equipo.";
  }
```

Dentro del `forEach` de jugadores, añadir al principio `const esCapitan = i === capitan;` y sustituir los bloques de teléfono y correo:

```ts
    // Móvil: obligatorio solo para el capitán. Quien no lo dé se queda fuera
    // del grupo del torneo, y el formulario ya se lo avisa.
    const telefono = limpiar(j.telefono);
    const telefonoNormalizado = telefono ? normalizarTelefono(telefono) : "";
    if (!telefono) {
      if (esCapitan) campos[clave("telefono")] = MENSAJE_CAPITAN_CONTACTO;
    } else if (!MOVIL_PATTERN.test(telefonoNormalizado)) {
      campos[clave("telefono")] = "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos).";
    }

    let email: string | null = null;
    let emailNormalizado: string | null = null;
    const emailRaw = limpiar(j.email);
    if (emailRaw) {
      if (!EMAIL_PATTERN.test(emailRaw) || emailRaw.length > 120) {
        campos[clave("email")] = "Ese correo no parece válido.";
      } else {
        email = emailRaw;
        emailNormalizado = normalizarEmail(emailRaw);
        if (esCapitan && emailCapitan && emailNormalizado !== emailCapitan) {
          campos[clave("email")] = "El capitán debe usar el correo con el que has iniciado sesión.";
        }
      }
    } else if (esCapitan) {
      campos[clave("email")] = MENSAJE_CAPITAN_CONTACTO;
    }
```

Borrar las variables `hayEmail` y `hayOwnerEmail`, el bloque `if (!hayEmail && !requirePlayerEmail …)` y el bloque final `if (ownerEmailNormalizado && !hayOwnerEmail …)` junto con `hayErroresEmail`.

En el bucle de duplicados internos, saltar los móviles vacíos:

```ts
    if (j.telefonoNormalizado) {
```

(ya está así — comprobarlo; si estuviera comparando cadenas vacías, corregirlo.)

Y en el `return` final:

```ts
  return {
    registro: {
      equipo,
      equipoNormalizado: normalizarTexto(equipo),
      capitan,
      jugadores
    }
  };
```

- [ ] **Step 4: Duplicados con móvil vacío**

En `functions/_lib/equipos.ts` (`buscarDuplicadosEdicion`) y en `functions/api/equipos.ts` (`buscarDuplicados`), sustituir la construcción de la lista de teléfonos y su cláusula:

```ts
  const nombres = registro.jugadores.map((j) => j.nombreCompletoNormalizado);
  const telefonos = registro.jugadores.flatMap((j) => (j.telefonoNormalizado ? [j.telefonoNormalizado] : []));
  const emails = registro.jugadores.flatMap((j) => (j.emailNormalizado ? [j.emailNormalizado] : []));

  const clausulas = [`nombre_completo_normalizado IN (${nombres.map(() => "?").join(",")})`];
  const binds: (string | number)[] = [...nombres];
  if (telefonos.length > 0) {
    clausulas.push(`telefono_normalizado IN (${telefonos.map(() => "?").join(",")})`);
    binds.push(...telefonos);
  }
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }
```

y en el marcado de errores por jugador, no marcar a quien no tiene móvil:

```ts
    if (j.telefonoNormalizado && telefonosOcupados.has(j.telefonoNormalizado)) {
```

(En `api/equipos.ts` el `binds` es `string[]` y no lleva `equipoId`; mantener esa diferencia.)

- [ ] **Step 5: Ajustar los llamantes**

1. `functions/api/equipos.ts`: `validarRegistro(payload, { emailCapitanObligatorio: user.email })`. Y la sentencia del capitán pasa a usar el índice:

```ts
      env.DB
        .prepare(
          `UPDATE equipos SET capitan_jugador_id = (
             SELECT j.id FROM jugadores j
             WHERE j.equipo_id = equipos.id AND j.orden = ?2
           ) WHERE nombre_normalizado = ?1`
        )
        .bind(registro.equipoNormalizado, registro.capitan + 1)
```

(y quitar el import de `normalizarEmail` si ya no se usa).

2. `functions/api/admin/equipos.ts`: `validarRegistro(payload, { requireConsent: false })`.
3. `functions/_lib/equipo-editor.ts`: quitar la guarda `if (registro.capitan !== undefined)` que envolvía la sentencia del capitán y dejarla incondicional. Existía solo para que la Tarea 1 no cambiara de capitán en cada guardado, cuando el campo aún no lo enviaba nadie; con `capitan` ya obligatorio en `RegistroValidado`, la guarda sería código muerto.
4. `functions/api/mi-equipo.ts`: `validarRegistro(body, { requireConsent: false })`.

- [ ] **Step 6: Ver los tests pasar**

Ejecutar: `npx vitest run --project unit test/unit/validacion.test.ts`
Esperado: PASA.

- [ ] **Step 7: Actualizar los tests de integración que envían plantillas**

En `test/integration/equipos-alta.test.ts`, `equipo-editor.test.ts` y `mi-equipo.test.ts`, todos los payloads que van a `POST /api/equipos`, `PATCH /api/mi-equipo` o `PATCH /api/admin/equipos` necesitan `capitan: 0` (o el índice que corresponda). Añadirlo. Donde un test comprobaba «el correo de cada jugador es obligatorio», reescribirlo para que compruebe la regla nueva: el correo solo lo exige el capitán.

Añadir a `test/integration/equipos-alta.test.ts`:

```ts
  it("guarda al capitán indicado en el alta", async () => {
    const user = await crearUsuario({ email: "capi@example.com" });
    const payload = {
      equipo: "Los Rompeolas",
      consentimiento: true,
      capitan: 1,
      jugadores: [
        { nombre: "Ana", apellidos: "Pérez", telefono: "", email: "" },
        { nombre: "Luis", apellidos: "Gómez", telefono: "600111222", email: user.email }
      ]
    };
    const datos = new FormData();
    datos.append("payload", JSON.stringify(payload));

    const respuesta = await onRequestPost(
      ctx(await peticion("/api/equipos", { method: "POST", user, body: datos }), env)
    );
    expect(respuesta.status).toBe(201);

    const fila = await env.DB
      .prepare(
        `SELECT c.email FROM equipos e JOIN jugadores c ON c.id = e.capitan_jugador_id
         WHERE e.nombre = ?1`
      )
      .bind("Los Rompeolas")
      .first<{ email: string }>();
    expect(fila?.email).toBe(user.email);
  });
```

(Adaptar los imports y el helper de contexto a los que ya usa el fichero.)

- [ ] **Step 8: Ver toda la suite en verde**

Ejecutar: `npm test`
Esperado: verde.

Ejecutar: `npm run test:types`
Esperado: sin errores.

- [ ] **Step 9: Commit**

```bash
git add functions/ test/
git commit -m "feat: el capitán viaja en el payload y solo él necesita contacto"
```

---

### Task 3: Cesión del mando en `PATCH /api/mi-equipo`

**Files:**
- Modify: `functions/api/mi-equipo.ts`
- Test: `test/integration/mi-equipo.test.ts`

**Interfaces:**
- Consumes: `equipoDelCapitan` (Tarea 1), `RegistroValidado.capitan` (Tarea 2).
- Produces: `PATCH /api/mi-equipo` responde `{ ok: true, user, team }` donde `team` es `null` si el guardado dejó al usuario fuera del equipo.

**Nota de diseño:** «no se puede quitar al capitán sin designar otro» no necesita código: `capitan` siempre apunta a alguien de la plantilla enviada, así que quitar al capitán actual **es** una cesión. Lo único que hay que impedir es la cesión encubierta: cambiarle el correo a la fila del capitán actual.

- [ ] **Step 1: Escribir los tests**

Añadir a `test/integration/mi-equipo.test.ts` (reutilizando sus helpers de contexto y semilla):

```ts
describe("cesión del mando", () => {
  it("el capitán cede a otro jugador y deja de poder guardar", async () => {
    const capi = await crearUsuario({ email: "capi@example.com" });
    const relevo = await crearUsuario({ email: "relevo@example.com" });
    const equipo = await crearEquipo({
      jugadores: [
        { email: capi.email, telefono: "600111222" },
        { email: relevo.email, telefono: "600333444" }
      ]
    });

    const cesion = await onRequestPatch(
      ctx(
        await peticion("/api/mi-equipo", {
          method: "PATCH",
          user: capi,
          json: {
            equipo: equipo.nombre,
            capitan: 1,
            jugadores: equipo.jugadores.map((j) => ({
              id: j.id,
              nombre: j.nombre,
              apellidos: j.apellidos,
              telefono: j.telefono,
              email: j.email
            }))
          }
        }),
        env
      )
    );
    expect(cesion.status).toBe(200);

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number }>();
    expect(fila?.capitan_jugador_id).toBe(equipo.jugadores[1]!.id);

    // El anterior capitán ya no manda.
    const segundoIntento = await onRequestPatch(
      ctx(
        await peticion("/api/mi-equipo", {
          method: "PATCH",
          user: capi,
          json: { equipo: "Otro nombre", capitan: 0, jugadores: [] }
        }),
        env
      )
    );
    expect(segundoIntento.status).toBe(403);
  });

  it("no deja cambiar el correo del capitán sin ceder", async () => {
    const capi = await crearUsuario({ email: "capi2@example.com" });
    const equipo = await crearEquipo({
      jugadores: [{ email: capi.email, telefono: "600111222" }, { telefono: "600333444" }]
    });

    const respuesta = await onRequestPatch(
      ctx(
        await peticion("/api/mi-equipo", {
          method: "PATCH",
          user: capi,
          json: {
            equipo: equipo.nombre,
            capitan: 0,
            jugadores: [
              { ...basico(equipo.jugadores[0]!), email: "suplantado@example.com" },
              basico(equipo.jugadores[1]!)
            ]
          }
        }),
        env
      )
    );

    expect(respuesta.status).toBe(400);
    const cuerpo = (await respuesta.json()) as { error: string };
    expect(cuerpo.error).toContain("designa a otro capitán");
  });

  it("cede y sale del equipo en el mismo guardado", async () => {
    const capi = await crearUsuario({ email: "capi3@example.com" });
    const relevo = await crearUsuario({ email: "relevo3@example.com" });
    const equipo = await crearEquipo({
      jugadores: [
        { email: capi.email, telefono: "600111222" },
        { email: relevo.email, telefono: "600333444" },
        { telefono: "600555666" }
      ]
    });

    const respuesta = await onRequestPatch(
      ctx(
        await peticion("/api/mi-equipo", {
          method: "PATCH",
          user: capi,
          json: {
            equipo: equipo.nombre,
            capitan: 0,
            jugadores: [basico(equipo.jugadores[1]!), basico(equipo.jugadores[2]!)]
          }
        }),
        env
      )
    );

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ ok: true, team: null });
  });
});
```

Añadir arriba del `describe` el helper local:

```ts
const basico = (j: { id: number; nombre: string; apellidos: string; telefono: string; email: string | null }) => ({
  id: j.id,
  nombre: j.nombre,
  apellidos: j.apellidos,
  telefono: j.telefono,
  email: j.email ?? ""
});
```

- [ ] **Step 2: Ver los tests fallar**

Ejecutar: `npx vitest run --project integration test/integration/mi-equipo.test.ts`
Esperado: FALLA — el segundo test devuelve 200 en vez de 400 (todavía no existe la regla).

- [ ] **Step 3: Implementar la regla en `functions/api/mi-equipo.ts`**

En `onRequestPatch`, justo después de validar y antes de `guardarEquipo`:

```ts
  const registro = resultado.registro;
  const nuevoCapitan = registro.jugadores[registro.capitan]!;
  const sigueMandando =
    nuevoCapitan.id !== undefined && nuevoCapitan.id === currentTeam.capitan_jugador_id;

  // Cambiar el correo de la fila del capitán sería ceder el equipo por la
  // puerta de atrás: quien entrase con ese correo pasaría a mandar. Ceder es un
  // acto explícito, así que se pide hacerlo nombrando a otro capitán.
  if (sigueMandando && nuevoCapitan.emailNormalizado !== normalizarEmail(user.email)) {
    return json(
      {
        error: "Para ceder el equipo, designa a otro capitán.",
        campos: {
          [`jugadores.${registro.capitan}.email`]: "Mantén el correo con el que has iniciado sesión."
        }
      },
      400
    );
  }
```

y sustituir el `guardarEquipo(env, currentTeam.id, resultado.registro)` por `guardarEquipo(env, currentTeam.id, registro)`.

La respuesta ya llama a `cargarEquipo`, que devuelve `null` cuando el usuario deja de figurar: no hay que tocarla, pero sí comprobar que `json({ ok: true, user: publicUser(user), team })` acepta `team: null` (lo acepta).

- [ ] **Step 4: Ver los tests pasar**

Ejecutar: `npx vitest run --project integration test/integration/mi-equipo.test.ts`
Esperado: PASA.

- [ ] **Step 5: Commit**

```bash
git add functions/api/mi-equipo.ts test/integration/mi-equipo.test.ts
git commit -m "feat: ceder el equipo designando a otro capitán"
```

---

### Task 4: El capitán en `/api/admin/jugadores`

El panel edita jugadores de uno en uno, con su propia validación. Hay que alinearla y proteger al capitán de que le borren o le muevan de equipo dejando al suyo sin nadie al mando.

**Files:**
- Modify: `functions/api/admin/jugadores.ts`
- Test: `test/integration/capitan.test.ts`

**Interfaces:**
- Consumes: `equipos.capitan_jugador_id` (Tarea 1).
- Produces: `validarJugador(valores, opciones)` acepta `{ esCapitan: boolean }`; `DELETE`/`PATCH` devuelven 409 al tocar a un capitán.

- [ ] **Step 1: Escribir los tests**

Añadir a `test/integration/capitan.test.ts`:

```ts
describe("el capitán en /api/admin/jugadores", () => {
  it("no deja borrar al capitán de un equipo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const respuesta = await onRequestDelete(
      ctx(await peticion(`/api/admin/jugadores?id=${equipo.capitanId}`, { method: "DELETE", user: admin }), env)
    );

    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: string };
    expect(cuerpo.error).toContain("capitán");
  });

  it("no deja mover al capitán a otro equipo", async () => {
    const admin = await crearAdmin();
    const origen = await crearEquipo();
    const destino = await crearEquipo();

    const datos = new FormData();
    datos.append("equipoId", String(destino.id));
    datos.append("nombre", origen.jugadores[0]!.nombre);
    datos.append("apellidos", origen.jugadores[0]!.apellidos);
    datos.append("telefono", origen.jugadores[0]!.telefono);
    datos.append("email", origen.jugadores[0]!.email ?? "");

    const respuesta = await onRequestPatch(
      ctx(
        await peticion(`/api/admin/jugadores?id=${origen.capitanId}`, {
          method: "PATCH",
          user: admin,
          body: datos
        }),
        env
      )
    );

    expect(respuesta.status).toBe(409);
  });

  it("admite crear un jugador sin móvil ni correo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const datos = new FormData();
    datos.append("equipoId", String(equipo.id));
    datos.append("nombre", "Sinsa");
    datos.append("apellidos", "Contacto");
    datos.append("telefono", "");
    datos.append("email", "");

    const respuesta = await onRequestPost(
      ctx(await peticion("/api/admin/jugadores", { method: "POST", user: admin, body: datos }), env)
    );

    expect(respuesta.status).toBe(201);
  });

  it("sigue exigiendo contacto al jugador que es capitán", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const datos = new FormData();
    datos.append("equipoId", String(equipo.id));
    datos.append("nombre", equipo.jugadores[0]!.nombre);
    datos.append("apellidos", equipo.jugadores[0]!.apellidos);
    datos.append("telefono", "");
    datos.append("email", "");

    const respuesta = await onRequestPatch(
      ctx(
        await peticion(`/api/admin/jugadores?id=${equipo.capitanId}`, {
          method: "PATCH",
          user: admin,
          body: datos
        }),
        env
      )
    );

    expect(respuesta.status).toBe(400);
  });
});
```

Importar en la cabecera `onRequestPost`, `onRequestPatch`, `onRequestDelete` desde `../../functions/api/admin/jugadores`, más `crearAdmin`, `peticion` y `ctx`. Como el fichero ya importa cosas para el bloque anterior, añadir sin duplicar.

- [ ] **Step 2: Ver los tests fallar**

Ejecutar: `npx vitest run --project integration test/integration/capitan.test.ts`
Esperado: FALLAN los cuatro nuevos.

- [ ] **Step 3: Contacto opcional salvo capitán**

En `functions/api/admin/jugadores.ts`, cambiar la firma de `validarJugador` para que reciba si la fila es capitana, y sus dos reglas:

```ts
function validarJugador(
  valores: Record<string, string>,
  opciones: { esCapitan?: boolean } = {}
): { jugador: JugadorNormalizado } | { campos: Record<string, string> } {
```

```ts
  // Móvil y correo solo son obligatorios para el capitán: es el contacto del
  // equipo y quien puede editarlo. Del resto, quien no los dé se queda fuera
  // del grupo y de los avisos, y eso ya se advierte en los formularios.
  const telefono = limpiar(valores.telefono);
  const telefonoNormalizado = telefono ? normalizarTelefono(telefono) : "";
  if (!telefono) {
    if (opciones.esCapitan) campos.telefono = MENSAJE_CAPITAN_CONTACTO;
  } else if (!MOVIL_PATTERN.test(telefonoNormalizado)) {
    campos.telefono = "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos).";
  }

  const emailRaw = limpiar(valores.email);
  if (!emailRaw) {
    if (opciones.esCapitan) campos.email = MENSAJE_CAPITAN_CONTACTO;
  } else if (!EMAIL_PATTERN.test(emailRaw) || emailRaw.length > 120) {
    campos.email = "Ese correo no parece válido.";
  }
```

y en el objeto devuelto, `email: emailRaw || null`, `emailNormalizado: emailRaw ? normalizarEmail(emailRaw) : null`. Importar `MENSAJE_CAPITAN_CONTACTO` desde `../../_lib/validacion`. Revisar `buscarDuplicados` de este fichero: la consulta compara `telefono_normalizado = ?2 OR email_normalizado = ?3`; con valores vacíos/nulos hay que excluirlos de la comparación:

```ts
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (nombre_completo_normalizado = ?1
              OR (?2 <> '' AND telefono_normalizado = ?2)
              OR (?3 IS NOT NULL AND email_normalizado = ?3))
```

(adaptando los índices de bind a como estén en el fichero).

En `onRequestPost` la fila es nueva, así que nunca es capitana: `validarJugador(valores)`. En `onRequestPatch`, calcularlo:

```ts
  const esCapitan = await env.DB
    .prepare("SELECT 1 FROM equipos WHERE capitan_jugador_id = ?1")
    .bind(jugadorId)
    .first();
  const validado = validarJugador(valores, { esCapitan: Boolean(esCapitan) });
```

- [ ] **Step 4: Proteger al capitán del borrado y del traslado**

En `onRequestDelete`, antes del `DELETE FROM jugadores`:

```ts
    const capitanea = await env.DB
      .prepare("SELECT id FROM equipos WHERE capitan_jugador_id = ?1")
      .bind(jugadorId)
      .first<{ id: number }>();
    if (capitanea) {
      return jsonAdmin(
        {
          error:
            "Es el capitán de su equipo. Nombra antes a otro capitán desde el editor del equipo y vuelve a intentarlo."
        },
        409
      );
    }
```

En `onRequestPatch`, en el punto donde ya se sabe que `cambioDeEquipo` es cierto (variable `cambioDeEquipo`, línea ~254), añadir antes de construir los `sets`:

```ts
  // Mover al capitán a otro equipo dejaría a su equipo apuntando a alguien que
  // ya no está en la plantilla. Primero se cede el mando.
  if (cambioDeEquipo && esCapitan) {
    return jsonAdmin(
      {
        error: "Es el capitán de su equipo. Nombra antes a otro capitán desde el editor del equipo.",
        campos: { equipoId: "No se puede mover al capitán." }
      },
      409
    );
  }
```

(`esCapitan` es el booleano del Step 3; convertirlo a `const esCapitan = Boolean(await …)` para poder reutilizarlo.)

- [ ] **Step 5: Ver los tests pasar**

Ejecutar: `npx vitest run --project integration test/integration/capitan.test.ts`
Esperado: PASA.

Ejecutar: `npm test`
Esperado: verde. Si algún test de `admin` esperaba que el correo fuera obligatorio para cualquier jugador, actualizarlo a la regla nueva.

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/jugadores.ts test/integration/capitan.test.ts
git commit -m "feat: contacto opcional salvo capitán en el alta de jugadores del panel"
```

---

### Task 5: El formulario de inscripción

Primera tarea de interfaz. **Invocar `frontend-design:frontend-design` antes de escribir los estilos.**

**Files:**
- Modify: `src/pages/inscripcion.astro`, `public/assets/team-form.js`, `src/styles/global.css`
- Test: `test/unit/paridad-validacion.test.ts`, `test/unit/inscripcion-capitan.test.ts` (nuevo)

**Interfaces:**
- Consumes: `POST /api/equipos` con `payload.capitan` (Tarea 2), `MENSAJE_CAPITAN_CONTACTO` (Tarea 2).
- Produces: marcado de tarjeta de jugador con `[data-capitan-badge]`, `[data-make-capitan]`, `[data-contacto-aviso]` y `[data-opt="telefono"]` / `[data-opt="email"]`; clases CSS `.player-capitan`, `.player-capitan-set`, `.player-warning`.

- [ ] **Step 1: Escribir el test de comportamiento**

Crear `test/unit/inscripcion-capitan.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El capitán y el aviso de contacto en /inscripcion/. La garantía de verdad
 * está en el servidor (functions/_lib/validacion.ts), pero el formulario tiene
 * que contarlo bien antes de enviar: quién manda, a quién se le puede ceder y
 * qué pasa con quien no deja ni móvil ni correo.
 *
 * El marcado replica el de src/pages/inscripcion.astro: si allí cambian los
 * data-*, este test se cae, que es justo lo que se quiere.
 */

const MARCADO = `
  <form data-team-form novalidate>
    <div class="form-banner" data-banner hidden></div>
    <div class="field"><input type="text" data-field="equipo" /><p class="field-error" hidden></p></div>
    <div class="players" data-players></div>
    <button type="button" data-add-player>+ Añadir suplente</button>
    <div class="consent-box" data-consent>
      <input type="checkbox" data-field="consentimiento" />
      <p class="field-error" hidden></p>
    </div>
    <button type="submit" data-submit>Inscribir equipo</button>
  </form>
  <section data-success hidden><p data-success-text></p></section>
  <template id="player-template">
    <article class="player-card" data-player>
      <header class="player-head">
        <span data-dorsal>1</span>
        <span data-role>Titular</span>
        <span class="player-capitan" data-capitan-badge hidden>Capitán</span>
        <button type="button" data-make-capitan hidden>Hacer capitán</button>
        <button type="button" data-remove hidden>Quitar</button>
      </header>
      <div class="player-grid">
        <div class="field"><label data-label="nombre">Nombre</label><input type="text" data-field="nombre" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="apellidos">Apellidos</label><input type="text" data-field="apellidos" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="telefono">Móvil <span class="field-opt" data-opt="telefono" hidden>(opcional)</span></label><input type="tel" data-field="telefono" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="email">Correo <span class="field-opt" data-opt="email" hidden>(opcional)</span></label><input type="email" data-field="email" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="redSocial">Instagram</label><input type="text" data-field="redSocial" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="foto">Foto</label><input type="file" data-field="foto" /><p class="field-error" hidden></p></div>
      </div>
      <p class="player-warning" data-contacto-aviso hidden></p>
    </article>
  </template>
`;

const cartas = () => Array.from(document.querySelectorAll("[data-player]"));
const escribir = (carta: Element, campo: string, valor: string) => {
  const input = carta.querySelector<HTMLInputElement>(`[data-field="${campo}"]`)!;
  input.value = valor;
  input.dispatchEvent(new Event("blur"));
  input.dispatchEvent(new Event("input"));
};

describe("capitán y aviso de contacto en la inscripción", () => {
  beforeEach(() => {
    document.body.innerHTML = MARCADO;
    (window as unknown as Record<string, unknown>).CopaAuth = {
      state: { user: { email: "capi@example.com" } }
    };
    ejecutarScriptPublico("team-form.js");
  });

  it("nombra capitán al primer jugador", () => {
    const [primera, segunda] = cartas();
    expect(primera!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(false);
    expect(segunda!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(true);
    expect(segunda!.querySelector("[data-make-capitan]")!.hasAttribute("hidden")).toBe(false);
  });

  it("marca como opcionales el móvil y el correo de quien no es capitán", () => {
    const [primera, segunda] = cartas();
    expect(primera!.querySelector('[data-opt="email"]')!.hasAttribute("hidden")).toBe(true);
    expect(segunda!.querySelector('[data-opt="email"]')!.hasAttribute("hidden")).toBe(false);
  });

  it("avisa de lo que falta y quita el aviso al completarlo", () => {
    const segunda = cartas()[1]!;
    const aviso = segunda.querySelector<HTMLElement>("[data-contacto-aviso]")!;

    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain("ni recibirá avisos");

    escribir(segunda, "telefono", "600111222");
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toBe("Sin correo no recibirá los avisos del torneo.");

    escribir(segunda, "email", "otro@example.com");
    expect(aviso.hidden).toBe(true);
  });

  it("no deja hacer capitán a quien no tiene móvil y correo", () => {
    const segunda = cartas()[1]!;
    const boton = segunda.querySelector<HTMLButtonElement>("[data-make-capitan]")!;
    expect(boton.disabled).toBe(true);

    escribir(segunda, "telefono", "600111222");
    escribir(segunda, "email", "otro@example.com");
    expect(boton.disabled).toBe(false);
  });

  it("mueve la capitanía al pulsar el botón", () => {
    const [primera, segunda] = cartas();
    escribir(segunda!, "telefono", "600111222");
    escribir(segunda!, "email", "otro@example.com");
    segunda!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();

    expect(segunda!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(false);
    expect(primera!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(true);
    expect(primera!.querySelector("[data-make-capitan]")!.hasAttribute("hidden")).toBe(false);
  });

  it("al capitán no se le puede quitar de la plantilla", () => {
    // Con tres tarjetas, la tercera sí tendría botón de quitar por ser suplente:
    // que desaparezca al nombrarla capitana es la regla, no un efecto del orden.
    document.querySelector<HTMLButtonElement>("[data-add-player]")!.click();
    const tercera = cartas()[2]!;
    expect(tercera.querySelector("[data-remove]")!.hasAttribute("hidden")).toBe(false);

    escribir(tercera, "telefono", "600999888");
    escribir(tercera, "email", "tercero@example.com");
    tercera.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();

    expect(tercera.querySelector("[data-remove]")!.hasAttribute("hidden")).toBe(true);
  });
});
```

- [ ] **Step 2: Ver el test fallar**

Ejecutar: `npx vitest run --project unit test/unit/inscripcion-capitan.test.ts`
Esperado: FALLA — el script no conoce `[data-capitan-badge]`.

- [ ] **Step 3: Ampliar la plantilla de tarjeta en `src/pages/inscripcion.astro`**

En `<template id="player-template">`, cabecera:

```html
      <header class="player-head">
        <span class="player-dorsal" data-dorsal aria-hidden="true">1</span>
        <span class="player-role" data-role>Titular</span>
        <span class="player-capitan" data-capitan-badge hidden>Capitán</span>
        <button type="button" class="player-capitan-set" data-make-capitan hidden>Hacer capitán</button>
        <button type="button" class="player-remove" data-remove hidden>Quitar</button>
      </header>
```

Móvil y correo, con su marca de opcional y sin `required` fijo:

```html
        <div class="field">
          <label data-label="telefono">Móvil <span class="field-opt" data-opt="telefono" hidden>(opcional)</span></label>
          <input type="tel" data-field="telefono" maxlength="18" autocomplete="off" placeholder="612 345 678" />
          <p class="field-error" hidden></p>
        </div>
        <div class="field">
          <label data-label="email">Correo <span class="field-opt" data-opt="email" hidden>(opcional)</span></label>
          <input type="email" data-field="email" maxlength="120" autocomplete="off" />
          <p class="field-hint" data-hint-email>El capitán necesita correo: es con el que entra a editar el equipo.</p>
          <p class="field-error" hidden></p>
        </div>
```

Y, cerrando el `<article>`, después de `</div>` de `.player-grid`:

```html
      <p class="player-warning" data-contacto-aviso hidden></p>
```

Copia del hero (líneas 22-26), sustituir la última frase:

```html
      <p class="reveal" style="--reveal-delay: 180ms">
        Dos titulares como mínimo y los suplentes que necesitéis. La inscripción son
        {inscripcion.precio} por equipo y {inscripcion.pago}. Solo el capitán necesita móvil y
        correo —el tuyo, el de la cuenta con la que entras—; del resto, quien no los deje no
        entrará en el grupo del torneo ni recibirá avisos.
      </p>
```

Y el bloque `data-auth-no-team` (líneas 42-48), segunda frase:

```html
      <p>
        Has entrado como <strong data-auth-user-email></strong>. Lo pondremos en el capitán
        automáticamente: es el correo que manda en el equipo.
      </p>
```

- [ ] **Step 4: Implementar en `public/assets/team-form.js`**

Añadir junto al resto de constantes:

```js
  const MENSAJE_CAPITAN_CONTACTO = "El capitán necesita móvil y correo para que podamos avisaros.";
  const AVISO_SIN_MOVIL = "Sin móvil no le añadiremos al grupo del torneo.";
  const AVISO_SIN_CORREO = "Sin correo no recibirá los avisos del torneo.";
  const AVISO_SIN_CONTACTO =
    "Sin móvil ni correo no le añadiremos al grupo del torneo ni recibirá avisos.";
```

Estado del capitán, junto a `const cartas = …`:

```js
  // El capitán se guarda por elemento, no por índice: las tarjetas se añaden y
  // se quitan, y un índice se quedaría apuntando a otra persona.
  let cartaCapitan = null;
```

Funciones nuevas (poner antes de `reindexar`):

```js
  const valorDe = (carta, campo) => limpiar(carta.querySelector(`[data-field="${campo}"]`)?.value || "");
  const tieneContacto = (carta) => Boolean(valorDe(carta, "telefono")) && Boolean(valorDe(carta, "email"));

  /** Aviso bajo la tarjeta: dice qué falta y qué implica. */
  function actualizarAviso(carta) {
    const aviso = carta.querySelector("[data-contacto-aviso]");
    if (!aviso) return;
    if (carta === cartaCapitan) {
      aviso.hidden = true;
      return;
    }
    const sinMovil = !valorDe(carta, "telefono");
    const sinCorreo = !valorDe(carta, "email");
    const mensaje = sinMovil && sinCorreo
      ? AVISO_SIN_CONTACTO
      : sinMovil
        ? AVISO_SIN_MOVIL
        : sinCorreo
          ? AVISO_SIN_CORREO
          : "";
    aviso.textContent = mensaje;
    aviso.hidden = !mensaje;
  }

  /** Insignia, botón de cesión, rótulos opcionales y aviso de cada tarjeta. */
  function actualizarCapitan() {
    const lista = cartas();
    if (!lista.includes(cartaCapitan)) cartaCapitan = lista[0] || null;

    lista.forEach((carta) => {
      const esCapitan = carta === cartaCapitan;
      carta.classList.toggle("is-capitan", esCapitan);
      carta.querySelector("[data-capitan-badge]").hidden = !esCapitan;

      const boton = carta.querySelector("[data-make-capitan]");
      boton.hidden = esCapitan;
      boton.disabled = !tieneContacto(carta);
      boton.title = boton.disabled ? "Necesita móvil y correo para ser capitán." : "";

      carta.querySelector('[data-opt="telefono"]').hidden = esCapitan;
      carta.querySelector('[data-opt="email"]').hidden = esCapitan;

      const pista = carta.querySelector("[data-hint-email]");
      if (pista) pista.hidden = !esCapitan;

      // Al capitán no se le quita de la plantilla: primero se cede el mando.
      // Esto va aquí y no en reindexar() porque depende de quién manda, y
      // `actualizarCapitan` siempre corre después de `reindexar`.
      if (esCapitan) carta.querySelector("[data-remove]").hidden = true;

      actualizarAviso(carta);
    });
  }
```

**Orden de llamadas, que importa:** `reindexar()` fija dorsal, rol y el botón de quitar según la posición; `actualizarCapitan()` corre siempre **después** y añade lo que depende del capitán. Nunca se llaman la una a la otra.

En `crearJugador`, enganchar el botón y los avisos:

```js
    carta.querySelector("[data-make-capitan]").addEventListener("click", () => {
      if (!tieneContacto(carta)) return;
      cartaCapitan = carta;
      reindexar();
      actualizarCapitan();
    });
    carta.querySelectorAll("input").forEach((input) => {
      input.addEventListener("blur", () => validarCampo(input));
      if (input.dataset.field === "telefono" || input.dataset.field === "email") {
        input.addEventListener("input", actualizarCapitan);
      }
      if (input.dataset.field === "foto") {
        input.addEventListener("change", () => validarCampo(input));
      }
    });
    contenedor.appendChild(carta);
    if (!cartaCapitan) cartaCapitan = carta;
    reindexar();
    actualizarCapitan();
    return carta;
```

`reindexar` se queda **como está** (dorsal, rol, botón de quitar por posición): quien manda no es asunto suyo. El listener de quitar se encarga de que la capitanía no se quede huérfana:

```js
    carta.querySelector("[data-remove]").addEventListener("click", () => {
      carta.remove();
      if (cartaCapitan === carta) cartaCapitan = null;
      reindexar();
      actualizarCapitan();
    });
```

(`actualizarCapitan` ya reasigna `cartaCapitan` al primero de la lista cuando vale `null`.)

En `mensajeDe`, el móvil y el correo dependen de si la tarjeta es la del capitán:

```js
      case "telefono": {
        const esCapitan = input.closest("[data-player]") === cartaCapitan;
        if (!v) return esCapitan ? MENSAJE_CAPITAN_CONTACTO : "";
        return !/^[67]\d{8}$/.test(movilNormalizado(v))
          ? "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
          : "";
      }
      case "email": {
        const esCapitan = input.closest("[data-player]") === cartaCapitan;
        if (!v) return esCapitan ? MENSAJE_CAPITAN_CONTACTO : "";
        return !EMAIL_RE.test(v) || v.length > 120 ? "Ese correo no parece válido." : "";
      }
```

`rellenarEmailGoogle` pasa a rellenar el correo **del capitán**:

```js
  function rellenarEmailGoogle() {
    const userEmail = usuarioActual()?.email;
    if (!userEmail || !cartaCapitan) return;
    const campo = cartaCapitan.querySelector('[data-field="email"]');
    if (campo && !limpiar(campo.value)) {
      campo.value = userEmail;
      validarCampo(campo);
      actualizarCapitan();
    }
  }
```

En `datosJugador`, el móvil deja de ser incondicional:

```js
    const jugador = {
      nombre: valor("nombre"),
      apellidos: valor("apellidos")
    };
    const telefono = valor("telefono");
    if (telefono) jugador.telefono = telefono;
```

En el `submit`, sustituir la comprobación «uno de los jugadores debe usar tu correo» por la del capitán, y meter `capitan` en el payload:

```js
    const lista = cartas();
    const jugadores = lista.map(datosJugador);
    const indiceCapitan = lista.indexOf(cartaCapitan);
    const userEmail = usuarioActual()?.email;
    if (!userEmail) {
      mostrarBanner("Inicia sesión para que el equipo quede asociado a tu cuenta.");
      valido = false;
    } else if (
      indiceCapitan < 0 ||
      emailNormalizado(jugadores[indiceCapitan]?.email || "") !== emailNormalizado(userEmail)
    ) {
      if (cartaCapitan) {
        pintarError(
          cartaCapitan.querySelector('[data-field="email"]').closest(".field"),
          "El capitán debe usar el correo con el que has iniciado sesión."
        );
      }
      mostrarBanner(`El capitán del equipo debe usar tu correo: ${userEmail}.`);
      valido = false;
    }
```

```js
    const payload = {
      equipo: limpiar(form.querySelector('[data-field="equipo"]').value),
      consentimiento: true,
      capitan: indiceCapitan,
      jugadores
    };
```

En `pintarErroresServidor`, encaminar la clave `capitan` al banner (cae sola en `sueltos`, porque no casa con `jugadores.<i>.<campo>` ni con `equipo`; comprobarlo y, si no, añadir la rama).

Al final del arranque, después de las dos llamadas a `crearJugador()`, añadir `actualizarCapitan();` antes de `rellenarEmailGoogle();`.

- [ ] **Step 5: Ampliar la paridad**

En `test/unit/paridad-validacion.test.ts`, dentro del primer `describe`, añadir:

```ts
  it("comparte el mensaje de contacto del capitán", () => {
    comparar(
      "mensaje de contacto del capitán",
      /MENSAJE_CAPITAN_CONTACTO\s*=\s*(.+);/,
      /MENSAJE_CAPITAN_CONTACTO\s*=\s*(.+);/
    );
  });
```

- [ ] **Step 6: Estilos**

Invocar `frontend-design:frontend-design`. Después, añadir a `src/styles/global.css`, junto al resto de estilos de `.player-card` / `.player-head`:

```css
/* Capitán: la única tarjeta con contacto obligatorio y la que manda. */
.player-capitan {
  font: 600 0.78rem/1 var(--font-body, inherit);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.32rem 0.6rem;
  border-radius: 999px;
  background: var(--sun);
  color: var(--deep);
  border: 2px solid var(--ink);
}

.player-capitan-set {
  font: 600 0.8rem/1 inherit;
  background: none;
  border: 2px solid var(--ink);
  border-radius: 999px;
  padding: 0.3rem 0.7rem;
  cursor: pointer;
}

.player-capitan-set:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.player-card.is-capitan {
  border-color: var(--sun);
}

.player-warning {
  margin: 0.6rem 0 0;
  padding: 0.55rem 0.7rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--sun) 22%, transparent);
  border-left: 4px solid var(--sun);
  font-size: 0.9rem;
  line-height: 1.35;
}
```

Comprobar los nombres reales de las variables de color en `:root` antes de usarlas y ajustar si `--sun` o `--deep` no existieran. Revisar en el bloque `@media (min-width: 901px)` si hace falta compactar `.player-warning` (fuente ~0.82rem) y añadirlo. En 560 px, comprobar que `.player-head` no se desborda con la insignia y el botón: si hace falta, `flex-wrap: wrap; gap: 0.4rem;` en `.player-head`.

- [ ] **Step 7: Ver los tests pasar**

Ejecutar: `npx vitest run --project unit test/unit/inscripcion-capitan.test.ts test/unit/paridad-validacion.test.ts`
Esperado: PASA.

- [ ] **Step 8: Comprobar en el navegador**

```bash
npm run build && npx wrangler dev --port 8788
```

Abrir `http://127.0.0.1:8788/inscripcion/` y comprobar, en ancho de escritorio y en ~390 px (recordando que Chrome headless recorta por debajo de ~500 px): la insignia del capitán, el aviso que aparece y desaparece, y que «Hacer capitán» se habilita al completar contacto.

- [ ] **Step 9: Commit**

```bash
git add src/pages/inscripcion.astro public/assets/team-form.js src/styles/global.css test/unit/
git commit -m "feat: capitán y aviso de contacto en el formulario de inscripción"
```

---

### Task 6: `/mi-equipo/`

**Files:**
- Modify: `src/pages/mi-equipo.astro`, `public/assets/my-team.js`
- Test: `test/unit/mi-equipo-solo-lectura.test.ts`, `test/unit/mi-equipo-capitan.test.ts` (nuevo)

**Interfaces:**
- Consumes: `GET /api/mi-equipo` devuelve `team.capitanJugadorId` y `team.puedeEditar` (Tarea 1); `PATCH` acepta `capitan` y responde `team: null` tras salir del equipo (Tarea 3).
- Produces: mismos `data-*` de tarjeta que la Tarea 5, más el diálogo de confirmación de cesión.

- [ ] **Step 1: Escribir el test**

Crear `test/unit/mi-equipo-capitan.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El capitán en /mi-equipo/: quién sale marcado, qué se manda al guardar y qué
 * pasa al ceder. La garantía de verdad está en el servidor
 * (test/integration/mi-equipo.test.ts); esto es lo otro que hay que cumplir:
 * que ceder el equipo no ocurra por accidente y que el payload diga quién manda.
 *
 * El marcado replica el de src/pages/mi-equipo.astro.
 */

const MARCADO = `
  <div data-my-team>
    <div data-my-team-loading hidden></div>
    <div data-my-team-empty hidden>
      <p data-my-team-cedido hidden></p>
    </div>
    <div data-my-team-editor hidden>
      <h2 data-my-team-titulo>Editar inscripción</h2>
      <p data-my-team-intro></p>
      <p data-my-team-lectura hidden></p>
      <div data-my-team-banner hidden></div>
      <form data-my-team-form novalidate>
        <div class="field"><input type="text" data-field="equipo" /></div>
        <div data-my-team-players></div>
        <button type="button" data-my-team-add-player>+ Añadir suplente</button>
        <button type="submit" data-my-team-save>Guardar cambios</button>
        <button type="button" data-my-team-delete>Borrar equipo</button>
      </form>
    </div>
  </div>
  <template id="my-team-player-template">
    <article class="player-card" data-player>
      <header class="player-head">
        <span data-dorsal>1</span>
        <span data-role>Titular</span>
        <span data-capitan-badge hidden>Capitán</span>
        <button type="button" data-make-capitan hidden>Hacer capitán</button>
        <button type="button" data-remove hidden>Quitar</button>
      </header>
      <div class="player-grid">
        <div class="field"><input type="text" data-field="nombre" /></div>
        <div class="field"><input type="text" data-field="apellidos" /></div>
        <div class="field"><label>Móvil <span data-opt="telefono" hidden>(opcional)</span></label><input type="tel" data-field="telefono" /></div>
        <div class="field"><label>Correo <span data-opt="email" hidden>(opcional)</span></label><input type="email" data-field="email" /></div>
        <div class="field"><input type="text" data-field="redSocial" /></div>
      </div>
      <p data-contacto-aviso hidden></p>
    </article>
  </template>
`;

const jugador = (id: number, nombre: string, email: string, telefono = "600111222") => ({
  id,
  nombre,
  apellidos: "Apellido",
  telefono,
  email,
  redSocial: null,
  tieneFoto: false,
  esSuplente: false,
  orden: id
});

const equipo = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  nombre: "Los Rompeolas",
  createdAt: "2026-01-01",
  tieneFoto: false,
  puedeEditar: true,
  capitanJugadorId: 1,
  jugadores: [jugador(1, "Ana", "capi@example.com"), jugador(2, "Luis", "luis@example.com")],
  ...extra
});

/** Respuesta JSON simulada. */
const respuesta = (cuerpo: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(cuerpo) } as Response);

const cards = () => Array.from(document.querySelectorAll("[data-player]"));
const guardar = () =>
  document.querySelector<HTMLFormElement>("[data-my-team-form]")!.dispatchEvent(
    new Event("submit", { cancelable: true })
  );
const esperar = () => new Promise((resolve) => setTimeout(resolve, 0));

async function montar(team: Record<string, unknown>) {
  document.body.innerHTML = MARCADO;
  (window as unknown as Record<string, unknown>).CopaAuth = {
    state: { loading: false, user: { email: "capi@example.com" }, team: { id: 1 } },
    refresh: vi.fn()
  };
  globalThis.fetch = vi.fn(() => respuesta({ team })) as unknown as typeof fetch;
  ejecutarScriptPublico("my-team.js");
  await esperar();
}

describe("el capitán en Mi zona", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it("marca como capitán al jugador que dice el servidor", async () => {
    await montar(equipo({ capitanJugadorId: 2 }));
    expect(cards()[1]!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(false);
    expect(cards()[0]!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(true);
  });

  it("envía el índice del capitán en el payload", async () => {
    await montar(equipo());
    guardar();
    await esperar();

    const llamadas = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patch = llamadas.find(([, opciones]) => (opciones as RequestInit | undefined)?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ capitan: 0 });
  });

  it("pide confirmación antes de ceder y no guarda si se cancela", async () => {
    await montar(equipo());
    window.confirm = vi.fn(() => false);

    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    expect(window.confirm).toHaveBeenCalled();
    const llamadas = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas.some(([, o]) => (o as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("cede cuando se confirma", async () => {
    await montar(equipo());
    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    const llamadas = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patch = llamadas.find(([, o]) => (o as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ capitan: 1 });
  });

  it("muestra el estado vacío cuando el guardado devuelve team: null", async () => {
    await montar(equipo());
    globalThis.fetch = vi.fn(() => respuesta({ ok: true, team: null })) as unknown as typeof fetch;

    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    expect(document.querySelector("[data-my-team-empty]")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("[data-my-team-cedido]")!.textContent).toContain("cedido");
  });

  it("en modo lectura no ofrece ceder", async () => {
    await montar(equipo({ puedeEditar: false }));
    cards().forEach((card) => {
      expect(card.querySelector("[data-make-capitan]")!.hasAttribute("hidden")).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Ver el test fallar**

Ejecutar: `npx vitest run --project unit test/unit/mi-equipo-capitan.test.ts`
Esperado: FALLA.

- [ ] **Step 3: Plantilla de `src/pages/mi-equipo.astro`**

En `<template id="my-team-player-template">`, replicar exactamente la cabecera y los campos de la Tarea 5 (insignia, botón «Hacer capitán», `data-opt` en móvil y correo, `<p class="player-warning" data-contacto-aviso hidden></p>` al final del `<article>`), quitando el `required` del correo.

Actualizar la frase de `data-my-team-intro`:

```html
              <p class="teams-status" data-my-team-intro>
                Mandas tú: eres el capitán. Solo tu móvil y tu correo son obligatorios; quien no
                deje contacto no entrará en el grupo del torneo ni recibirá avisos. Puedes ceder el
                equipo nombrando capitán a otra persona.
              </p>
```

y la de `data-my-team-lectura`:

```html
              <p class="teams-status" data-my-team-lectura hidden>
                Aquí solo consultas la plantilla: el equipo lo lleva su capitán. Para cambiar algo,
                habla con esa persona o escríbenos a copa.arena.2000@gmail.com.
              </p>
```

- [ ] **Step 4: Implementar en `public/assets/my-team.js`**

Portar de `team-form.js` (Tarea 5) las cuatro constantes de aviso, `valorDe`, `tieneContacto`, `actualizarAviso` y `actualizarCapitan`, adaptando `cartas()` → `cards()` y respetando `soloLectura` (en modo lectura, insignia sí, botón «Hacer capitán» oculto y aviso oculto).

`createPlayer` guarda el id y engancha los listeners:

```js
    card.querySelector("[data-make-capitan]").addEventListener("click", () => {
      if (soloLectura || !tieneContacto(card)) return;
      cartaCapitan = card;
      actualizarCapitan();
      reindex();
    });
    ["telefono", "email"].forEach((campo) => {
      card.querySelector(`[data-field="${campo}"]`).addEventListener("input", actualizarCapitan);
    });
```

`renderTeam` elige el capitán a partir de la respuesta:

```js
    players.textContent = "";
    cartaCapitan = null;
    const jugadores = Array.isArray(team.jugadores) ? team.jugadores : [];
    jugadores.forEach((player) => createPlayer(player));
    // El capitán viene del servidor por id de jugador; si el equipo aún no
    // tiene (heredado o creado en el panel), manda el primero de la lista.
    capitanOriginalId = team.capitanJugadorId ?? null;
    cartaCapitan =
      cards().find((card) => Number(card.dataset.playerId) === capitanOriginalId) || cards()[0] || null;
    if (!soloLectura) while (cards().length < MIN_JUGADORES) createPlayer();
    actualizarCapitan();
```

con `let capitanOriginalId = null;` junto a `let soloLectura = false;`.

En `reindex`, `card.querySelector("[data-remove]").hidden = soloLectura || index < MIN_JUGADORES || card === cartaCapitan;`.

`payload()` añade el índice:

```js
  function payload() {
    return {
      equipo: limpiar(form.querySelector('[data-field="equipo"]').value),
      capitan: cards().indexOf(cartaCapitan),
      jugadores: cards().map(getPlayer)
    };
  }
```

`getPlayer` deja de mandar el móvil vacío:

```js
    const player = { nombre: value("nombre"), apellidos: value("apellidos") };
    if (card.dataset.playerId) player.id = Number(card.dataset.playerId);
    const telefono = value("telefono");
    if (telefono) player.telefono = telefono;
```

En el `submit`, sustituir las dos comprobaciones previas (`El correo de cada jugador es obligatorio` y `payloadIncluyeUsuario`) por la del capitán y la confirmación de cesión:

```js
    const dataToSave = payload();
    const userEmail = currentUserEmail();
    const capitan = dataToSave.jugadores[dataToSave.capitan];
    if (!capitan || !capitan.telefono || !capitan.email) {
      setBanner("El capitán necesita móvil y correo para que podamos avisaros.");
      return;
    }
    if (!userEmail) {
      setBanner("Inicia sesión para guardar los cambios de tu equipo.");
      return;
    }

    // Ceder es entregar el equipo entero: quien entre con ese correo pasa a
    // mandar y quien lo cede deja de poder guardar. Se pide a propósito.
    const cede = Number(cartaCapitan?.dataset.playerId || 0) !== capitanOriginalId;
    if (cede) {
      const aviso =
        `Vas a nombrar capitán a ${capitan.nombre} ${capitan.apellidos}. ` +
        `Dejarás de poder editar el equipo: a partir de ahora lo hará quien entre con ${capitan.email}. ` +
        "Si ese correo no es una cuenta de Google, nadie podrá editarlo hasta que os echemos una mano. ¿Seguimos?";
      if (!window.confirm(aviso)) return;
    }
```

Borrar la función `payloadIncluyeUsuario`, que ya no se usa.

Tras un guardado correcto, contemplar que el equipo ya no sea suyo:

```js
      if (data.team) renderTeam(data.team);
      else show("empty");
      await window.CopaAuth?.refresh?.();
      setBanner(data.team ? "Equipo actualizado." : "Has cedido el equipo. Ya no formas parte de la plantilla.", "ok");
```

(Cuidado: si `data.team` es `null`, `setBanner` sobre el panel oculto no se ve; en ese caso pintar el mensaje en el bloque `[data-my-team-empty]`. Añadir un `<p class="teams-status" data-my-team-cedido hidden></p>` a ese bloque en el `.astro` y usarlo.)

En `applyServerErrors`, la clave `capitan` cae en `loose` y se muestra en el banner: comprobarlo.

- [ ] **Step 5: Actualizar `test/unit/mi-equipo-solo-lectura.test.ts`**

El marcado replicado necesita los nuevos `data-*` (si no, `actualizarCapitan` fallará al hacer `.hidden` sobre `null`). Añadirlos al `MARCADO` y a la `<template>`, y añadir `capitanJugadorId` al objeto `equipo(...)` del helper. Comprobar que los asertos de modo lectura siguen valiendo; si alguno hay que debilitarlo, es un hallazgo: pararse y revisar por qué.

- [ ] **Step 6: Ver los tests pasar**

Ejecutar: `npx vitest run --project unit`
Esperado: PASA todo el proyecto `unit`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/mi-equipo.astro public/assets/my-team.js test/unit/
git commit -m "feat: capitán y cesión del equipo en Mi zona"
```

---

### Task 7: Editor de plantilla del panel

**Files:**
- Modify: `src/pages/admin/equipos.astro`, `public/assets/admin/equipos.js`, `src/styles/admin/tables.css` (o el fichero de `src/styles/admin/` que agrupe las tarjetas del editor)
- Test: `test/unit/admin-equipos-capitan.test.ts` (nuevo)

**Interfaces:**
- Consumes: `PATCH /api/admin/equipos` con `payload.capitan` (Tarea 2), `equipo.capitanJugadorId` en el resumen (Tarea 1).
- Produces: radio `[data-capitan-radio]` por tarjeta en el editor del panel.

- [ ] **Step 1: Escribir el test**

Crear `test/unit/admin-equipos-capitan.test.ts`. A diferencia de `equipo-nuevo-enter.test.ts`, aquí el doble de `CopaAdmin` **sí** tiene que pintar la tabla y crear botones de verdad: el editor solo se abre desde el botón «Editar» de la fila.

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El capitán en el editor de plantilla de /admin/equipos/.
 *
 * El panel es el único sitio donde se puede cambiar el capitán de un equipo
 * ajeno, así que aquí se comprueba lo mismo que en el formulario público:
 * quién sale marcado, a quién se puede marcar y qué sale en el resumen previo
 * al guardado, que es la red de seguridad del editor.
 *
 * El marcado replica el de src/pages/admin/equipos.astro.
 */

const MARCADO = `
  <div data-admin-equipos></div>
  <p data-admin-contador></p>
  <dialog data-team-edit-dialog>
    <h2 data-team-edit-title></h2>
    <form data-team-edit-form novalidate>
      <div class="admin-field">
        <input type="text" data-team-edit-field="equipo" />
        <p data-team-edit-error="equipo" hidden></p>
      </div>
      <input type="file" data-team-edit-field="fotoEquipo" />
      <input type="checkbox" data-team-edit-field="eliminarFotoEquipo" />
      <img data-team-foto-preview hidden />
      <p data-team-foto-vacia hidden></p>
      <p data-team-edit-error="fotoEquipo" hidden></p>
      <div data-team-edit-players></div>
    </form>
    <p data-team-edit-banner hidden></p>
    <div data-team-edit-diff hidden><ul data-team-edit-diff-list></ul></div>
    <button type="button" data-team-edit-add>Añadir</button>
    <button type="button" data-team-edit-review>Revisar</button>
    <button type="button" data-team-edit-back>Volver</button>
    <button type="button" data-team-edit-confirm>Guardar</button>
    <button type="button" data-team-edit-close>Cerrar</button>
  </dialog>
  <template id="team-edit-player-template">
    <article class="player-card" data-team-edit-player>
      <header class="player-head">
        <span data-dorsal>1</span>
        <span data-role>Titular</span>
        <label class="player-capitan-pick"><input type="radio" name="capitan" data-capitan-radio /><span>Capitán</span></label>
        <button type="button" data-move-up>↑</button>
        <button type="button" data-move-down>↓</button>
        <button type="button" data-remove>Quitar</button>
      </header>
      <img data-photo-preview hidden />
      <p data-photo-empty hidden></p>
      <input type="file" data-field="foto" hidden />
      <input type="checkbox" data-field="eliminarFoto" />
      <p data-field-error="foto" hidden></p>
      <input type="text" data-field="nombre" /><p data-field-error="nombre" hidden></p>
      <input type="text" data-field="apellidos" /><p data-field-error="apellidos" hidden></p>
      <input type="tel" data-field="telefono" /><p data-field-error="telefono" hidden></p>
      <input type="email" data-field="email" /><p data-field-error="email" hidden></p>
      <input type="text" data-field="redSocial" /><p data-field-error="redSocial" hidden></p>
    </article>
  </template>
`;

const jugador = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos: "Apellido",
  telefono: "60011122" + id,
  email: `jugador${id}@example.com`,
  redSocial: null,
  tieneFoto: false,
  esSuplente: false,
  orden: id,
  ...extra
});

const EQUIPO = {
  id: 7,
  nombre: "Los Rompeolas",
  tieneFoto: false,
  jugadoresTotal: 2,
  capitanJugadorId: 2,
  capitanEmail: "jugador2@example.com",
  jugadores: [jugador(1, "Ana"), jugador(2, "Luis")]
};

const api = vi.fn();
const cargadores: (() => unknown)[] = [];

/** Doble de CopaAdmin fiel a core.js en lo que este test necesita. */
function montar(equipo: Record<string, unknown> = EQUIPO) {
  document.body.innerHTML = MARCADO;
  cargadores.length = 0;

  const dialogo = document.querySelector("[data-team-edit-dialog]") as HTMLElement & {
    showModal: () => void;
    close: () => void;
  };
  dialogo.showModal = vi.fn();
  dialogo.close = vi.fn();

  api.mockReset().mockResolvedValue({ ok: true });

  vi.stubGlobal("CopaAdmin", {
    api,
    apiJson: vi.fn(),
    resumen: vi.fn(async () => ({ equipos: [equipo] })),
    onReady: (fn: () => unknown) => cargadores.push(fn),
    recargar: vi.fn(async () => {}),
    setError: vi.fn(),
    el: (tag: string, clase = "", texto = "") => {
      const nodo = document.createElement(tag);
      if (clase) nodo.className = clase;
      if (texto) nodo.textContent = texto;
      return nodo;
    },
    clear: (nodo: Element) => nodo && (nodo.textContent = ""),
    text: (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v)),
    tabla: ({ filas, columnas }: { filas: unknown[]; columnas: { render: (f: unknown) => unknown }[] }) => {
      const cont = document.createElement("div");
      filas.forEach((fila) => {
        const linea = document.createElement("div");
        columnas.forEach((col) => {
          const salida = col.render(fila);
          linea.append(salida instanceof Node ? salida : document.createTextNode(String(salida)));
        });
        cont.append(linea);
      });
      return cont;
    },
    celda: (clase: string, ...hijos: (Node | null)[]) => {
      const div = document.createElement("div");
      div.className = clase;
      hijos.filter(Boolean).forEach((hijo) => div.append(hijo!));
      return div;
    },
    boton: (etiqueta: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = etiqueta;
      b.addEventListener("click", onClick);
      return b;
    },
    enlace: (etiqueta: string, href: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = etiqueta;
      return a;
    },
    limpiar: (valor: unknown) => String(valor || "").trim().replace(/\s+/g, " "),
    confirmar: vi.fn(async () => true)
  });

  ejecutarScriptPublico("admin/equipos.js");
}

/** Corre los cargadores registrados y abre el editor del primer equipo. */
async function abrirEditor() {
  await Promise.all(cargadores.map((fn) => fn()));
  const editar = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Editar");
  editar!.click();
}

const filas = () => Array.from(document.querySelectorAll("[data-team-edit-player]"));
const radio = (i: number) => filas()[i]!.querySelector<HTMLInputElement>("[data-capitan-radio]")!;
const campo = (i: number, nombre: string) =>
  filas()[i]!.querySelector<HTMLInputElement>(`[data-field="${nombre}"]`)!;
const escribir = (i: number, nombre: string, valor: string) => {
  const input = campo(i, nombre);
  input.value = valor;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("blur"));
};

describe("capitán en el editor del panel", () => {
  beforeEach(() => {
    montar();
  });

  it("preselecciona al capitán que viene del servidor", async () => {
    await abrirEditor();
    expect(radio(0).checked).toBe(false);
    expect(radio(1).checked).toBe(true);
  });

  it("no deja marcar capitán a quien no tiene móvil y correo", async () => {
    await abrirEditor();
    escribir(0, "telefono", "");
    expect(radio(0).disabled).toBe(true);

    escribir(0, "telefono", "600111222");
    expect(radio(0).disabled).toBe(false);
  });

  it("anuncia el cambio de capitán en el resumen previo", async () => {
    await abrirEditor();
    radio(0).checked = true;
    radio(0).dispatchEvent(new Event("change"));

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();

    const lineas = Array.from(document.querySelectorAll("[data-team-edit-diff-list] li")).map(
      (li) => li.textContent
    );
    expect(lineas.some((linea) => linea?.startsWith("Capitán:"))).toBe(true);
  });

  it("manda el índice del capitán en el payload", async () => {
    await abrirEditor();
    radio(0).checked = true;
    radio(0).dispatchEvent(new Event("change"));

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();
    document.querySelector<HTMLButtonElement>("[data-team-edit-confirm]")!.click();

    await vi.waitFor(() => expect(api).toHaveBeenCalled());
    const [, opciones] = api.mock.calls.at(-1)!;
    const payload = JSON.parse(String((opciones.body as FormData).get("payload")));
    expect(payload.capitan).toBe(0);
  });

  it("no deja guardar sin capitán marcado", async () => {
    await abrirEditor();
    radio(1).checked = false;

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();

    const banner = document.querySelector<HTMLElement>("[data-team-edit-banner]")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("capitán");
  });
});
```

**Ojo:** el último caso exige que `validarFormulario` avise antes de dejar pasar al resumen. El anterior exige que un `change` en el radio se refleje en el diff. Si el editor de `admin/equipos.js` no engancha `change` en el radio, hay que añadirlo en el Step 4.

- [ ] **Step 2: Ver el test fallar**

Ejecutar: `npx vitest run --project unit test/unit/admin-equipos-capitan.test.ts`
Esperado: FALLA.

- [ ] **Step 3: Plantilla del panel**

En `src/pages/admin/equipos.astro`, dentro de `<template id="team-edit-player-template">`, en la cabecera de la tarjeta:

```html
          <label class="player-capitan-pick">
            <input type="radio" name="capitan" data-capitan-radio />
            <span>Capitán</span>
          </label>
```

- [ ] **Step 4: Implementar en `public/assets/admin/equipos.js`**

0. `abrirEditor` tiene que llevarse el capitán al estado del diálogo, que hoy solo copia id, nombre, foto y jugadores:

```js
    equipoEnEdicion = {
      id: equipo.id,
      nombre: equipo.nombre,
      tieneFoto: Boolean(equipo.tieneFoto),
      capitanJugadorId: equipo.capitanJugadorId ?? null,
      jugadores: (equipo.jugadores || []).map((j) => ({ ...j }))
    };
```

Y `crearFilaJugador` se llama desde `abrirEditor` **después** de fijar `equipoEnEdicion`, así que ya puede leerlo (comprobarlo: en el fichero actual el orden es correcto).

1. Al crear cada fila (`crearFilaJugador`), marcar el radio si el id coincide con `equipoEnEdicion.capitanJugadorId`, y deshabilitarlo si esa fila no tiene móvil y correo:

```js
    const radio = carta.querySelector("[data-capitan-radio]");
    radio.checked = Boolean(jugador) && jugador.id === equipoEnEdicion?.capitanJugadorId;
    const refrescarRadio = () => {
      const completo = Boolean(limpiar(carta.querySelector('[data-field="telefono"]').value)) &&
        Boolean(limpiar(carta.querySelector('[data-field="email"]').value));
      radio.disabled = !completo;
      radio.title = completo ? "" : "Necesita móvil y correo para ser capitán.";
      if (!completo) radio.checked = false;
    };
    ["telefono", "email"].forEach((campo) =>
      carta.querySelector(`[data-field="${campo}"]`).addEventListener("input", refrescarRadio)
    );
    refrescarRadio();
```

2. En `mensajeCampo`, móvil y correo solo son obligatorios para la fila marcada:

```js
      case "telefono": {
        if (!v) return esFilaCapitana(input) ? MENSAJE_CAPITAN_CONTACTO : "";
        return !/^[67]\d{8}$/.test(v.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, ""))
          ? "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
          : "";
      }
      case "email": {
        if (!v) return esFilaCapitana(input) ? MENSAJE_CAPITAN_CONTACTO : "";
        return !EMAIL_RE.test(v) || v.length > 120 ? "Ese correo no parece válido." : "";
      }
```

con `const MENSAJE_CAPITAN_CONTACTO = "El capitán necesita móvil y correo para que podamos avisaros.";` junto al resto de constantes y

```js
  const esFilaCapitana = (input) =>
    input.closest("[data-team-edit-player]")?.querySelector("[data-capitan-radio]")?.checked === true;
```

3. En `validarFormulario`, exigir que haya capitán marcado:

```js
    const hayCapitan = Array.from(listaJugadores.querySelectorAll("[data-capitan-radio]")).some((r) => r.checked);
    if (!hayCapitan) {
      mostrarBanner("Marca quién es el capitán del equipo.");
      valido = false;
    }
```

4. En `calcularDiff`, añadir la línea de cambio de capitán:

```js
    const cartaCapitan = cartas.find((carta) => carta.querySelector("[data-capitan-radio]").checked);
    const idCapitan = cartaCapitan?.dataset.playerId ? Number(cartaCapitan.dataset.playerId) : undefined;
    if (idCapitan !== equipoEnEdicion.capitanJugadorId) {
      const antes = equipoEnEdicion.jugadores.find((j) => j.id === equipoEnEdicion.capitanJugadorId);
      cambios.push(
        `Capitán: ${antes ? etiquetaJugador(antes) : "—"} → ${cartaCapitan ? etiquetaJugador(datosFila(cartaCapitan)) : "—"}.`
      );
    }
```

5. En el `click` de `btnConfirmar`, meter el índice en el payload:

```js
    const indiceCapitan = cartas.findIndex((carta) => carta.querySelector("[data-capitan-radio]").checked);
```

```js
    envio.append(
      "payload",
      JSON.stringify({
        equipo: limpiar(form.querySelector('[data-team-edit-field="equipo"]').value),
        capitan: indiceCapitan,
        jugadores
      })
    );
```

6. En `datosFila`, el móvil vacío no se manda: `telefono: valor("telefono")` se queda igual (el servidor acepta `""`), pero el objeto `jugador` que se envía en `btnConfirmar` debe omitirlo si está vacío, igual que hace con el correo:

```js
      const jugador = { nombre: datos.nombre, apellidos: datos.apellidos, eliminarFoto: datos.eliminarFoto };
      if (datos.id !== undefined) jugador.id = datos.id;
      if (datos.telefono) jugador.telefono = datos.telefono;
      if (datos.email) jugador.email = datos.email;
```

7. En `pintarErroresServidor`, la clave `capitan` cae en `sueltos` y sale por el banner. Comprobarlo.

- [ ] **Step 5: Estilos del panel**

Añadir en el fichero de `src/styles/admin/` que agrupa las tarjetas del editor (comprobar cuál con `grep -l "player-head" src/styles/admin/*.css`; si no aparece, va en `tables.css`):

```css
.player-capitan-pick {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--adm-text);
}

.player-capitan-pick input:disabled + span {
  opacity: 0.45;
}
```

Usar los tokens `--adm-*` reales del panel (`src/styles/admin/tokens.css`).

- [ ] **Step 6: Ver los tests pasar**

Ejecutar: `npx vitest run --project unit`
Esperado: PASA.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/equipos.astro public/assets/admin/equipos.js src/styles/admin/ test/unit/
git commit -m "feat: elegir capitán en el editor de plantilla del panel"
```

---

### Task 8: Verificación completa y cierre

**Files:**
- Modify: `CLAUDE.md` (repaso final), `docs/superpowers/plans/2026-07-29-capitan-equipo.md` (marcar pasos)

- [ ] **Step 1: Repasar la documentación**

Releer la sección «Admin panel» y «Backend» de `CLAUDE.md` con los cambios ya hechos y comprobar que no queda ninguna mención a `owner_user_id` de equipos ni a «el correo de cada jugador es obligatorio». Buscar restos:

```bash
grep -rn "owner_user_id\|equipoPropioDeUsuario\|registroIncluyeEmailUsuario\|requirePlayerEmail\|ownerEmail" --include="*.ts" --include="*.js" --include="*.astro" --include="*.md" . | grep -v node_modules | grep -v docs/superpowers | grep -v camisetas
```

Esperado: sin resultados (los de `camisetas` son de otra columna y se quedan).

- [ ] **Step 2: Verificación completa**

Ejecutar: `npm run verify`
Esperado: build, tipos de test y los tres proyectos de Vitest en verde. Nada rojo.

- [ ] **Step 3: Prueba manual del flujo completo**

```bash
npx wrangler d1 migrations apply DB --local
npm run build && npx wrangler dev --port 8788
```

Recorrer: inscribir un equipo con un suplente sin contacto (aparece el aviso) → `/mi-equipo/` → ceder el mando a ese suplente (debe impedirlo por falta de contacto) → rellenarle móvil y correo → ceder → comprobar que el editor pasa a lectura. En el panel, abrir el equipo y cambiar el capitán.

- [ ] **Step 4: Commit y merge**

```bash
git add -A
git commit -m "docs: cierre del capitán de equipo"
git checkout development
git merge --no-ff feature/capitan-equipo -m "Merge feature/capitan-equipo into development: el capitán manda en el equipo"
```

(No tocar `main`: promocionar a producción requiere preguntar antes.)

---

## Notas de revisión

Tres cosas que el spec dejaba escritas y que la implementación resuelve de otra forma, a propósito:

1. **«No se puede quitar al capitán sin designar otro» no lleva código.** `capitan` siempre apunta a alguien de la plantilla enviada, así que quitar al capitán actual ya *es* una cesión. Lo que sí lleva código es impedir la cesión encubierta (cambiarle el correo a la fila del capitán): Tarea 3.
2. **`?accion=ficha` no tiene cliente hoy.** El endpoint existe pero ningún script del panel lo llama, así que el capitán se cambia desde el editor de plantilla (Tarea 7). La ficha se actualiza igualmente (Tarea 1, Step 11) para que no quede un endpoint hablando de una columna que ya no existe.
3. **El móvil vacío se guarda como `''`,** nunca `NULL`: reconstruir `jugadores` se llevaría por delante `estadisticas` y `jugador_atributos` por sus `ON DELETE CASCADE`. La API traduce `''` → `null` al salir.
