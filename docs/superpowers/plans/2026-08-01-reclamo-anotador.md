# Reclamo del partido en `/anotador/` — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que dos personas no puedan anotar el mismo partido sin enterarse: el partido tiene dueño, se reclama con la primera escritura y sólo cambia de manos cuando alguien pide el relevo.

**Architecture:** Una columna `partidos.anotador_usuario_id`. El reclamo se toma con un `UPDATE` condicional (compare-and-swap), para que la carrera la resuelva D1 y no el código de aplicación. Una sola puerta en `onRequestPost` de `functions/api/anotacion.ts`, antes del `switch`, que responde 409 a quien no lo lleva. La salida es una acción nueva, `relevo`, siempre disponible.

**Tech Stack:** Cloudflare Workers + D1 (SQLite), TypeScript en `functions/`, JavaScript plano (IIFE, sin bundler) en `public/assets/`, Astro 5 para el marcado, Vitest con tres proyectos (`unit`, `integration`, `e2e`).

**Diseño aprobado:** `docs/superpowers/specs/2026-08-01-reclamo-anotador-design.md`

## Global Constraints

- **Worktree:** `.worktrees/reclamo-anotador`, rama `feature/reclamo-anotador`, slot 5 (`npm run dev -- --port 4371`, `npx wrangler dev --port 8838`). Todo el trabajo va aquí dentro, nunca en el checkout principal.
- **Número de migración: 0029.** Es el que asignó `npm run rama`. No usar otro.
- **Texto en español con tildes correctas** («información», «anotación», «último»). El deporte se escribe **«volley»**, nunca «vóley».
- **Tono de la copy:** frases cortas y seguras, sin chistes.
- **Mensajes de commit:** español, frases cortas, una idea por frase, sin metáforas. Terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **`npm test`** (unit + integration, ~10 s) es el comando de cada tarea. `npm run verify` sólo al final, una vez, y **nunca en dos worktrees a la vez**.
- **No se debilita un test para que pase.** Si un test existente empieza a fallar de forma legítima, se actualiza el test.
- **El coste de anotar no puede crecer.** `test/integration/anotacion-estres.test.ts` cuenta consultas. El camino de cada punto no debe ganar ninguna.
- **No se usa `window.confirm`.**
- **Los ficheros de `public/assets/` no pasan por el bundler**: JavaScript plano, sin `import`, sin sintaxis que Astro tenga que transformar.

---

## Estructura de ficheros

| Fichero | Responsabilidad | Tarea |
|---|---|---|
| `db/migrations/0029_partido_anotador.sql` | **Crear.** La columna. | 1 |
| `functions/_lib/eventos.ts` | **Modificar.** `PartidoAnotable` gana la columna; `PartidoDeOtroAnotador`; `reclamarPartido`; `soltarAnotacion` libera; el `catch` de `adoptarMarcador`; el `ordenEsperado` de `corregirEvento`. | 1, 2, 3, 4 |
| `functions/api/anotacion.ts` | **Modificar.** `SELECT_PARTIDO` con el `LEFT JOIN`; `respuesta()` con `anotador`; la puerta; `accionRelevo`; `accionCorregir` con orden. | 1, 2, 3, 4 |
| `test/integration/anotador-reclamo.test.ts` | **Crear.** Todo lo del reclamo. | 1, 2, 3 |
| `test/integration/anotacion.test.ts` | **Modificar.** Los dos arreglos y el repaso de los tests que el reclamo invalida. | 4 |
| `src/pages/anotador/partido.astro` | **Modificar.** La sección del relevo. | 5 |
| `src/styles/anotador/index.css` | **Modificar.** Los estilos de esa sección. | 5 |
| `public/assets/anotador/partido.js` | **Modificar.** Modo lectura y el botón. | 5 |
| `public/assets/anotador/lista.js` | **Modificar.** «Lo lleva Ana» en la tarjeta. | 5 |
| `test/unit/anotador-partido.test.ts` | **Modificar.** El modo lectura. | 5 |
| `CLAUDE.md` | **Modificar.** Un párrafo en «Anotación en directo». | 6 |

---

### Task 1: La columna y quién lleva el partido en la respuesta

**Files:**
- Create: `db/migrations/0029_partido_anotador.sql`
- Create: `test/integration/anotador-reclamo.test.ts`
- Modify: `functions/_lib/eventos.ts` (interfaz `PartidoAnotable`, ~línea 28)
- Modify: `functions/api/anotacion.ts` (`SELECT_PARTIDO` ~línea 49, `cargarPartido` ~55, `respuesta` ~138, y las 9 llamadas a `respuesta`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `PartidoAnotable.anotador_usuario_id: number | null`
  - `type PartidoConAnotador = PartidoAnotable & { updated_at: string; anotador_nombre: string | null; anotador_email: string | null }` (exportado desde `functions/api/anotacion.ts`)
  - `cargarPartido(db, id): Promise<PartidoConAnotador | null>`
  - `respuesta(db, partido, usuarioId, status?, yaLeido?)` — **`usuarioId` es el tercer parámetro**, antes de `status`.
  - En el cuerpo JSON: `anotador: { id: number | null; nombre: string | null; puedeAnotar: boolean }` y `ultimaActividad: string`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/integration/anotador-reclamo.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../../functions/api/anotacion";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, peticion, type EquipoSembrado } from "../helpers/db";

/*
 * El reclamo del partido.
 *
 * El UNIQUE(partido_id, orden) impide que un punto pise a otro, pero sólo salta
 * cuando dos anotadores coinciden en el mismo hueco. Si se turnan sin llegar a
 * chocar, los dos anotan el mismo partido y ninguno se entera. Con una sola
 * pista eso no es raro: quien entra en /anotador/ se encuentra el partido en
 * juego arriba de la lista.
 *
 * El reclamo separa a dos personas; el UNIQUE sigue separando a dos pestañas de
 * la misma persona.
 */

interface Respuesta {
  anotador: { id: number | null; nombre: string | null; puedeAnotar: boolean };
  ultimaActividad: string;
  estado: { puntos: { A: number; B: number } };
  siguienteOrden: number;
  error?: string;
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> => {
  const respuesta = await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env));
  return (await respuesta.json()) as Respuesta;
};

/** Un partido con sus dos equipos y sin una sola escritura detrás: sin dueño. */
async function partidoLibre() {
  const local: EquipoSembrado = await crearEquipo({
    nombre: "Delfines",
    jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }]
  });
  const visitante: EquipoSembrado = await crearEquipo({
    nombre: "Gaviotas",
    jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }]
  });
  const partidoId = await crearPartido({ equipoA: local, equipoB: visitante, status: "live" });
  return { partidoId, local, visitante };
}

