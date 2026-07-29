# Estadísticas sólo por partido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una estadística de juego no pueda existir salvo colgando de un partido, de modo que lo que se ve en el álbum sea por construcción el sumatorio de los partidos jugados.

**Architecture:** El cerrojo va en la base: la migración 0012 recrea `estadisticas` con `partido_id NOT NULL` y elimina la columna `partidos_jugados`, que pasa a contarse (`COUNT(DISTINCT partido_id)`). La API deja de aceptar cifras y el panel las muestra en sólo lectura. Esta fase **sólo cierra**; la ficha por partido que las cargará va en un spec posterior.

**Tech Stack:** Astro 5 (estático), Cloudflare Pages Functions + D1 + R2, TypeScript en `functions/`, JavaScript plano sin bundler en `public/assets/`, Vitest (proyectos `unit`, `integration`, `e2e`).

**Spec:** `docs/superpowers/specs/2026-07-29-estadisticas-solo-por-partido-design.md`

## Global Constraints

- Todo el texto de cara al usuario va en **español con acentos correctos** ("Música", "información"). El deporte se escribe siempre **"volley"**, nunca "vóley".
- Tono de la copia: corto y seguro, sin chistes.
- Los mensajes en pantalla se pintan siempre con `textContent`, nunca con `innerHTML`.
- Todo cambio de frontend debe ser responsive: se comprueba con las media queries de 900 px y 560 px. Los valores base son la escala **móvil**; la densidad de escritorio vive en el bloque `@media (min-width: 901px)`.
- Antes de tocar estilos, invocar la skill `frontend-design:frontend-design`.
- Nada de `window.confirm` en `/admin/*`: allí se usa `CopaAdmin.confirmar()`.
- El panel usa un IIFE por página sobre `window.CopaAdmin` (`api`, `apiJson`, `onReady`, `recargar`, `tabla`, `confirmar`).
- Los estilos de `/admin/*` van en `src/styles/admin/`, con los tokens `--adm-*`. No se tocan los estilos públicos.
- La migración es la **0012**: `feature/capitan-equipo` tiene una `0011_capitan.sql` sin mergear en `development`. No renumerar.
- Cada tarea acaba con su commit. No se mezcla con `development` sin `npm run verify` en verde.
- Rama de trabajo: `feature/estadisticas-solo-por-partido` (ya creada desde `development`).

## Convenciones de este plan

- Ejecutar un test suelto: `npx vitest run --project unit test/unit/<fichero>` o `npx vitest run --project integration test/integration/<fichero>`.
- Todo (menos `e2e`) corre sin build previo. `npm test` son unit + integration, unos 10 s.
- Las migraciones de `db/migrations/` las lee sola la config de `test/integration/vitest.config.ts` (`readD1Migrations`) y el setup las aplica antes de cada suite. Un `.sql` nuevo no necesita registrarse en ningún sitio.

## Estructura de ficheros

| Fichero | Responsabilidad tras el cambio |
|---|---|
| `db/migrations/0012_estadisticas_por_partido.sql` | **Nuevo.** El cerrojo: recrea `estadisticas` con `partido_id NOT NULL` y sin `partidos_jugados`. |
| `functions/_lib/estadisticas.ts` | Métricas y agregación. Pierde las tres funciones de escritura manual; gana el concepto de métrica **derivada**. |
| `functions/api/admin/estadisticas.ts` | Lee totales y guarda **sólo** atributos y visibilidad. Ya no escribe cifras. |
| `src/pages/admin/estadisticas.astro` | El bloque de cifras deja de ser un formulario. |
| `public/assets/admin/estadisticas.js` | Pinta las cifras en sólo lectura; deja de recogerlas al guardar. |
| `src/styles/admin/forms.css` | Estilo del bloque de cifras en sólo lectura. |
| `test/helpers/db.ts` | `crearPartido()` nuevo; `crearEstadistica()` exige partido. |
| `test/integration/estadisticas-cerrojo.test.ts` | **Nuevo.** El test que demuestra que la regla vive en la base. |

---

### Task 1: El cerrojo — base de datos, `_lib` y endpoint