describe("quién lleva el partido", () => {
  it("un partido sin escrituras no lo lleva nadie, y cualquiera puede anotarlo", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const datos = await leer(admin, partidoId);

    expect(datos.anotador).toEqual({ id: null, nombre: null, puedeAnotar: true });
    expect(datos.ultimaActividad).toBeTruthy();
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Ejecutar: `npm test -- anotador-reclamo`
Esperado: FALLA. `datos.anotador` es `undefined`, así que `toEqual` no coincide.

- [ ] **Step 3: Escribir la migración**

Crear `db/migrations/0029_partido_anotador.sql`:

```sql
-- Migration number: 0029 	 quien lleva la anotacion de un partido
-- Un solo ALTER, y por eso va suelto, igual que la 0021 y la 0027: ADD COLUMN no
-- es idempotente y D1 reejecuta el fichero entero si algo falla a mitad, asi que
-- dos ALTER juntos dejan el segundo intento muerto en el primero.
--
-- El UNIQUE(partido_id, orden) de partido_eventos impide que un punto pise a
-- otro, pero solo salta cuando dos anotadores coinciden en el mismo hueco. Si se
-- turnan sin chocar, los dos llevan el mismo partido y ninguno se entera. Con
-- una sola pista ese es el caso normal, no el raro.
--
-- NULL significa que no lo lleva nadie, que es como nace todo partido existente.
-- Migracion aditiva: el codigo viejo, que sigue sirviendo trafico mientras
-- despliega el nuevo, no la lee.
--
-- No hay columna «desde cuando»: partidos.updated_at ya sube en toda escritura
-- del anotador y solo el dueno puede escribir, asi que esa marca ya es «la
-- ultima vez que anoto quien lo lleva».

ALTER TABLE partidos ADD COLUMN anotador_usuario_id INTEGER REFERENCES usuarios(id);
```

- [ ] **Step 4: Añadir la columna a `PartidoAnotable`**

En `functions/_lib/eventos.ts`, dentro de `export interface PartidoAnotable`, después de `elapsed_ms: number;`:

```ts
  /** Quién lleva la anotación, o `null` si no la lleva nadie. */
  anotador_usuario_id: number | null;
```

- [ ] **Step 5: Cargar el nombre del dueño con el partido**

En `functions/api/anotacion.ts`, sustituir `SELECT_PARTIDO`, el tipo y `cargarPartido`:

```ts
/*
 * El nombre de quien lleva el partido viaja con la propia fila, no en una
 * consulta aparte: esta carga la hace cada punto anotado.
 */
const SELECT_PARTIDO = `SELECT p.id, p.status, p.origen_marcador, p.equipo_a_id, p.equipo_b_id,
                               p.points_a, p.points_b, p.sets_a, p.sets_b, p.reglas, p.started_at,
                               p.elapsed_ms, p.updated_at, p.anotador_usuario_id,
                               u.nombre AS anotador_nombre, u.email AS anotador_email
                          FROM partidos p
                          LEFT JOIN usuarios u ON u.id = p.anotador_usuario_id
                         WHERE p.id = ?1`;

export type PartidoConAnotador = PartidoAnotable & {
  updated_at: string;
  anotador_nombre: string | null;
  anotador_email: string | null;
};

const idDelPartido = (url: URL) => url.searchParams.get("partido") || "";

async function cargarPartido(db: D1Database, id: string): Promise<PartidoConAnotador | null> {
  if (!id) return null;
  return await db.prepare(SELECT_PARTIDO).bind(id).first<PartidoConAnotador>();
}
```

- [ ] **Step 6: Devolver `anotador` en la respuesta**

En `functions/api/anotacion.ts`, cambiar la firma de `respuesta` para que reciba quién pregunta, y añadir los dos campos al cuerpo:

```ts
async function respuesta(
  db: D1Database,
  partido: PartidoAnotable,
  usuarioId: number,
  status = 200,
  yaLeido?: ResultadoAnotacion
): Promise<Response> {
```

Dentro del objeto que pasa a `jsonAdmin`, justo después de `pendienteDeAdoptar: ...`:

```ts
      /*
       * `puedeAnotar`, no `esMio`. Se separan justo en el caso más frecuente al
       * abrir un partido: todavía no lo lleva nadie. Con «es mío» ese estado
       * sería `false` y la pantalla arrancaría en modo lectura pidiendo un
       * relevo a nadie.
       */
      anotador: {
        id: fresco.anotador_usuario_id,
        nombre:
          fresco.anotador_usuario_id === null ? null : fresco.anotador_nombre || fresco.anotador_email,
        puedeAnotar: fresco.anotador_usuario_id === null || fresco.anotador_usuario_id === usuarioId
      },
      // La última escritura del anotador. Como sólo el dueño escribe, es «la
      // última vez que anotó quien lo lleva».
      ultimaActividad: fresco.updated_at,
```

- [ ] **Step 7: Actualizar las nueve llamadas a `respuesta`**

TypeScript las señala todas. Quedan así:

| Dónde | Antes | Después |
|---|---|---|
| `onRequestGet` | `respuesta(env.DB, partido)` | `respuesta(env.DB, partido, acceso.user.id)` |
| `accionEvento` | `respuesta(db, partido, 201, resultado)` | `respuesta(db, partido, usuarioId, 201, resultado)` |
| `accionDeshacer` | `respuesta(db, partido, 200, resultado)` | `respuesta(db, partido, usuarioId, 200, resultado)` |
| `accionCorregir` | `respuesta(db, partido, 200, resultado)` | `respuesta(db, partido, usuarioId, 200, resultado)` |
| `accionCambio` | `respuesta(db, partido, 201)` | `respuesta(db, partido, usuarioId, 201)` |
| `accionAlineacion` | `respuesta(db, partido)` | `respuesta(db, partido, usuarioId)` |
| `accionAdoptar` | `respuesta(db, partido, 201, resultado)` | `respuesta(db, partido, usuarioId, 201, resultado)` |
| `cambio-deshacer` (en el `switch`) | `respuesta(env.DB, partido)` | `respuesta(env.DB, partido, acceso.user.id)` |
| `soltar` (en el `switch`) | `respuesta(env.DB, partido)` | `respuesta(env.DB, partido, acceso.user.id)` |
| `onRequestPatch` | `respuesta(env.DB, partido, 200, resultado)` | `respuesta(env.DB, partido, acceso.user.id, 200, resultado)` |

`accionDeshacer`, `accionCorregir` y `accionAlineacion` no reciben hoy el `usuarioId`. Añadirlo como último parámetro a las tres, y pasarlo desde el `switch`:

```ts
      case "deshacer":
        return await accionDeshacer(env.DB, partido, body, acceso.user.id);
      case "corregir":
        return await accionCorregir(env.DB, partido, body, acceso.user.id);
      case "alineacion":
        return await accionAlineacion(env.DB, partido, body, acceso.user.id);
```

Y sus firmas:

```ts
async function accionDeshacer(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
```

Igual para `accionCorregir` y `accionAlineacion`.

- [ ] **Step 8: Ejecutar el test y verificar que pasa**

Ejecutar: `npm test -- anotador-reclamo`
Esperado: PASA.

- [ ] **Step 9: Ejecutar la suite entera**

Ejecutar: `npm test`
Esperado: todo verde. Ninguna acción rechaza todavía nada, así que ningún test existente debería cambiar de resultado. Si alguno falla, es la firma de `respuesta` mal propagada.

- [ ] **Step 10: Comprobar los tipos**

Ejecutar: `npm run test:types`
Esperado: sin errores.

- [ ] **Step 11: Commit**

```bash
git add db/migrations/0029_partido_anotador.sql functions/_lib/eventos.ts functions/api/anotacion.ts test/integration/anotador-reclamo.test.ts
git commit -F - <<'EOF'
feat(anotador): la API dice quién lleva cada partido

Migración 0029: partidos.anotador_usuario_id, NULL cuando no lo lleva nadie.
La respuesta de /api/anotacion trae el dueño y la última actividad.

Todavía no rechaza nada: eso llega en el commit siguiente.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: La puerta

**Files:**
- Modify: `functions/_lib/eventos.ts` (junto a `MarcadorSinAdoptar`, ~línea 180)
- Modify: `functions/api/anotacion.ts` (`onRequestPost`, después de la comprobación de `partidos.editar`)
- Modify: `test/integration/anotador-reclamo.test.ts`

**Interfaces:**
- Consumes: `PartidoConAnotador`, `respuesta(db, partido, usuarioId, ...)` de la tarea 1.
- Produces:
  - `class PartidoDeOtroAnotador extends ErrorDeAnotacion` con `readonly anotador: { id: number; nombre: string | null }`
  - `reclamarPartido(db, partidoId, usuarioId): Promise<boolean>` — `true` si lo acaba de reclamar.
  - `asegurarReclamo(db, partido, usuarioId)` (privada de `anotacion.ts`) — devuelve el dueño cuando es otra persona, `null` cuando quien pregunta puede anotar.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/integration/anotador-reclamo.test.ts`, después del `describe` existente:

```ts
/** Deja el partido reclamado por `user`, con los dos equipos alineados. */
async function montar(user: UsuarioSesion) {
  const { partidoId, local, visitante } = await partidoLibre();
  await anotar(user, partidoId, { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) });
  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "B",
    jugadorIds: visitante.jugadores.map((j) => j.id)
  });
  return { partidoId, local, visitante };
}

describe("el reclamo", () => {
  it("la primera escritura reclama el partido", async () => {
    const ana = await crearAdmin();
    const { partidoId, local } = await partidoLibre();

    await anotar(ana, partidoId, { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) });

    const datos = await leer(ana, partidoId);
    expect(datos.anotador.id).toBe(ana.id);
    expect(datos.anotador.puedeAnotar).toBe(true);
  });

  it("el GET no reclama nada", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId } = await partidoLibre();

    await leer(ana, partidoId);
    await leer(berta, partidoId);

    expect((await leer(ana, partidoId)).anotador.id).toBeNull();
  });

  it("un segundo anotador recibe 409 y el marcador no se mueve", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);
    await anotar(ana, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });

    const respuesta = await anotar(berta, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[1]!.id,
      ordenEsperado: 1
    });

    expect(respuesta.status).toBe(409);
    expect((await leer(ana, partidoId)).estado.puntos).toEqual({ A: 1, B: 0 });
  });

  it("el 409 dice quién lo lleva", async () => {
    const ana = await crearAdmin({ nombre: "Ana Muros" });
    const berta = await crearAdmin();
    const { partidoId } = await montar(ana);

    const respuesta = await anotar(berta, partidoId, { accion: "alineacion", lado: "A", jugadorIds: [] });
    const cuerpo = (await respuesta.json()) as { error: string; anotador: { id: number; nombre: string } };

    expect(respuesta.status).toBe(409);
    expect(cuerpo.anotador).toEqual({ id: ana.id, nombre: "Ana Muros" });
    expect(cuerpo.error).toContain("Ana Muros");
  });

  it("para quien no lo lleva, puedeAnotar es false", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId } = await montar(ana);

    expect((await leer(berta, partidoId)).anotador.puedeAnotar).toBe(false);
  });

  /*
   * La carrera de verdad: dos peticiones sobre un partido que no lleva nadie.
   * Con un SELECT y un if las dos pasarían. Lo que las separa es que la
   * condición viaja dentro del UPDATE y la evalúa D1.
   */
  it("dos escrituras a la vez sobre un partido libre: sólo una entra", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const respuestas = await Promise.all([
      anotar(ana, partidoId, { accion: "alineacion", lado: "A", jugadorIds: [] }),
      anotar(berta, partidoId, { accion: "alineacion", lado: "A", jugadorIds: [] })
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);

    const dueño = (await leer(ana, partidoId)).anotador.id;
    expect([ana.id, berta.id]).toContain(dueño);
  });

  /*
   * La puerta va antes del switch, así que cubre todas las acciones de
   * escritura. Ponerla en cada función de _lib sería repetirla siete veces y
   * olvidarla en la octava.
   */
  it("la puerta cubre todas las acciones de escritura", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);
    await anotar(ana, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });

    const acciones = [
      { accion: "evento", tipo: "punto", jugadorId: local.jugadores[0]!.id, ordenEsperado: 1 },
      { accion: "deshacer", ordenEsperado: 0 },
      { accion: "corregir", orden: 0, jugadorId: local.jugadores[1]!.id, ordenEsperado: 1 },
      { accion: "alineacion", lado: "A", jugadorIds: [] },
      { accion: "cambio", entra: local.jugadores[1]!.id, sale: local.jugadores[0]!.id },
      { accion: "cambio-deshacer" },
      { accion: "adoptar" },
      { accion: "soltar" }
    ];

    for (const cuerpo of acciones) {
      const respuesta = await anotar(berta, partidoId, cuerpo);
      expect(respuesta.status, `la acción ${cuerpo.accion} no está protegida`).toBe(409);
    }
  });
});
```

`crearAdmin({ nombre: "Ana Muros" })` funciona: `OpcionesUsuario` en `test/helpers/db.ts:17` ya declara `nombre?: string`.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Ejecutar: `npm test -- anotador-reclamo`
Esperado: FALLAN los seis nuevos. Los que esperan 409 reciben 200 o 201, porque todavía no hay puerta.

- [ ] **Step 3: El error y el CAS en `_lib/eventos.ts`**

Añadir después de la clase `MarcadorSinAdoptar`:

```ts
/**
 * Otra persona lleva la anotación de este partido.
 *
 * Es un «no» blando: quien recibe esto puede tomar el relevo y seguir. El
 * cerrojo duro sería peor —si al anterior anotador se le acaba la batería, el
 * siguiente tiene que poder entrar sin llamar a nadie—, y es la misma razón por
 * la que aquí no hay cola de trabajo sin conexión.
 */
export class PartidoDeOtroAnotador extends ErrorDeAnotacion {
  constructor(readonly anotador: { id: number; nombre: string | null }) {
    super(
      `Este partido lo lleva ${anotador.nombre || "otra persona"}. Toma el relevo si vas a anotarlo tú.`
    );
    this.name = "PartidoDeOtroAnotador";
  }
}

/**
 * Reclama el partido para `usuarioId`, y sólo si no lo lleva nadie.
 *
 * La condición va DENTRO del UPDATE a propósito. Un `SELECT` seguido de un `if`
 * en el servidor no es atómico: dos peticiones simultáneas leerían las dos
 * `NULL` y las dos se darían por dueñas, que es exactamente el agujero que esto
 * viene a tapar. Aquí la resuelve D1, igual que el UNIQUE(partido_id, orden)
 * resuelve la de dos puntos en el mismo hueco.
 *
 * Devuelve `true` si lo acaba de reclamar.
 */
export async function reclamarPartido(
  db: D1Database,
  partidoId: string,
  usuarioId: number
): Promise<boolean> {
  const resultado = await db
    .prepare("UPDATE partidos SET anotador_usuario_id = ?1 WHERE id = ?2 AND anotador_usuario_id IS NULL")
    .bind(usuarioId, partidoId)
    .run();
  return resultado.meta.changes === 1;
}
```

- [ ] **Step 4: La puerta en `onRequestPost`**

En `functions/api/anotacion.ts`, añadir la función auxiliar antes de `onRequestPost`:

```ts
/**
 * Deja el partido reclamado por quien escribe, o dice quién lo lleva.
 *
 * Devuelve `null` cuando quien pregunta puede anotar, y el dueño cuando es otra
 * persona. El orden de las ramas es el coste: el camino que se recorre en cada
 * punto —ya es suyo— no gasta ninguna consulta extra, y la fila con el nombre ya
 * viene cargada, así que rechazar tampoco gasta ninguna. Sólo paga el caso raro,
 * que es perder el CAS.
 */
async function asegurarReclamo(
  db: D1Database,
  partido: PartidoConAnotador,
  usuarioId: number
): Promise<{ id: number; nombre: string | null } | null> {
  if (partido.anotador_usuario_id === usuarioId) return null;

  if (partido.anotador_usuario_id !== null) {
    return { id: partido.anotador_usuario_id, nombre: partido.anotador_nombre || partido.anotador_email };
  }

  if (await reclamarPartido(db, partido.id, usuarioId)) return null;

  // El CAS perdió: alguien lo reclamó entre la carga de la fila y este momento.
  const fila = await db
    .prepare(
      `SELECT p.anotador_usuario_id AS id, u.nombre, u.email
         FROM partidos p LEFT JOIN usuarios u ON u.id = p.anotador_usuario_id
        WHERE p.id = ?1`
    )
    .bind(partido.id)
    .first<{ id: number | null; nombre: string | null; email: string | null }>();

  if (!fila || fila.id === null || fila.id === usuarioId) return null;
  return { id: fila.id, nombre: fila.nombre || fila.email };
}
```

Importar `PartidoDeOtroAnotador` y `reclamarPartido` desde `../_lib/eventos`.

Dentro de `onRequestPost`, **después** del bloque que exige `partidos.editar` en los partidos terminados y **antes** del `try` con el `switch`:

```ts
  /*
   * La puerta del reclamo. Una sola, aquí, y no repartida por las funciones de
   * `_lib`: el mismo criterio que el bloqueo de «ver como», que vive sólo en
   * `_middleware.ts`. Repartirla sería escribirla siete veces y olvidarla en la
   * octava.
   *
   * Va después de la comprobación de permiso porque son preguntas distintas:
   * primero quién eres, que no depende del partido; luego si este partido es
   * tuyo. De ahí que tomar el relevo de un partido terminado herede la exigencia
   * de `partidos.editar`, que es lo coherente: enmendar un resultado cerrado ya
   * la pedía.
   *
   * `relevo` es la salida, así que no pasa por aquí. `soltar` sí: quien no lo
   * lleva toma el relevo primero, porque si no sería una puerta trasera para
   * quitarle el partido a otro sin que quede dicho.
   */
  if (accion !== "relevo") {
    const otro = await asegurarReclamo(env.DB, partido, acceso.user.id);
    if (otro) {
      return jsonAdmin({ error: new PartidoDeOtroAnotador(otro).message, anotador: otro }, 409);
    }
  }
```

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Ejecutar: `npm test -- anotador-reclamo`
Esperado: PASAN todos menos el de `soltar` dentro de «la puerta cubre todas las acciones», que ya debería dar 409 (`soltar` no está exceptuada). Si «dos escrituras a la vez» sale `[200, 200]`, el CAS no está haciendo su trabajo: revisar que la condición esté dentro del `UPDATE` y no en un `if`.

- [ ] **Step 6: Ejecutar la suite entera**

Ejecutar: `npm test`
Esperado: **aquí sí puede romperse algo.** Cualquier test que monte un partido con un usuario y escriba con otro recibirá ahora un 409 legítimo. Repasar `test/integration/anotacion.test.ts` y `test/integration/cambios-estres.test.ts`: donde el 409 sea correcto, actualizar el test para que use el mismo usuario o pase por `relevo`. **No se toca la puerta para que un test viejo siga pasando.**

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/eventos.ts functions/api/anotacion.ts test/integration/anotador-reclamo.test.ts
git commit -F - <<'EOF'
feat(anotador): un partido lo anota una sola persona

El partido se reclama con la primera escritura. Quien no lo lleva recibe un
409 que dice quién lo lleva.

El reclamo se toma con un UPDATE condicional, no con un SELECT y un if: dos
peticiones a la vez leerían las dos que está libre y las dos se darían por
dueñas. La condición la resuelve D1.

La puerta va en un solo sitio, antes del switch del endpoint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: El relevo y soltar

**Files:**
- Modify: `functions/_lib/eventos.ts` (`soltarAnotacion`, ~línea 896)
- Modify: `functions/api/anotacion.ts` (`accionRelevo` y el `switch`)
- Modify: `test/integration/anotador-reclamo.test.ts`

**Interfaces:**
- Consumes: la puerta de la tarea 2, `respuesta(db, partido, usuarioId, ...)` de la tarea 1.
- Produces: acción `POST { accion: "relevo" }`, que responde 200 con el cuerpo completo y el `anotador` ya cambiado.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/integration/anotador-reclamo.test.ts`:

```ts
describe("el relevo", () => {
  it("tras el relevo anota el nuevo y el anterior recibe 409", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);

    const relevo = await anotar(berta, partidoId, { accion: "relevo" });
    expect(relevo.status).toBe(200);
    expect(((await relevo.json()) as Respuesta).anotador.id).toBe(berta.id);

    const suyo = await anotar(berta, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });
    expect(suyo.status).toBe(201);

    const delViejo = await anotar(ana, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[1]!.id,
      ordenEsperado: 1
    });
    expect(delViejo.status).toBe(409);
  });

  /*
   * Siempre disponible y nunca falla. Si al anterior anotador se le acabó la
   * batería, el siguiente tiene que poder entrar sin llamar a nadie: por eso el
   * reclamo es blando y no un cerrojo.
   */
  it("el relevo de un partido que no lleva nadie también vale", async () => {
    const ana = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const respuesta = await anotar(ana, partidoId, { accion: "relevo" });

    expect(respuesta.status).toBe(200);
    expect((await leer(ana, partidoId)).anotador.id).toBe(ana.id);
  });

  it("soltar libera el partido, y después lo anota otro sin relevo", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);

    expect((await anotar(ana, partidoId, { accion: "soltar" })).status).toBe(200);
    expect((await leer(berta, partidoId)).anotador.id).toBeNull();

    const respuesta = await anotar(berta, partidoId, {
      accion: "alineacion",
      lado: "A",
      jugadorIds: local.jugadores.map((j) => j.id)
    });
    expect(respuesta.status).toBe(200);
    expect((await leer(berta, partidoId)).anotador.id).toBe(berta.id);
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Ejecutar: `npm test -- anotador-reclamo`
Esperado: FALLAN. `relevo` cae en el `default` del `switch` y responde 400 «La acción no es válida».

- [ ] **Step 3: `soltarAnotacion` libera el reclamo**

En `functions/_lib/eventos.ts`, sustituir el cuerpo de `soltarAnotacion`:

```ts
export async function soltarAnotacion(db: D1Database, partidoId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE partidos SET origen_marcador = 'manual', anotador_usuario_id = NULL,
              log_version = log_version + 1, updated_at = ?1
        WHERE id = ?2`
    )
    .bind(new Date().toISOString(), partidoId)
    .run();
}
```

Actualizar también su comentario de cabecera, añadiendo una frase:

```ts
/**
 * Devuelve el mando al panel. El marcador derivado se queda congelado en las
 * columnas planas y el log se conserva: soltar no es borrar lo anotado.
 *
 * Y suelta el reclamo: quien lo llevaba deja de llevarlo, así que el siguiente
 * anotador entra sin pedir el relevo. Es la salida limpia al terminar un partido.
 */