Recrea la tabla, deriva los partidos jugados y quita del backend toda vía de escritura de cifras. Es una tarea grande a propósito: la columna `partidos_jugados` desaparece, así que la migración, `_lib/estadisticas.ts`, el endpoint y los sembradores de test tienen que moverse a la vez o el árbol queda rojo.

**Files:**
- Create: `db/migrations/0012_estadisticas_por_partido.sql`
- Create: `test/integration/estadisticas-cerrojo.test.ts`
- Modify: `functions/_lib/estadisticas.ts`
- Modify: `functions/api/admin/estadisticas.ts`
- Modify: `test/helpers/db.ts`
- Modify: `test/unit/estadisticas.test.ts`
- Modify: `test/integration/estadisticas-admin.test.ts`
- Modify: `test/integration/jugadores-publico.test.ts`
- Modify: `test/integration/perfil.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `interface Metrica { clave: string; columna: string; etiqueta: string; derivada?: boolean }`
  - `METRICAS: Metrica[]` — siete entradas, la primera `partidosJugados` con `derivada: true`
  - `METRICAS_PARTIDO: Metrica[]` — las seis con columna real
  - `SUMA_METRICAS: string` — sin cambio de nombre ni de uso
  - **Desaparecen:** `MAX_METRICA`, `validarEstadisticas()`, `sentenciaCargaManual()`
  - `crearPartido(opciones?: OpcionesPartido): Promise<string>` en `test/helpers/db.ts`
  - `crearEstadistica(jugadorId: number, partidoId: string, valores?: Partial<Record<string, number>>): Promise<void>` — **el partido pasa a segundo parámetro y es obligatorio**

- [ ] **Step 1: Escribir el test del cerrojo**

Crear `test/integration/estadisticas-cerrojo.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { crearEquipo } from "../helpers/db";

/*
 * La regla de este proyecto: una estadística de juego sólo existe si cuelga de
 * un partido. Estos tests van contra la base directamente, sin pasar por ningún
 * endpoint, porque de eso se trata: la garantía no puede depender de que nadie
 * añada un INSERT nuevo.
 */
describe("el cerrojo de estadisticas", () => {
  it("la base rechaza una estadística sin partido", async () => {
    const equipo = await crearEquipo();

    await expect(
      env.DB
        .prepare("INSERT INTO estadisticas (jugador_id, partido_id, puntos) VALUES (?1, NULL, 5)")
        .bind(equipo.jugadores[0]!.id)
        .run()
    ).rejects.toThrow();
  });

  it("la tabla ya no tiene columna de partidos jugados", async () => {
    const columnas = await env.DB.prepare("SELECT name FROM pragma_table_info('estadisticas')").all<{
      name: string;
    }>();

    expect(columnas.results.map((c) => c.name)).not.toContain("partidos_jugados");
  });
});
```

- [ ] **Step 2: Ejecutarlo y verlo fallar**

Run: `npx vitest run --project integration test/integration/estadisticas-cerrojo.test.ts`
Expected: los dos tests FALLAN. El primero porque el `INSERT` con `NULL` hoy funciona (no lanza nada, así que `rejects.toThrow()` falla); el segundo porque `partidos_jugados` todavía existe.

- [ ] **Step 3: Escribir la migración**

Crear `db/migrations/0012_estadisticas_por_partido.sql`:

```sql
-- Migration number: 0012 	 estadisticas solo por partido
-- Una estadistica solo puede existir colgando de un partido. La carga manual de
-- la edicion (partido_id IS NULL) desaparece: era la unica via de escritura y
-- permitia teclear cifras que no respondian a ningun partido jugado.
--
-- `partidos_jugados` deja de ser columna. Se deriva contando partidos con ficha,
-- de modo que no puede desincronizarse de las filas que la sostienen.

DELETE FROM estadisticas WHERE partido_id IS NULL;

-- SQLite no sabe volver NOT NULL una columna existente: hay que recrear.
CREATE TABLE estadisticas_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  puntos INTEGER NOT NULL DEFAULT 0,
  remates INTEGER NOT NULL DEFAULT 0,
  bloqueos INTEGER NOT NULL DEFAULT 0,
  aces INTEGER NOT NULL DEFAULT 0,
  defensas INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO estadisticas_nueva (
  id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
)
SELECT id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
FROM estadisticas;

DROP TABLE estadisticas;
ALTER TABLE estadisticas_nueva RENAME TO estadisticas;