```

- [ ] **Step 4: La acción `relevo`**

En `functions/api/anotacion.ts`, añadir la función:

```ts
/**
 * Toma el partido, lo lleve quien lo lleve.
 *
 * Sin condición y sin comprobar nada: es la salida del 409, y una salida que
 * puede fallar no es una salida. Tampoco hace falta registrar el cambio de
 * manos en ninguna parte, porque cada evento del log ya va firmado con su
 * `usuario_id`.
 */
async function accionRelevo(db: D1Database, partido: PartidoAnotable, usuarioId: number): Promise<Response> {
  await db
    .prepare("UPDATE partidos SET anotador_usuario_id = ?1 WHERE id = ?2")
    .bind(usuarioId, partido.id)
    .run();
  return await respuesta(db, partido, usuarioId);
}
```

Y en el `switch`, junto a `soltar`:

```ts
      case "relevo":
        return await accionRelevo(env.DB, partido, acceso.user.id);
```

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Ejecutar: `npm test -- anotador-reclamo`
Esperado: PASAN todos.

- [ ] **Step 6: Ejecutar la suite entera y los tipos**

Ejecutar: `npm test && npm run test:types`
Esperado: verde.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/eventos.ts functions/api/anotacion.ts test/integration/anotador-reclamo.test.ts
git commit -F - <<'EOF'
feat(anotador): tomar el relevo de un partido

La acción «relevo» transfiere el partido sin condiciones. Es la salida del
409, y una salida que puede fallar no sirve: si al anterior anotador se le
acaba la batería, el siguiente entra sin llamar a nadie.

Soltar la anotación ahora también libera el reclamo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Los dos agujeros que el reclamo no tapa

El reclamo separa a dos personas. Dos pestañas de la **misma** persona pasan la puerta con el mismo `usuario_id`, y ahí sigue trabajando el `UNIQUE(partido_id, orden)`. Estas dos son las grietas que le quedaban.

**Files:**
- Modify: `functions/_lib/eventos.ts` (`corregirEvento` ~línea 515, `adoptarMarcador` ~línea 869)
- Modify: `functions/api/anotacion.ts` (`accionCorregir`)
- Modify: `public/assets/anotador/partido.js` (`guardarCorreccion`, ~línea 644)
- Modify: `test/integration/anotacion.test.ts`

**Interfaces:**
- Consumes: `ConflictoDeOrden` (ya existe).
- Produces: `corregirEvento(db, partido, orden, cambios, alineacion, ordenEsperado)` — **`ordenEsperado` es el sexto parámetro**.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/integration/anotacion.test.ts`, al final:

```ts
/*
 * El reclamo del partido separa a dos personas. A la misma persona con dos
 * pestañas abiertas la separa esto: las dos pasan la puerta con el mismo
 * usuario, y lo único que las distingue es el orden que cada una vio.
 */
describe("dos pestañas del mismo anotador", () => {
  it("corregir con un orden desfasado da 409", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const respuesta = await anotar(admin, partidoId, {
      accion: "corregir",
      orden: 0,
      jugadorId: local.jugadores[1]!.id,
      ordenEsperado: 99
    });

    expect(respuesta.status).toBe(409);
  });

  it("corregir con el orden al día sí entra", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const respuesta = await anotar(admin, partidoId, {
      accion: "corregir",
      orden: 0,
      jugadorId: local.jugadores[1]!.id,
      ordenEsperado: 1
    });

    expect(respuesta.status).toBe(200);
    const { eventos } = await leer(admin, partidoId);
    expect(eventos[0]!.jugadorId).toBe(local.jugadores[1]!.id);
  });

  /*
   * Dos adopciones a la vez chocan contra el UNIQUE. Sin traducirlo, la segunda
   * salía como un 500 «No se ha podido guardar»: un fallo del motor con pinta de
   * avería, en el móvil de quien está a pie de pista.
   */
  it("dos adopciones a la vez dan 409 con su motivo, no un 500", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montarPartido(admin, undefined, { puntosA: 8, puntosB: 6 });

    const respuestas = await Promise.all([
      anotar(admin, partidoId, { accion: "adoptar" }),
      anotar(admin, partidoId, { accion: "adoptar" })
    ]);

    const estados = respuestas.map((r) => r.status).sort();
    expect(estados).toEqual([201, 409]);
    const perdedora = respuestas.find((r) => r.status === 409)!;
    expect(((await perdedora.json()) as Respuesta).error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Ejecutar: `npm test -- anotacion.test`
Esperado: FALLAN los tres. El primero da 200 (no se mira el orden), el segundo da 400 si ya se exige el campo (todavía no), y el tercero da `[201, 500]`.

- [ ] **Step 3: `ordenEsperado` en `corregirEvento`**

En `functions/_lib/eventos.ts`, cambiar la firma y añadir la comprobación:

```ts
export async function corregirEvento(
  db: D1Database,
  partido: PartidoAnotable,
  orden: number,
  cambios: { tipo?: TipoEvento; jugadorId?: number; punto?: boolean },
  alineacion: readonly AlineacionFila[],
  ordenEsperado: number
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);

  /*
   * Mismo control que al anotar, y por lo mismo. Corregir vuelve a plegar el log
   * entero, así que hacerlo sobre una lectura vieja se lleva por delante lo que
   * haya entrado en medio: dos correcciones sobre el mismo evento y la segunda
   * pisaba a la primera sin decir nada.
   */
  const siguiente = eventos.length === 0 ? 0 : eventos[eventos.length - 1]!.orden + 1;
  if (ordenEsperado !== siguiente) throw new ConflictoDeOrden();

  const indice = eventos.findIndex((evento) => evento.orden === orden);
  if (indice === -1) throw new ConflictoDeOrden();
```

El resto de la función no cambia.

- [ ] **Step 4: Pedirlo en el endpoint**

En `functions/api/anotacion.ts`, dentro de `accionCorregir`, después de validar `orden`:

```ts
  const ordenEsperado = ordenDe(body);
  if (ordenEsperado === null) return jsonAdmin({ error: "Falta el orden esperado." }, 400);
```

Y pasarlo:

```ts
  const resultado = await corregirEvento(db, partido, orden, cambios, alineacion, ordenEsperado);
```

- [ ] **Step 5: Mandarlo desde el cliente**

En `public/assets/anotador/partido.js`, dentro de `guardarCorreccion`, añadir el campo al cuerpo:

```js
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "corregir",
        orden: correccion.orden,
        ordenEsperado: datos.siguienteOrden,
        tipo: correccion.tipo,
        jugadorId: correccion.jugadorId,
```

- [ ] **Step 6: El `catch` del UNIQUE en `adoptarMarcador`**

En `functions/_lib/eventos.ts`, envolver el `db.batch` de `adoptarMarcador`:

```ts
  const { sentencias } = sentenciasDerivadas(db, partido, [...eventos, fila]);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO partido_eventos
             (partido_id, orden, set_numero, tipo, puntos_a, puntos_b, sets_a, sets_b, usuario_id)
           VALUES (?1, ?2, ?3, 'ajuste', ?4, ?5, ?6, ?7, ?8)`
        )
        .bind(
          partido.id,
          orden,
          saldo.sets_a + saldo.sets_b + 1,
          saldo.puntos_a,
          saldo.puntos_b,
          saldo.sets_a,
          saldo.sets_b,
          usuarioId
        ),
      ...sentencias
    ]);
  } catch (error) {
    /*
     * Mismo cierre que en `registrarEvento`, que aquí faltaba: dos adopciones a
     * la vez chocan contra el UNIQUE y la perdedora salía como un 500 genérico.
     * Un fallo del motor con pinta de avería no le dice a quien está a pie de
     * pista lo único que necesita saber, que es que vuelva a mirar.
     */
    if (String(error).includes("UNIQUE")) throw new ConflictoDeOrden();
    throw error;
  }
```