-- Sin NULL posible, el UNIQUE deja de necesitar ser parcial; el indice de la
-- carga manual (idx_estadisticas_manual) se fue con la tabla que lo tenia.
CREATE UNIQUE INDEX idx_estadisticas_partido ON estadisticas (jugador_id, partido_id);
CREATE INDEX idx_estadisticas_jugador ON estadisticas (jugador_id);
CREATE INDEX idx_estadisticas_por_partido ON estadisticas (partido_id);
```

- [ ] **Step 4: Reescribir `functions/_lib/estadisticas.ts`**

Contenido completo del fichero:

```ts
// Estadisticas de juego por jugador: metricas y totales.
//
// Una fila de `estadisticas` es lo que un jugador hizo en un partido. Desde la
// migracion 0012 no hay otra forma de que exista: `partido_id` es NOT NULL, asi
// que una cifra tecleada a mano, sin partido detras, no es representable. Lo
// que se muestra es siempre la SUMA de las filas del jugador.
//
// La lista de metricas esta replicada en public/assets/players-list.js y en
// public/assets/cromo.js: al tocar aqui, tocar alli
// (test/unit/paridad-validacion.test.ts lo comprueba).

export interface Metrica {
  /** Clave en el JSON de la API. */
  clave: string;
  /** Nombre de la columna en la fila agregada. */
  columna: string;
  etiqueta: string;
  /** No se almacena: se cuenta al agregar. */
  derivada?: boolean;
}

export const METRICAS: Metrica[] = [
  { clave: "partidosJugados", columna: "partidos_jugados", etiqueta: "Partidos", derivada: true },
  { clave: "puntos", columna: "puntos", etiqueta: "Puntos" },
  { clave: "remates", columna: "remates", etiqueta: "Remates" },
  { clave: "bloqueos", columna: "bloqueos", etiqueta: "Bloqueos" },
  { clave: "aces", columna: "aces", etiqueta: "Aces" },
  { clave: "defensas", columna: "defensas", etiqueta: "Defensas" },
  { clave: "errores", columna: "errores", etiqueta: "Errores" }
];

/**
 * Las que se registran en un partido: las unicas con columna propia.
 *
 * `columna` sigue rellena tambien en la derivada, y no es un descuido:
 * `mapEstadisticas` la usa para leer la fila agregada, y ahi `partidos_jugados`
 * existe como alias del COUNT. Dejarla a null pondria `partidosJugados` a cero
 * en silencio.
 */
export const METRICAS_PARTIDO = METRICAS.filter((m) => !m.derivada);

export type Estadisticas = Record<string, number>;

export function estadisticasVacias(): Estadisticas {
  return Object.fromEntries(METRICAS.map((m) => [m.clave, 0]));
}

/**
 * Las columnas agregadas de las consultas que suman por jugador. Los partidos
 * jugados se cuentan en vez de sumarse: son las propias filas.
 */
export const SUMA_METRICAS = METRICAS.map((m) =>
  m.derivada
    ? `COUNT(DISTINCT e.partido_id) AS ${m.columna}`
    : `COALESCE(SUM(e.${m.columna}), 0) AS ${m.columna}`
).join(", ");

/** Pasa una fila con columnas de la tabla al objeto que viaja en la API. */
export function mapEstadisticas(fila: Record<string, unknown> | null | undefined): Estadisticas {
  const totales = estadisticasVacias();
  if (!fila) return totales;
  for (const m of METRICAS) {
    const valor = fila[m.columna];
    if (typeof valor === "number" && Number.isFinite(valor)) totales[m.clave] = valor;
  }
  return totales;
}

export function sumarTotales(filas: Estadisticas[]): Estadisticas {
  const totales = estadisticasVacias();
  for (const fila of filas) {
    for (const m of METRICAS) {
      const valor = fila[m.clave];
      if (typeof valor === "number" && Number.isFinite(valor)) totales[m.clave] += valor;
    }
  }
  return totales;
}

/** ¿Tiene algo que enseñar? Sirve para no pintar bloques a cero. */
export function hayEstadisticas(totales: Estadisticas): boolean {
  return METRICAS.some((m) => (totales[m.clave] ?? 0) > 0);
}

/** Totales por jugador para una lista de jugadores. Devuelve un mapa id → totales. */
export async function totalesPorJugador(db: D1Database, jugadorIds: number[]): Promise<Map<number, Estadisticas>> {
  const mapa = new Map<number, Estadisticas>();
  if (jugadorIds.length === 0) return mapa;

  const placeholders = jugadorIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT e.jugador_id, ${SUMA_METRICAS}
       FROM estadisticas e
       WHERE e.jugador_id IN (${placeholders})
       GROUP BY e.jugador_id`
    )
    .bind(...jugadorIds)
    .all<Record<string, number>>();

  for (const fila of results) {
    mapa.set(fila.jugador_id, mapEstadisticas(fila));
  }
  return mapa;
}
```

Han desaparecido `MAX_METRICA`, `validarEstadisticas()` y `sentenciaCargaManual()`.

- [ ] **Step 5: Adaptar `functions/api/admin/estadisticas.ts`**

Cinco cambios en el fichero:

1. Cabecera del fichero — sustituir el comentario de las tres primeras líneas de descripción por:

```ts
// /api/admin/estadisticas
//   GET             plantilla de la edición en juego con sus totales, sus
//                   atributos y si está oculta del directorio público
//   PATCH ?jugador=N guarda atributos y visibilidad
//
// Las cifras de juego **no se editan aquí**: salen de sumar los partidos del
// jugador y son de sólo lectura. Si llegan en el cuerpo de un PATCH, se
// ignoran (test/integration/estadisticas-admin.test.ts lo comprueba).
```

2. Import — sustituir el bloque de `../../_lib/estadisticas` por:

```ts
import { mapEstadisticas, METRICAS, totalesPorJugador } from "../../_lib/estadisticas";
```

3. En `onRequestGet`, sustituir la llamada y el nombre de la variable:

```ts
    const ids = results.map((j) => j.id);
    const [totales, atributos] = await Promise.all([
      totalesPorJugador(env.DB, ids),
      atributosPorJugador(env.DB, ids)
    ]);
```

y más abajo, dentro del `map`:

```ts
        estadisticas: totales.get(fila.id) ?? mapEstadisticas(null),
```

4. En `onRequestPatch`, borrar el bloque de validación de cifras y dejar `sentencias` con una sola entrada:

```ts
  const atributos = validarAtributos(body.atributos);
  if ("campos" in atributos) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: atributos.campos }, 400);
  }

  const sentencias = [sentenciaAtributos(env.DB, jugadorId, atributos.atributos)];
```

y la relectura del final:

```ts
  const [totales, atributosGuardados, guardado] = await Promise.all([
    totalesPorJugador(env.DB, [jugadorId]),
    atributosPorJugador(env.DB, [jugadorId]),
    env.DB.prepare("SELECT oculto_publico FROM jugadores WHERE id = ?1").bind(jugadorId).first<{ oculto_publico: number }>()
  ]);

  return jsonAdmin({
    ok: true,
    jugador: {
      id: jugadorId,
      estadisticas: totales.get(jugadorId) ?? mapEstadisticas(null),
      atributos: atributosGuardados.get(jugadorId) ?? {},
      ocultoPublico: guardado?.oculto_publico === 1
    }
  });
```

5. Borrar entera la función local `cargasManuales()` del final del fichero, con su comentario.

- [ ] **Step 6: Actualizar los sembradores de `test/helpers/db.ts`**

Sustituir `crearEstadistica` (líneas 176–202) por estas dos funciones:

```ts
export interface OpcionesPartido {
  ronda?: string;
  equipoA?: EquipoSembrado;
  equipoB?: EquipoSembrado;
}

/**
 * Un partido de la edición actual al que colgar estadísticas. Devuelve su id
 * (es TEXT: un UUID). Los equipos son opcionales porque la mayoría de tests
 * sólo necesitan algo de lo que colgar una fila.
 */
export async function crearPartido(opciones: OpcionesPartido = {}): Promise<string> {
  const id = crypto.randomUUID();
  const edicionId =
    (await env.DB.prepare("SELECT id FROM ediciones WHERE es_actual = 1").first<{ id: number }>())?.id ?? null;

  await env.DB.prepare(
    `INSERT INTO partidos (
       id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre, edicion_id
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(
      id,
      opciones.ronda ?? "Sorteo",
      opciones.equipoA?.id ?? null,
      opciones.equipoB?.id ?? null,
      opciones.equipoA?.nombre ?? "Equipo A",
      opciones.equipoB?.nombre ?? "Equipo B",
      edicionId
    )
    .run();

  return id;
}

/**
 * Lo que un jugador hizo en un partido. `partidoId` va delante y es obligatorio:
 * desde la migración 0012 una estadística sin partido no existe.
 */
export async function crearEstadistica(
  jugadorId: number,
  partidoId: string,
  valores: Partial<Record<string, number>> = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO estadisticas (
       jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(
      jugadorId,
      partidoId,
      valores.puntos ?? 0,
      valores.remates ?? 0,
      valores.bloqueos ?? 0,
      valores.aces ?? 0,
      valores.defensas ?? 0,
      valores.errores ?? 0
    )
    .run();
}
```

- [ ] **Step 7: Ejecutar el test del cerrojo y verlo pasar**

Run: `npx vitest run --project integration test/integration/estadisticas-cerrojo.test.ts`
Expected: PASS los dos.

- [ ] **Step 8: Actualizar `test/unit/estadisticas.test.ts`**

Cambiar el import (fuera `MAX_METRICA` y `validarEstadisticas`, dentro `METRICAS_PARTIDO` y `SUMA_METRICAS`):

```ts
import { describe, expect, it } from "vitest";
import {
  estadisticasVacias,
  hayEstadisticas,
  mapEstadisticas,
  METRICAS,
  METRICAS_PARTIDO,
  sumarTotales,
  SUMA_METRICAS
} from "../../functions/_lib/estadisticas";
```

Borrar entero el `describe("validarEstadisticas", ...)` (líneas 55–79) y añadir al final:

```ts
describe("métricas derivadas", () => {
  it("los partidos jugados se cuentan, no se suman", () => {
    expect(SUMA_METRICAS).toContain("COUNT(DISTINCT e.partido_id) AS partidos_jugados");
    expect(SUMA_METRICAS).not.toContain("SUM(e.partidos_jugados)");
  });

  it("las métricas de partido son las que tienen columna propia", () => {
    expect(METRICAS_PARTIDO.map((m) => m.clave)).toEqual([
      "puntos",
      "remates",
      "bloqueos",
      "aces",
      "defensas",
      "errores"
    ]);
  });

  it("la derivada conserva su columna, que es el alias del COUNT", () => {
    const partidos = METRICAS.find((m) => m.clave === "partidosJugados")!;
    expect(partidos.derivada).toBe(true);
    expect(partidos.columna).toBe("partidos_jugados");
    expect(mapEstadisticas({ partidos_jugados: 3 }).partidosJugados).toBe(3);
  });
});
```

- [ ] **Step 9: Ejecutar los tests unit y verlos pasar**

Run: `npx vitest run --project unit`
Expected: PASS, incluido `paridad-validacion.test.ts` **sin haberlo tocado** — es la prueba de que el literal de `METRICAS` no se ha deformado.

- [ ] **Step 10: Actualizar `test/integration/estadisticas-admin.test.ts`**

Añadir `crearPartido` y `crearEstadistica` al import de `../helpers/db`.

Sustituir el test de las líneas 46–86 ("guarda cifras y atributos…") por:

```ts
  it("guarda atributos e ignora las cifras que lleguen en el cuerpo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const jugadorId = equipo.jugadores[0]!.id;
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 7 });

    const respuesta = await estadisticasPatch(
      ctx(
        await peticion(`/api/admin/estadisticas?jugador=${jugadorId}`, {
          method: "PATCH",
          user: admin,
          json: { estadisticas: { puntos: 999, aces: 50 }, atributos: { saque: 5, bloqueo: 2 } }
        }),
        env
      )
    );
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as {
      jugador: { estadisticas: Record<string, number>; atributos: Record<string, number> };
    };

    // Los atributos sí se guardan; las cifras siguen siendo las del partido.
    expect(datos.jugador.atributos).toEqual({ saque: 5, bloqueo: 2 });
    expect(datos.jugador.estadisticas.puntos).toBe(7);
    expect(datos.jugador.estadisticas.aces).toBe(0);

    const filas = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM estadisticas WHERE jugador_id = ?1")
      .bind(jugadorId)
      .first<{ n: number }>();
    expect(filas!.n).toBe(1);
  });

  it("suma los partidos del jugador y cuenta cuántos ha jugado", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const jugadorId = equipo.jugadores[0]!.id;
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 10, aces: 2 });
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 5, aces: 1 });

    const respuesta = await estadisticasGet(ctx(await peticion("/api/admin/estadisticas", { user: admin }), env));
    const datos = (await respuesta.json()) as {
      jugadores: { id: number; estadisticas: Record<string, number> }[];
    };
    const jugador = datos.jugadores.find((j) => j.id === jugadorId)!;

    expect(jugador.estadisticas.puntos).toBe(15);
    expect(jugador.estadisticas.aces).toBe(3);
    expect(jugador.estadisticas.partidosJugados).toBe(2);
  });