- [ ] **Step 7: Ejecutar los tests y verificar que pasan**

Ejecutar: `npm test -- anotacion.test`
Esperado: PASAN los tres nuevos.

- [ ] **Step 8: Actualizar el comentario del bloque que ya existía**

En `test/integration/anotacion.test.ts`, el `describe("dos anotadores a la vez")` usa el **mismo** usuario para las dos peticiones, así que desde la tarea 2 ya no describe a dos anotadores: describe dos pestañas. Cambiar su comentario y su nombre:

```ts
/*
 * Dos pestañas de la misma persona sobre el mismo partido. El reclamo no las
 * separa —pasan la puerta con el mismo usuario—, así que aquí sigue trabajando
 * el UNIQUE(partido_id, orden): convierte «la segunda pisa a la primera» en «la
 * segunda se entera».
 */
describe("el mismo anotador desde dos pestañas", () => {
```

- [ ] **Step 9: Ejecutar la suite entera y los tipos**

Ejecutar: `npm test && npm run test:types`
Esperado: verde.

- [ ] **Step 10: Commit**

```bash
git add functions/_lib/eventos.ts functions/api/anotacion.ts public/assets/anotador/partido.js test/integration/anotacion.test.ts
git commit -F - <<'EOF'
fix(anotador): corregir y adoptar también controlan el orden

Corregir vuelve a plegar el log entero, así que hacerlo sobre una lectura
vieja se llevaba por delante lo que hubiera entrado en medio. Ahora pide el
orden esperado, como anotar.

Adoptar no traducía el choque contra el UNIQUE, así que dos adopciones a la
vez dejaban un 500 genérico en el móvil de quien anota.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: La pantalla

**REQUERIDO antes de empezar:** invocar la skill `frontend-design:frontend-design`. Lo pide CLAUDE.md para cualquier cambio de interfaz.

**Files:**
- Modify: `src/pages/anotador/partido.astro` (antes de `<section class="anot-decision">`, ~línea 43)
- Modify: `src/styles/anotador/index.css` (antes del bloque «decisión», ~línea 228)
- Modify: `public/assets/anotador/partido.js` (`pintar` ~60, `pintarDecision` ~116, el cableado ~780)
- Modify: `public/assets/anotador/lista.js` (`tarjeta`, ~línea 44)
- Modify: `functions/api/anotacion.ts` (`partidosDeHoy`, ~línea 211)
- Modify: `test/unit/anotador-partido.test.ts`

**Interfaces:**
- Consumes: `anotador: { id, nombre, puedeAnotar }` y `ultimaActividad` de la tarea 1; la acción `relevo` de la tarea 3.
- Produces: `data-anot-relevo`, `data-anot-relevo-titulo`, `data-anot-relevo-texto`, `data-anot-relevo-tomar` en el marcado.

- [ ] **Step 1: Escribir el test que falla**

En `test/unit/anotador-partido.test.ts`, añadir al `MARCADO` justo antes de `<section class="anot-decision" ...>`:

```html
    <section class="anot-relevo" data-anot-relevo hidden>
      <h2 data-anot-relevo-titulo></h2>
      <p data-anot-relevo-texto></p>
      <button type="button" data-anot-relevo-tomar>Tomar el relevo</button>
    </section>
```

El fichero ya trae lo que hace falta para arrancar la pantalla: `montar(datos)` (línea 181) monta el marcado, simula `fetch` y ejecuta los scripts en el orden de la página; `peticiones` (línea 172) recoge las llamadas con su cuerpo; `respirar()` (línea 170) cede el turno al bucle de eventos. Añadir un `describe` nuevo que los use:

```ts
describe("un partido que lleva otra persona", () => {
  const respuestaDeOtro = {
    partido: { id: "p1", status: "live", reglas: {}, startedAt: null },
    estado: { puntos: { A: 3, B: 2 }, sets: { A: 0, B: 0 }, setNumero: 1, historial: [], terminado: false, winner: null },
    eventos: [],
    siguienteOrden: 5,
    alineacion: [],
    marcadorPanel: { puntos: { A: 3, B: 2 }, sets: { A: 0, B: 0 } },
    pendienteDeAdoptar: false,
    anotador: { id: 7, nombre: "Ana Muros", puedeAnotar: false },
    ultimaActividad: "2026-08-01 17:40:00",
    cambios: [],
    equipos: { A: { nombre: "Delfines", jugadores: [] }, B: { nombre: "Gaviotas", jugadores: [] } },
    tipos: TIPOS
  };

  it("esconde la pista y la zona del pulgar, y dice quién lo lleva", async () => {
    await montar(respuestaDeOtro);

    expect(document.querySelector<HTMLElement>("[data-anot-relevo]")!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-anot-pista]")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-anot-pulgar]")!.hidden).toBe(true);
    expect(document.querySelector("[data-anot-relevo-titulo]")!.textContent).toContain("Ana Muros");
    expect(document.querySelector("[data-anot-relevo-texto]")!.textContent).toContain("17:40");
  });

  it("el botón pide el relevo", async () => {
    await montar(respuestaDeOtro);
    peticiones.length = 0;

    document.querySelector<HTMLButtonElement>("[data-anot-relevo-tomar]")!.click();
    await respirar();

    expect(peticiones[0]?.cuerpo).toMatchObject({ accion: "relevo" });
  });

  it("cuando no lo lleva nadie, la pista se pinta", async () => {
    await montar({ ...respuestaDeOtro, anotador: { id: null, nombre: null, puedeAnotar: true } });

    expect(document.querySelector<HTMLElement>("[data-anot-relevo]")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-anot-pista]")!.hidden).toBe(false);
  });
});
```

**Sobre el `17:40` del primer test:** `ultimaActividad` va como `"2026-08-01 17:40:00"`, que es el formato de `datetime('now')` de SQLite y es UTC. `horaDe` lo normaliza a UTC y lo formatea en la zona local del entorno de test. Si Vitest corre en una zona distinta de UTC, ese `toContain("17:40")` falla por una razón que no es el código. Comprobarlo al ejecutar: si falla por la zona, fijar `TZ=UTC` para el proyecto `unit` en `test/unit/vitest.config.ts` o comprobar que el texto contiene «Su último apunte fue a las» en vez de la hora exacta.

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Ejecutar: `npm test -- anotador-partido`
Esperado: FALLAN los tres. `[data-anot-relevo]` sigue `hidden` porque nada lo pinta.

- [ ] **Step 3: El marcado**

En `src/pages/anotador/partido.astro`, antes de la sección `anot-decision`:

```astro
    {/*
      Otra persona lleva este partido. Ocupa el sitio de la pista por lo mismo
      que la caja de decisión: no se pintan botones que van a responder 409.

      El relevo siempre se puede tomar. Si al anterior anotador se le acabó la
      batería, el siguiente tiene que poder entrar sin llamar a nadie.
    */}
    <section class="anot-relevo" data-anot-relevo hidden>
      <h2 class="anot-relevo-titulo" data-anot-relevo-titulo></h2>
      <p class="anot-relevo-texto" data-anot-relevo-texto></p>
      <div class="anot-relevo-botones">
        <button type="button" class="anot-btn anot-btn--primario" data-anot-relevo-tomar>
          Tomar el relevo
        </button>
      </div>
    </section>
```

- [ ] **Step 4: Los estilos**

En `src/styles/anotador/index.css`, antes del bloque `/* --- decisión --- */`:

```css
/* ----------------------------------------------------------------- relevo --- */

/*
 * Otra persona lleva este partido. Ocupa el sitio de la pista, así que no suma
 * alto: el presupuesto vertical de esta pantalla ya está gastado entero.
 *
 * Azul y no ámbar: la caja ámbar significa «hay algo que decidir sobre el
 * marcador», y esto es otra cosa. Tampoco es un error, así que rojo tampoco.
 */
.anot-relevo {
  background: #dceaf7;
  border: 3px solid #1d5c8f;
  border-radius: 16px;
  margin: 14px 0;
  padding: 16px;
}

.anot-relevo-titulo {
  color: #123c5e;
  font-size: 1.25rem;
  margin: 0 0 6px;
}

.anot-relevo-texto {
  color: #123c5e;
  font-size: 0.92rem;
  margin: 0 0 14px;
}

.anot-relevo-botones {
  display: grid;
  gap: 8px;
}
```

Comprobar el contraste del texto sobre el fondo (mínimo 4,5:1). `#123c5e` sobre `#dceaf7` da ~8,9:1.

- [ ] **Step 5: El pintado**

En `public/assets/anotador/partido.js`, dentro de `pintar()`, sustituir el bloque que hoy dice:

```js
    pintarDecision(decidir);
    $("[data-anot-pista]").hidden = decidir;
    $("[data-anot-pulgar]").hidden = decidir;
```

por:

```js
    /*
     * El relevo va antes que la decisión: no se decide sobre el marcador de un
     * partido que no llevas.
     */
    const relevo = datos.anotador ? datos.anotador.puedeAnotar === false : false;
    pintarRelevo(relevo);
    pintarDecision(!relevo && decidir);
    $("[data-anot-pista]").hidden = relevo || decidir;
    $("[data-anot-pulgar]").hidden = relevo || decidir;
```

Añadir, junto a `pintarDecision`:

```js
  /**
   * La hora de una marca de tiempo del servidor.
   *
   * `updated_at` llega de dos sitios: `new Date().toISOString()` desde el código
   * y `datetime('now')` desde el DEFAULT de SQLite, que no lleva ni «T» ni «Z» y
   * es UTC. Sin normalizarla, el segundo caso da «Invalid Date» en unos motores
   * y una hora local equivocada en otros.
   */
  const horaDe = (marca) => {
    if (!marca) return "";
    const fecha = new Date(/[TZ]/.test(marca) ? marca : `${marca.replace(" ", "T")}Z`);
    if (Number.isNaN(fecha.getTime())) return "";
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(fecha);
  };

  function pintarRelevo(relevo) {
    const caja = $("[data-anot-relevo]");
    caja.hidden = !relevo;
    if (!relevo) return;

    const quien = datos.anotador.nombre || "otra persona";
    const hora = horaDe(datos.ultimaActividad);
    $("[data-anot-relevo-titulo]").textContent = `Lo lleva ${quien}`;
    $("[data-anot-relevo-texto]").textContent = hora
      ? `Su último apunte fue a las ${hora}. Toma el relevo si vas a anotarlo tú.`
      : "Toma el relevo si vas a anotarlo tú.";
  }
```

Y el cableado, junto a los demás listeners:

```js
  $("[data-anot-relevo-tomar]").addEventListener("click", () => accionSimple({ accion: "relevo" }));
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Ejecutar: `npm test -- anotador-partido`
Esperado: PASAN los tres.

- [ ] **Step 7: La lista de partidos**

En `functions/api/anotacion.ts`, `partidosDeHoy`, añadir el `LEFT JOIN` y el campo:

```ts
  const { results } = await db
    .prepare(
      `SELECT p.id, p.ronda, p.pista, p.status, p.origen_marcador, p.scheduled_at,
              p.equipo_a_nombre, p.equipo_b_nombre, p.points_a, p.points_b, p.sets_a, p.sets_b,
              p.anotador_usuario_id, u.nombre AS anotador_nombre, u.email AS anotador_email
         FROM partidos p
         LEFT JOIN usuarios u ON u.id = p.anotador_usuario_id
        WHERE p.edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
          AND p.status <> 'finished'
        ORDER BY (p.status = 'live') DESC, COALESCE(p.scheduled_at, '9999'), p.sort_order ASC`
    )
    .all<Record<string, unknown>>();
```

Y en el `map`, junto a `origenMarcador`:

```ts
    anotador:
      fila.anotador_usuario_id === null
        ? null
        : { id: fila.anotador_usuario_id, nombre: fila.anotador_nombre || fila.anotador_email },
```

En `public/assets/anotador/lista.js`, sustituir el bloque de la nota:

```js
    // Que ya lo lleve alguien no lo bloquea, pero conviene saberlo antes de
    // entrar: dentro habrá que pedir el relevo.
    if (partido.anotador && partido.anotador.nombre) {
      enlace.append(el("p", "anot-partido-nota", `Lo lleva ${partido.anotador.nombre}`));
    } else if (partido.origenMarcador === "eventos") {
      enlace.append(el("p", "anot-partido-nota", "Ya se está anotando"));
    }