```

En el test "rechaza cifras y atributos fuera de rango" (líneas 88–108), borrar el bloque de `cifras` y renombrarlo, dejándolo así:

```ts
  it("rechaza atributos fuera de rango", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const url = `/api/admin/estadisticas?jugador=${equipo.jugadores[0]!.id}`;

    const atributos = await estadisticasPatch(
      ctx(await peticion(url, { method: "PATCH", user: admin, json: { atributos: { saque: 9 } } }), env)
    );
    expect(atributos.status).toBe(400);
    expect(((await atributos.json()) as { campos: Record<string, string> }).campos).toHaveProperty([
      "atributos.saque"
    ]);
  });
```

- [ ] **Step 11: Actualizar `test/integration/jugadores-publico.test.ts`**

Añadir `crearPartido` al import de `../helpers/db`.

Borrar la función local `sembrarPartido()` del final (líneas 205–214): la sustituye el helper compartido. El import de `env` se queda: lo usan otros tests del fichero.

Sustituir el test de las líneas 69–84 por:

```ts
  it("suma las cargas de varios partidos en los totales", async () => {
    const equipo = await crearEquipo();
    const jugadorId = equipo.jugadores[0]!.id;
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 10, aces: 2 });
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 5, aces: 1 });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as {
      jugadores: { id: number; estadisticas: Record<string, number> }[];
    };
    const jugador = datos.jugadores.find((j) => j.id === jugadorId)!;

    expect(jugador.estadisticas.puntos).toBe(15);
    expect(jugador.estadisticas.aces).toBe(3);
    expect(jugador.estadisticas.bloqueos).toBe(0);
    expect(jugador.estadisticas.partidosJugados).toBe(2);
  });
```

En el test de la carrera entre ediciones (líneas ~136–143), colgar las dos cifras de sendos partidos:

```ts
    await crearEstadistica(vieja.jugadores[0]!.id, await crearPartido(), { puntos: 7 });
    await crearEstadistica(nueva.jugadores[0]!.id, await crearPartido(), { puntos: 3 });
```

- [ ] **Step 12: Actualizar `test/integration/perfil.test.ts`**

Añadir `crearPartido` al import de `../helpers/db` y cambiar la línea 18:

```ts
    await crearEstadistica(equipo.jugadores[0]!.id, await crearPartido(), { puntos: 9, aces: 2 });
```

- [ ] **Step 13: Ejecutar toda la suite**

Run: `npm test`
Expected: PASS. Si algún test de integración falla con "no such column: partidos_jugados", queda un `crearEstadistica` con la firma vieja sin migrar.

- [ ] **Step 14: Comprobar los tipos**

Run: `npm run test:types`
Expected: sin errores. Cazaría cualquier import superviviente de `validarEstadisticas`, `MAX_METRICA` o `sentenciaCargaManual`.

- [ ] **Step 15: Commit**

```bash
git add db/migrations/0012_estadisticas_por_partido.sql functions/_lib/estadisticas.ts functions/api/admin/estadisticas.ts test/helpers/db.ts test/unit/estadisticas.test.ts test/integration/estadisticas-cerrojo.test.ts test/integration/estadisticas-admin.test.ts test/integration/jugadores-publico.test.ts test/integration/perfil.test.ts
git commit -m "feat: las estadisticas solo pueden colgar de un partido"
```

---

### Task 2: El panel muestra las cifras, no las edita

`/admin/estadisticas/` deja de ofrecer campos de métricas. El diálogo se queda con lo que sí pone la organización a mano: los atributos 1–5 y el interruptor del álbum.

**Files:**
- Modify: `src/pages/admin/estadisticas.astro`
- Modify: `public/assets/admin/estadisticas.js`
- Modify: `src/styles/admin/forms.css`

**Interfaces:**
- Consumes de la Task 1: `GET /api/admin/estadisticas` sigue devolviendo `metricas` (siete, con `partidosJugados` la primera) y `jugadores[].estadisticas` con las siete claves; `PATCH ?jugador=N` acepta `atributos` y `ocultoPublico`, e ignora `estadisticas`.
- Produces: nada que consuman tareas posteriores.

- [ ] **Step 1: Invocar la skill de diseño**

El cambio toca UI del panel. Antes de escribir estilos, invocar `frontend-design:frontend-design`, tal y como exige CLAUDE.md.

- [ ] **Step 2: Cambiar el bloque de cifras en `src/pages/admin/estadisticas.astro`**

Sustituir el `admin-field` de las líneas 36–43 por:

```astro
          <div class="admin-field">
            <span class="admin-label">Estadísticas de la edición</span>
            <p class="admin-field-hint">
              Salen de los partidos jugados. Se cargarán partido a partido.
            </p>
            <dl class="admin-stats-readonly" data-stats-metricas></dl>
          </div>