```

- [ ] **Step 8: Actualizar el comentario del `visibilitychange`**

En `public/assets/anotador/partido.js`, el bloque de comentario sobre releer al volver a la pantalla (~línea 790) dice que «dos personas anotan el mismo partido sin saberlo». Desde el reclamo eso ya no pasa. Sustituir esa frase:

```js
   * horas sería gastar por gastar. Lo que sí pasa es que el móvil se bloquea
   * entre sets, o que alguien ha tomado el relevo mientras tanto: al volver, lo
   * que hay en pantalla puede ser de hace diez minutos y el primer toque se lo
   * lleva un 409. Una lectura al reaparecer cuesta una petición y se ahorra ese
   * toque perdido, que es el que duele porque llega justo cuando hay tres
   * segundos para anotar.
```

- [ ] **Step 9: Verificar en el navegador, en móvil**

```bash
npm run build && npx wrangler dev --port 8838
```

Abrir `/anotador/partido/?id=<id>` con dos cuentas distintas y comprobar:
- La caja del relevo sale y la pista no.
- El botón funciona y la pantalla pasa a modo anotación.
- **A 390px de ancho la zona del pulgar sigue dentro de la pantalla.** Chrome no baja de ~500px de ventana, así que para medir de verdad usar el emulador de dispositivo, no `--window-size`.

- [ ] **Step 10: Ejecutar la suite entera y los tipos**

Ejecutar: `npm test && npm run test:types`
Esperado: verde.

- [ ] **Step 11: Commit**

```bash
git add src/pages/anotador/partido.astro src/styles/anotador/index.css public/assets/anotador/partido.js public/assets/anotador/lista.js functions/api/anotacion.ts test/unit/anotador-partido.test.ts
git commit -F - <<'EOF'
feat(anotador): la pantalla dice quién lleva el partido

Si lo lleva otra persona, la caja del relevo ocupa el sitio de la pista: no se
pintan botones que van a responder 409. Enseña quién lo lleva y a qué hora fue
su último apunte, que es lo que hace falta para decidir.

La lista de partidos lo dice también, antes de entrar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Documentar la rama en CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (sección «Anotación en directo (`/anotador/`)»)

- [ ] **Step 1: Escribir el párrafo**

En `CLAUDE.md`, en la sección «Anotación en directo», **justo después** de la línea que empieza por `**\`UNIQUE(partido_id, orden)\` is the concurrency control.**`, añadir:

```markdown
- **El `UNIQUE` separa a dos pestañas; a dos personas las separa el reclamo.** `partidos.anotador_usuario_id` (migración 0029) dice quién lleva el partido. El `UNIQUE` sólo salta cuando dos anotadores coinciden en el mismo hueco: si se turnan sin llegar a chocar —y con una sola pista ése es el caso normal— los dos anotan el mismo partido y ninguno se entera. El reclamo se toma con la **primera escritura**, no al abrir la pantalla (entrar a mirar el marcador no echa a nadie), y con un `UPDATE ... WHERE anotador_usuario_id IS NULL`: la condición va dentro de la sentencia porque un `SELECT` seguido de un `if` no es atómico y dejaría el mismo agujero, más difícil de ver. La puerta está en **un solo sitio**, `onRequestPost` de `api/anotacion.ts` antes del `switch`, igual que el bloqueo de «ver como» vive sólo en el middleware. `soltar` libera el reclamo; `relevo` lo transfiere sin condiciones y es la única acción que se salta la puerta — una salida que puede fallar no es una salida. **No caduca**: el partido cambia de manos sólo cuando alguien lo pide, nunca por un reloj. `test/integration/anotador-reclamo.test.ts`.
```

- [ ] **Step 2: Corregir las dos líneas que el reclamo deja desfasadas**

En la misma sección hay dos frases que ya no son ciertas.

**La primera**, sobre por qué el anotador relee al volver a la pantalla. Sustituir:

> pero el móvil se bloquea entre sets y dos personas pueden anotar el mismo partido, y entonces el primer toque se lo lleva un conflicto de orden — justo cuando hay tres segundos para anotar.

por:

> pero el móvil se bloquea entre sets, y desde el reclamo también puede haber cambiado de manos mientras tanto: en los dos casos el primer toque se lo lleva un 409 — justo cuando hay tres segundos para anotar.

**La segunda**, en la línea de `tras_orden`. Sustituir:

> Lo calcula el servidor, como `lado_punto`, y por eso un cambio no necesita `ordenEsperado` ni puede dar 409.

por:

> Lo calcula el servidor, como `lado_punto`, y por eso un cambio no necesita `ordenEsperado` ni puede chocar por el orden. Sí puede dar 409 por el reclamo, que es anterior y vale para toda escritura.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: el reclamo del partido en CLAUDE.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Verificar e integrar

- [ ] **Step 1: La verificación completa**

Ejecutar: `npm run verify`
Esperado: verde. Incluye `astro check`, los tipos de los tests y los tres proyectos de Vitest.

**Antes de lanzarlo**, comprobar que no hay otra sesión con `verify` en marcha: cada uno arranca workerd y una D1 real, y esa carga en paralelo es justo lo que empuja al proyecto `integration` por encima de sus 20 s de límite.

- [ ] **Step 2: Repasar la migración**

Ejecutar: `ls db/migrations/ | grep 0029`
Esperado: un solo fichero. Si `development` ha ganado otro 0029 mientras tanto, **renumerar el nuestro**, nunca el que ya está integrado. `npm run integrar` se niega a mezclar si hay número repetido, y esa comprobación corre antes del merge.

- [ ] **Step 3: Integrar**

```bash
npm run integrar -- -m "El partido tiene un solo anotador: se reclama al anotar y se cede con el relevo"
```

Mezcla `development`, vuelve a verificar, publica la rama y el merge. Si el push sale rechazado, otra sesión integró mientras verificábamos: repetir el ciclo entero, verificación incluida.

- [ ] **Step 4: Avisar de la migración pendiente**

La 0029 **no** está en producción hasta que se promueva a `main`, y promover es aplicar las migraciones. Decírselo al usuario, sin promover: eso se pregunta aparte.

---

## Notas para quien ejecute

**Lo que no hay que hacer:**

- **No convertir el CAS en un `SELECT` + `if`.** Es el punto entero de la tarea 2. Si el test «dos escrituras a la vez» da `[200, 200]`, es esto.
- **No añadir caducidad al reclamo.** Se descartó a propósito: un relevo automático vuelve a meter el «cambia de manos solo» que el diseño rechaza, y añade un parámetro que afinar el día del torneo.
- **No meter comprobaciones del reclamo en las funciones de `_lib/eventos.ts`.** La puerta es una y está en el endpoint.
- **No exceptuar `soltar` de la puerta.** Sería la forma de quitarle el partido a otro sin que quede dicho.
- **No debilitar un test para que pase.** En la tarea 2, paso 6, algún test antiguo fallará de forma legítima. Se actualiza el test.

**Lo que hay que vigilar:**

- La firma de `respuesta()` cambia en la tarea 1 y la tocan diez sitios. TypeScript los señala; `npm run test:types` es la comprobación.
- `crearAdmin({ nombre: ... })` puede no estar soportado en `test/helpers/db.ts`. Comprobarlo en la tarea 2, paso 1.
- El `describe("dos anotadores a la vez")` que ya existe usa el mismo usuario dos veces, así que **sobrevive** al reclamo y pasa a documentar el caso de las dos pestañas. Se le cambia el nombre en la tarea 4, no antes.