```

Y actualizar el `lede` del layout (línea 8), que promete que aquí se anotan cifras:

```astro
  lede="Atributos y visibilidad en el álbum público. Las cifras de juego salen de los partidos y aquí sólo se consultan."
```

- [ ] **Step 3: Pintar las cifras en sólo lectura en `public/assets/admin/estadisticas.js`**

Añadir esta función junto a `campoNumero` (que se sigue usando para los atributos). `el(tag, clase, valor)` pone el `textContent` en su tercer argumento, y `CopaAdmin.text` convierte el `0` en `"0"` — no en `"—"`, que es lo que hace con `null`, `undefined` y la cadena vacía; de ahí el `?? 0`:

```js
  function cifraSoloLectura(nombre, valor) {
    return [el("dt", "admin-stat-label", nombre), el("dd", "admin-stat-valor", valor ?? 0)];
  }
```

Dentro de `abrir(jugador)`, sustituir el bloque que rellena `cajaMetricas` (líneas 136–144) por:

```js
    clear(cajaMetricas);
    metricas.forEach((m) => {
      cajaMetricas.append(...cifraSoloLectura(m.etiqueta, jugador.estadisticas?.[m.clave]));
    });
```

El parámetro se llama `nombre` y no `etiqueta` a propósito: `etiqueta` ya está desestructurado de `window.CopaAdmin` al principio del fichero.

En el `click` de `[data-stats-guardar]`, quitar `estadisticas` del cuerpo:

```js
      await apiJson(`/api/admin/estadisticas?jugador=${encodeURIComponent(enEdicion.id)}`, "PATCH", {
        atributos: recoger("atributo"),
        ocultoPublico: Boolean(checkOculto?.checked)
      });
```

Y en el `catch`, quitar el remapeo de las cifras, que ya no puede llegar:

```js
      Object.entries(err.campos || {}).forEach(([clave, mensaje]) => {
        marcarError(clave.replace("atributos.", "atributo."), mensaje);
      });
```

- [ ] **Step 4: Estilar el bloque en `src/styles/admin/forms.css`**

Añadir junto a `.admin-form-grid`:

```css
/* Cifras de sólo lectura del diálogo de estadísticas: salen de los partidos, no
   se editan, y por eso no son campos. */
.admin-stats-readonly {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
  margin: 0;
}

.admin-stat-label {
  color: var(--adm-muted);
  font-size: 0.82rem;
  grid-column: 1;
}

.admin-stat-valor {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  grid-column: 2;
  margin: 0;
  text-align: right;
}

@media (min-width: 901px) {
  .admin-stats-readonly {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .admin-stat-label {
    grid-column: auto;
  }

  .admin-stat-valor {
    grid-column: auto;
    text-align: left;
  }
}
```

`--adm-muted` es el token de texto secundario que ya usan `.admin-label` y `.admin-photo-label` en ese mismo fichero. (`.admin-field-hint` usa `--adm-faint`, más apagado: aquí la etiqueta de la cifra tiene que leerse igual que el número.)

- [ ] **Step 5: Comprobar en el navegador, móvil y escritorio**

```bash
npm run build
npx wrangler dev --port 8788
```

Abrir `/admin/estadisticas/`, entrar como administrador y abrir el diálogo de un jugador. Comprobar que:
- Las siete cifras se ven, ninguna es un `<input>`.
- Los atributos siguen siendo editables y se guardan.
- El interruptor del álbum sigue funcionando.
- A 390 px de ancho las cifras caen a dos columnas sin desbordar; a 1280 px, a cuatro.

Recordatorio de CLAUDE.md: Chrome recorta la ventana a ~500 px de ancho mínimo, así que un "corte" en el borde derecho a tamaño móvil suele ser ese artefacto, no un fallo de maquetación.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/estadisticas.astro public/assets/admin/estadisticas.js src/styles/admin/forms.css
git commit -m "feat: el panel muestra las cifras de juego en solo lectura"
```

---

### Task 3: Documentación y cierre

Deja escrita la regla donde la va a leer quien trabaje después, y pasa la puerta de `npm run verify`.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes de las tareas 1 y 2: el comportamiento ya implementado.
- Produces: nada.

- [ ] **Step 1: Actualizar la sección "Backend" de `CLAUDE.md`**

**`CLAUDE.md` está escrito en inglés**: la regla de copia en español es para el texto de cara al usuario, no para la documentación de desarrollo. El reemplazo va en inglés.

Sustituir entero el bullet que empieza por "**`estadisticas` is one row per load, not per player.**" por:

```markdown
- **`estadisticas` is one row per player per match, and it cannot be anything else.** Since migration 0012 `partido_id` is `NOT NULL`: a figure typed by hand, with no match behind it, is not representable in the database. That is the whole point — the guarantee doesn't depend on any endpoint. Everything read is `SUM(...)` over a player's rows, and `partidosJugados` is **not a column**: it is counted with `COUNT(DISTINCT partido_id)`, so it can't desync from the rows that hold it up. The edición is **not** duplicated in the table: it comes from `jugadores.edicion_id` through the join, so moving someone between teams can't desync it either. Metric names live once, in `_lib/estadisticas.ts`: `METRICAS` is the list that gets displayed (seven, `partidosJugados` flagged `derivada`) and `METRICAS_PARTIDO` the six with a real column. `PATCH /api/admin/estadisticas?jugador=N` **ignores** anything sent under `estadisticas`; it only saves attributes and album visibility. Nothing writes figures yet — the per-match sheet that will is a separate spec.
```

- [ ] **Step 2: Actualizar la sección "Admin panel" de `CLAUDE.md`**

Añadir un bullet tras el primero (el que enumera las páginas del panel), también en inglés:

```markdown
- **`/admin/estadisticas/` does not edit figures.** It shows them summed from the player's matches, read-only, and edits what the organisation really does set by hand: the 1–5 attributes and whether the person appears in the public album.
```

- [ ] **Step 3: Pasar la verificación completa**

Run: `npm run verify`
Expected: build + tipos + los tres proyectos de test en verde. Es la puerta antes de mezclar con `development`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: la regla de estadisticas solo por partido en CLAUDE.md"
```

- [ ] **Step 5: Mezclar en `development`**

```bash
git checkout development
git merge --no-ff feature/estadisticas-solo-por-partido -m "Merge feature/estadisticas-solo-por-partido into development: las estadisticas solo cuelgan de partidos"
git push origin development
```

No tocar `main`: promocionar a producción requiere preguntar antes.

---

## Qué queda fuera

La **fase 2** tendrá su propio spec y su propio plan: la ficha por partido (`GET`/`PUT /api/admin/estadisticas?partido=X`), su diálogo en `/admin/torneo/`, el selector de equipos en el alta de partido, la casilla «Jugó», y la eliminación del sorteo y de «Vaciar cuadro». La captura en vivo punto a punto es posterior a ambas.

Mientras tanto, **todas las cifras del álbum son cero**, y es lo esperado: no hay ninguna vía de carga hasta que exista la ficha.
