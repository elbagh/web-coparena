# Plan de implementación — catálogo de acciones del anotador

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El anotador deja de tener un «error» genérico — todo punto se atribuye a alguien del equipo que lo gana, salvo el saque fallado — y bloqueo y chilena pasan a preguntar si el rally acabó en punto.

**Architecture:** `partido_eventos.lado_punto` (que ya existe, y ya significa «no puntuó» cuando es NULL) pasa a ser lo **único** que dice si una acción sumó. El mapa fijo `PUNTUA: Record<tipo, boolean>` desaparece y el catálogo gana dos ejes: `punto: "siempre" | "pregunta"` y `aRival`. El servidor sigue calculando `lado_punto` y no lo acepta nunca del cliente.

**Tech Stack:** Astro 5 (salida estática), Cloudflare Workers + D1 (SQLite), TypeScript en `functions/`, JS plano sin bundler en `public/assets/`, Vitest (proyectos `unit` / `integration` / `e2e`).

**Spec:** `docs/superpowers/specs/2026-07-30-anotador-acciones-design.md`

**Worktree:** `.worktrees/anotador-acciones`, rama `feature/anotador-acciones`, **slot 1** (`npm run dev -- --port 4331`, `npx wrangler dev --port 8798`).

## Global Constraints

- Todo el texto de cara al usuario va **en español con tildes** («Música», «información»). El deporte se escribe **«volley»**, nunca «vóley».
- Tono de copy: corto y seguro, sin chistes.
- `public/assets/**` es JS plano cargado con `<script is:inline>`: **no puede importar** de `functions/`. Lo que se comparte, se duplica a mano y lo vigila `test/unit/paridad-validacion.test.ts`.
- Nada de `window.confirm`: el panel usa `CopaAdmin.confirmar()`.
- Los estilos del anotador viven en `src/styles/anotador/*` y sus tokens cuelgan de `body.is-anotador`. **Objetivo táctil mínimo 56px**, sin excepciones (lo dice la cabecera de esa hoja).
- La pantalla del anotador ignora `prefers-color-scheme` a propósito.
- **Presupuesto de alto del móvil:** el panel mide 742px + 60 de barra en una pantalla de 844. Ningún paso puede crecer sin devolver el espacio en otro sitio.
- `npm test` (unit + integration, ~10 s) es el comando de cada tarea. `npm run verify` sólo al final — y **nunca en dos worktrees a la vez**.
- Cada commit va con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Estructura de ficheros

| Fichero | Responsabilidad tras el cambio |
|---|---|
| `db/migrations/0028_acciones_anotador.sql` | **nuevo** — reconstruye `partido_eventos` con el CHECK nuevo y `estadisticas` con dos columnas más |
| `functions/_lib/marcador.ts` | el catálogo (`TIPOS`), `ladoDelPunto`, `METRICA_DE_TIPO`, el pliegue puro |
| `functions/_lib/eventos.ts` | validación, escritura del log y el agregado de `estadisticas` |
| `functions/_lib/estadisticas.ts` | `METRICAS`: qué cifras se enseñan y de qué columna salen |
| `functions/api/anotacion.ts` | traduce el cuerpo HTTP a llamadas de `_lib/eventos.ts` |
| `src/pages/anotador/partido.astro` | el marcado de los tres estados de la franja del pulgar |
| `src/styles/anotador/index.css` | los dos grupos de la botonera y el estado del sí/no |
| `public/assets/anotador/partido.js` | los dos o tres toques, la pintada optimista y el diálogo de corregir |
| `public/assets/players-list.js` | copia a mano de `METRICAS` + `RANKING` del álbum |
| `public/assets/admin/estadisticas.js` | `COLUMNAS_TABLA` del panel |
| `public/assets/perfil.js` | línea de resumen en Mi zona |

---

## Decisiones de diseño de la pantalla (cerradas antes de implementar)

Se aplican en las tareas 4 y 5. Están aquí para que quien las implemente no las reinvente.

**La botonera sale más baja que hoy, no más alta.** Nada de rótulos de grupo: dos encabezados costarían ~36px en la pantalla cuyo presupuesto ya está gastado. La separación la llevan los propios botones:

```
Berta · ¿qué hizo?
┌───────────────┐ ┌───────────────┐
│ Punto         │ │ Ace           │   ← 68px, borde sólido
│ Gana el rally │ │ Punto de saque│
└───────────────┘ └───────────────┘
┌───────────────────────────────────┐
│ Falló saque ⇢                     │   ← ancho completo, doble filo
│ El punto es del rival             │
└───────────────────────────────────┘
─────────────────────────────────────  ← filete de 1px
┌───────────────┐ ┌───────────────┐
│ Bloqueo       │ │ Chilena       │   ← 56px, borde discontinuo
│ Bloqueo suyo  │ │ Chilena suya  │
└───────────────┘ └───────────────┘
              [ Cancelar ]
```

Cuentas, a 390px de ancho (dos columnas, `minmax(140px, 1fr)` con 8px de hueco):
`68 + 8 + 68 + 9 + 56 = 209px`, contra `3 filas × 68 + 2 × 8 = 220px` de hoy. **−11px.**

«Falló saque» a ancho completo no es maquetación: es la única acción cuyo punto cruza la red, y el ancho lo dice antes de leerlo. Conserva el doble filo de tinta y la flecha `⇢` que ya tiene hoy `.anot-btn--error`.

**El borde discontinuo significa una sola cosa, en los dos sitios donde aparece: «esto no mueve el marcador».** Hoy lo lleva `.anot-btn--defensa` sin decir nada; ahora lo llevan el grupo que sólo suma estadística y el «No fue punto» del tercer toque. Es el único hilo visual que añade este cambio.

**El tercer toque cabe de sobra y no empuja nada:** una fila de dos botones (68px) más la línea de pregunta, contra los 209 de la botonera a la que sustituye.

```
Bloqueo de Berta
┌───────────────┐ ┌───────────────┐
│ Fue punto     │ │ No fue punto  │
│ Para Ría Viva │ │ El rally siguió│
└───────────────┘ └───────────────┘
              [ Cancelar ]
```

En pasado: quien anota registra lo que pasó, no lo que debería pasar. Ninguno de los dos es `--primario`: un botón sólido a pleno sol y con prisa sesga el toque, y aquí las dos respuestas son igual de legítimas.

---

## Task 1: Migración 0028 y el catálogo del servidor

**Esta tarea es indivisible.** El `CHECK` de la base, el tipo `TipoEvento` y la validación tienen que cambiar a la vez: con cualquier corte intermedio el proyecto no compila o la suite entera se pone roja sin informar de nada.

**Files:**
- Create: `db/migrations/0028_acciones_anotador.sql`
- Modify: `functions/_lib/marcador.ts`
- Modify: `functions/_lib/eventos.ts:72` (`TIPOS_ANOTABLES`), `:81-105` (`validarEvento`), `:287-305` (agregado), `:498-544` (`corregirEvento`), `:15-26` (imports)
- Modify: `test/helpers/db.ts:420-441` (`crearEstadistica`)
- Test: `test/unit/marcador.test.ts`

**Interfaces:**
- Consumes: nada (es la base).
- Produces:
  - `type TipoEvento = "punto" | "ace" | "saque_fallado" | "bloqueo" | "chilena" | "ajuste"`
  - `TIPOS: readonly { clave: TipoEvento; etiqueta: string; ayuda: string; punto: "siempre" | "pregunta"; aRival: boolean }[]` — sin `ajuste`, que no se ofrece
  - `ladoDelPunto(tipo: TipoEvento, ladoJugador: Lado, puntua?: boolean): Lado | null`
  - `estadisticasDeEventos`, `EstadisticasJugador`, `vacias()` y `METRICA_DE_TIPO` **se borran** (ver Step 4)
  - `validarEvento(body, alineacion)` lee además `body.punto: boolean`
  - `corregirEvento(db, partido, orden, cambios: { tipo?, jugadorId?, punto? }, alineacion)`
  - `PUNTUA` **deja de existir** (hoy se re-exporta desde `eventos.ts:891`)

- [ ] **Step 1: Escribir la migración**

Crear `db/migrations/0028_acciones_anotador.sql`:

```sql
-- Migration number: 0028 	 catalogo de acciones del anotador
-- El «error» generico desaparece: todo punto se atribuye a alguien del equipo
-- que lo gana. La unica excepcion es el saque fallado, que se atribuye a quien
-- lo fallo y da el punto al rival — por eso la fila sigue guardando los DOS
-- lados y no uno.
--
-- Bloqueo y chilena pasan a decidir por evento si puntuaron o no, y eso ya lo
-- expresa `lado_punto`: NULL significa «no puntuo». No hace falta columna nueva,
-- y anadirla seria un segundo sitio afirmando el mismo hecho.
--
-- Hay que reconstruir la tabla porque SQLite no sabe alterar un CHECK. El riesgo
-- esta acotado: NINGUNA tabla apunta a `partido_eventos` con clave ajena.
-- `partido_cambios.tras_orden` no lo es a proposito (el punto al que se anclo un
-- cambio se puede deshacer, y el cambio siguio ocurriendo) y
-- `estadisticas.partido_id` cuelga de `partidos`. Lo unico que hay que rehacer
-- son sus dos indices, incluido el UNIQUE que serializa a dos anotadores.
--
-- D1 manda el fichero como una sola consulta multi-sentencia y sin transaccion:
-- si algo falla a mitad, lo anterior queda aplicado y la migracion sin registrar,
-- y el siguiente intento vuelve a correrlo entero. Por eso `estadisticas` se
-- reconstruye en vez de usar ALTER TABLE ADD COLUMN, que no es re-ejecutable:
-- un segundo intento moriria con «duplicate column name».

DROP TABLE IF EXISTS partido_eventos_nueva;
CREATE TABLE partido_eventos_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL,
  set_numero INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('punto', 'ace', 'saque_fallado', 'bloqueo', 'chilena', 'ajuste')),
  lado_jugador TEXT CHECK (lado_jugador IN ('A', 'B')),
  jugador_id INTEGER REFERENCES jugadores(id) ON DELETE CASCADE,
  lado_punto TEXT CHECK (lado_punto IN ('A', 'B')),
  puntos_a INTEGER,
  puntos_b INTEGER,
  sets_a INTEGER,
  sets_b INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El mapeo conserva `lado_punto` tal cual en todos los casos, asi que NINGUN
-- marcador se mueve. Ese es el criterio: para 'defensa' no hay equivalente
-- honesto, asi que se elige el que no altera nada (no puntuaba, y como bloqueo
-- sin punto sigue sin puntuar). El CASE es idempotente: 'punto' cae en el ELSE.
INSERT INTO partido_eventos_nueva (
  id, partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto,
  puntos_a, puntos_b, sets_a, sets_b, usuario_id, created_at
)
SELECT id, partido_id, orden, set_numero,
       CASE tipo
         WHEN 'remate'  THEN 'punto'
         WHEN 'error'   THEN 'saque_fallado'
         WHEN 'defensa' THEN 'bloqueo'
         ELSE tipo
       END,
       lado_jugador, jugador_id, lado_punto,
       puntos_a, puntos_b, sets_a, sets_b, usuario_id, created_at
FROM partido_eventos;

DROP TABLE IF EXISTS partido_eventos;
ALTER TABLE partido_eventos_nueva RENAME TO partido_eventos;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partido_eventos_orden ON partido_eventos (partido_id, orden);
CREATE INDEX IF NOT EXISTS idx_partido_eventos_jugador ON partido_eventos (jugador_id);

-- `estadisticas` gana `chilenas` y `saques_fallados`.
--
-- `remates`, `defensas` y `errores` NO se van aqui: una migracion se aplica
-- ANTES de que despliegue el codigo nuevo, asi que durante esos segundos el
-- codigo viejo sigue insertando esas columnas. Se quedan a 0, dejan de leerse, y
-- caen una release despues — misma pauta que `is_admin` (0022).
DROP TABLE IF EXISTS estadisticas_nueva;
CREATE TABLE estadisticas_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  puntos INTEGER NOT NULL DEFAULT 0,
  remates INTEGER NOT NULL DEFAULT 0,
  bloqueos INTEGER NOT NULL DEFAULT 0,
  chilenas INTEGER NOT NULL DEFAULT 0,
  aces INTEGER NOT NULL DEFAULT 0,
  defensas INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  saques_fallados INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO estadisticas_nueva (
  id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
)
SELECT id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
FROM estadisticas;

DROP TABLE IF EXISTS estadisticas;
ALTER TABLE estadisticas_nueva RENAME TO estadisticas;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estadisticas_partido ON estadisticas (jugador_id, partido_id);
CREATE INDEX IF NOT EXISTS idx_estadisticas_por_partido ON estadisticas (partido_id);
```

- [ ] **Step 2: Reescribir los tests de `marcador.test.ts` que hablan del catálogo**

Sustituir el bloque `describe("ladoDelPunto")` (líneas 42-74) por:

```ts
describe("ladoDelPunto", () => {
  /*
   * El único caso en que el lado de quien hace la acción y el lado que se lleva
   * el punto no coinciden. Es la razón de que la fila guarde los dos lados: con
   * uno solo y el otro deducido, el fallo no se vería hasta el final del torneo.
   */
  it("el saque fallado da el punto al rival", () => {
    expect(ladoDelPunto("saque_fallado", "A")).toBe("B");
    expect(ladoDelPunto("saque_fallado", "B")).toBe("A");
  });

  it("un punto y un ace son de quien los hace", () => {
    for (const tipo of ["punto", "ace"] as TipoEvento[]) {
      expect(ladoDelPunto(tipo, "A")).toBe("A");
      expect(ladoDelPunto(tipo, "B")).toBe("B");
    }
  });

  /*
   * Bloqueo y chilena no las decide el tipo: las decide quien anota, rally a
   * rally. Sin respuesta no hay punto — no se adivina, porque adivinar aquí es
   * inventar marcador.
   */
  it("bloqueo y chilena puntúan sólo si se dice que sí", () => {
    for (const tipo of ["bloqueo", "chilena"] as TipoEvento[]) {
      expect(ladoDelPunto(tipo, "A", true)).toBe("A");
      expect(ladoDelPunto(tipo, "A", false)).toBeNull();
      expect(ladoDelPunto(tipo, "A")).toBeNull();
    }
  });

  it("el ajuste no es un punto", () => {
    expect(ladoDelPunto("ajuste", "A", true)).toBeNull();
  });

  /*
   * El ajuste es un saldo de apertura, no una acción: nadie lo pulsa, así que no
   * puede salir en la botonera. Es el único tipo que existe sin estar en TIPOS.
   */
  it("TIPOS son las cinco acciones que se pueden anotar, y no el ajuste", () => {
    expect(TIPOS.map((t) => t.clave)).toEqual(["punto", "ace", "saque_fallado", "bloqueo", "chilena"]);
  });
});
```

**Borrar entero** el bloque `describe("estadísticas desde el log")` (líneas
217-266), sin sustituirlo por nada.

Se va con la función que probaba. `estadisticasDeEventos` era una segunda
implementación en TS de la sentencia agregada de `eventos.ts`, y **nada de
producción la llamaba**: dos implementaciones de la misma regla son dos sitios
que mantener a la vez, que es justo el argumento por el que este proyecto tiene
un solo camino de recálculo.

La regla queda cubierta donde se comprueba de verdad —contra una D1 real,
después de anotar— por los tests de integración de la Task 2. Cuesta más
(arranca workerd), pero prueba lo que de verdad corre.

Y en la cabecera del fichero, cambiar el import (quitar `PUNTUA`) y los dos ayudantes:

```ts
import {
  TIPOS,
  aplicarPunto,
  ladoDelPunto,
  marcadorInicial,
  plegarEventos,
  type EventoFila,
  type TipoEvento
} from "../../functions/_lib/marcador";
```

```ts
let orden = 0;
const evento = (parcial: Partial<EventoFila>): EventoFila => ({
  orden: (orden += 1),
  tipo: "punto",
  lado_jugador: "A",
  jugador_id: 1,
  lado_punto: "A",
  puntos_a: null,
  puntos_b: null,
  sets_a: null,
  sets_b: null,
  ...parcial
});

/** `veces` puntos seguidos para un lado, ya con el lado_punto resuelto. */
const puntos = (lado: "A" | "B", veces: number, tipo: TipoEvento = "punto"): EventoFila[] =>
  Array.from({ length: veces }, () => evento({ tipo, lado_jugador: lado, lado_punto: lado }));
```

- [ ] **Step 3: Ejecutar los tests para verlos fallar**

Ejecutar: `npm test -- marcador`
Esperado: FAIL — `ladoDelPunto("saque_fallado", ...)` devuelve `null`, porque ese tipo todavía no existe.

- [ ] **Step 4: Reescribir el catálogo en `marcador.ts`**

Sustituir las líneas 18-86 (de `export type TipoEvento` hasta el final de `ladoDelPunto`) por:

```ts
export type TipoEvento = "punto" | "ace" | "saque_fallado" | "bloqueo" | "chilena" | "ajuste";

export interface Accion {
  clave: TipoEvento;
  etiqueta: string;
  ayuda: string;
  /**
   * `"siempre"`: el tipo ya decide si hubo punto.
   * `"pregunta"`: lo decide quien anota, rally a rally.
   */
  punto: "siempre" | "pregunta";
  /** El punto cruza la red: se lo lleva el rival de quien hizo la acción. */
  aRival: boolean;
}

/**
 * Los botones del anotador, y lo que hace falta para predecir el marcador.
 *
 * `ajuste` no está: no es una acción que nadie pulse, es el saldo de apertura al
 * adoptar un partido que venía llevándose a mano.
 *
 * Esta lista viaja entera al cliente (`/api/anotacion`) y recortada al público
 * (`/api/plantilla`, sólo clave y etiqueta). El cliente NO vuelve a escribir la
 * regla de quién se lleva el punto: la lee de aquí. La tenía copiada a mano
 * («todo menos defensa puntúa») y era una copia esperando a quedarse vieja.
 */
export const TIPOS: readonly Accion[] = [
  { clave: "punto", etiqueta: "Punto", ayuda: "Gana el rally", punto: "siempre", aRival: false },
  { clave: "ace", etiqueta: "Ace", ayuda: "Punto directo de saque", punto: "siempre", aRival: false },
  {
    clave: "saque_fallado",
    etiqueta: "Falló saque",
    ayuda: "El punto es del rival",
    punto: "siempre",
    aRival: true
  },
  { clave: "bloqueo", etiqueta: "Bloqueo", ayuda: "Bloqueo suyo", punto: "pregunta", aRival: false },
  { clave: "chilena", etiqueta: "Chilena", ayuda: "Chilena suya", punto: "pregunta", aRival: false }
];

/** El catálogo indexado. `ajuste` no está: no se ofrece y no se valida contra él. */
export const ACCION_POR_CLAVE: ReadonlyMap<TipoEvento, Accion> = new Map(
  TIPOS.map((accion) => [accion.clave, accion])
);

/**
 * Quién se lleva el punto, o nadie.
 *
 * Con `bloqueo` y `chilena` no lo dice el tipo sino el propio evento, y por eso
 * hace falta `puntua`: un bloqueo puede cerrar el rally o sólo levantar la
 * pelota. Sin respuesta se devuelve `null` — no se adivina, porque adivinar aquí
 * es inventar marcador.
 *
 * Lo llama el servidor y **nunca el cliente**: invertirlo es trivial y el daño
 * (marcador y estadísticas cruzados) no se vería hasta el final del torneo.
 */
export function ladoDelPunto(tipo: TipoEvento, ladoJugador: Lado, puntua?: boolean): Lado | null {
  const accion = ACCION_POR_CLAVE.get(tipo);
  if (!accion) return null;
  if (accion.punto === "pregunta" && puntua !== true) return null;
  return accion.aRival ? (ladoJugador === "A" ? "B" : "A") : ladoJugador;
}
```

**Borrar por completo**, sin sustituto:

- `PUNTUA` (líneas 20-34) y `ETIQUETAS` (36-42), que el catálogo nuevo reemplaza.
- `EstadisticasJugador`, `vacias()` y `estadisticasDeEventos` (líneas 203-246).

- `METRICA_DE_TIPO` (líneas 65-73), que arrastra la anterior.

El borrado de `estadisticasDeEventos` es una decisión, no una limpieza de paso:
era una segunda implementación en TS de la sentencia agregada de `eventos.ts` y
**nada de producción la llamaba**. Mantener dos veces la misma regla es lo que
este proyecto evita a propósito en todo lo demás («un solo camino de
recálculo»), y no hay razón para hacer una excepción con la que sólo veían los
tests.

`METRICA_DE_TIPO` cae con ella por el mismo argumento, no por descuido: su único
consumidor en `functions/` era la línea 236 de esa función, así que conservarla
dejaría una tabla que sólo leen los tests y que repite —en TypeScript— el mapeo
tipo→columna que la sentencia SQL ya escribe. Sería reintroducir el problema con
otro nombre.

Quien añada un tipo nuevo se entera de que necesita columna por donde
corresponde: el `CHECK` de la migración, la sentencia agregada y los tests de
integración que leen `estadisticas` de una D1 real.

- [ ] **Step 5: Adaptar `eventos.ts`**

En los imports (líneas 15-26), quitar `PUNTUA` y `estadisticasDeEventos` (las dos dejan de existir tras el Step 4; la segunda además se importaba sin llamarse nunca) y añadir `ACCION_POR_CLAVE`. Y borrar el `export { PUNTUA };` del final del fichero (línea 891).

Sustituir `TIPOS_ANOTABLES` (línea 72) y `validarEvento` (81-105) por:

```ts
/**
 * Valida lo que manda el cliente. Del cuerpo sólo se leen `tipo`, `jugadorId` y
 * —con los tipos que preguntan— `punto`: el lado del jugador sale de la
 * alineación y el lado del punto lo calcula el servidor.
 *
 * Aceptar cualquiera de los dos lados del cliente sería regalar la posibilidad
 * de invertir el marcador, y el daño no se vería hasta el final del torneo.
 */
export function validarEvento(
  body: Record<string, unknown>,
  alineacion: readonly AlineacionFila[]
): { evento: EventoNuevo } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};

  const tipo = String(body.tipo || "") as TipoEvento;
  const accion = ACCION_POR_CLAVE.get(tipo);
  if (!accion) campos.tipo = "Esa acción no existe.";

  const jugadorId = Number(body.jugadorId);
  const enPista = alineacion.find((fila) => fila.jugador_id === jugadorId);
  if (!Number.isInteger(jugadorId) || jugadorId <= 0) campos.jugadorId = "Elige a quien hizo la acción.";
  else if (!enPista) campos.jugadorId = "Esa persona no está en la alineación de este partido.";

  /*
   * Con bloqueo y chilena, si el rally acabó en punto lo decide quien anota. No
   * hay valor por defecto a propósito: caer del lado de «sí» inventaría puntos y
   * caer del lado de «no» los perdería, y las dos cosas en silencio.
   */
  let puntua: boolean | undefined;
  if (accion?.punto === "pregunta") {
    if (typeof body.punto !== "boolean") campos.punto = "Dinos si ganó el punto.";
    else puntua = body.punto;
  }

  if (Object.keys(campos).length > 0) return { campos };

  return {
    evento: {
      tipo,
      jugadorId,
      ladoJugador: enPista!.lado,
      ladoPunto: ladoDelPunto(tipo, enPista!.lado, puntua)
    }
  };
}
```

En `sentenciasDerivadas`, sustituir la segunda sentencia (líneas 281-305) por:

```ts
    /*
     * Las estadísticas sí son un agregado puro, así que caben en una sentencia
     * sea cual sea el número de jugadores. `puntos` cuenta las acciones que
     * ganaron el punto para el propio equipo, y quien lo dice es `lado_punto`:
     * el saque fallado apunta al rival y por eso no suma puntos a nadie, y el
     * mismo bloqueo suma punto o no según el evento.
     *
     * Es la ÚNICA implementación de este reparto. Había un espejo en TS
     * (`estadisticasDeEventos`) que sólo veían los tests; se borró para que no
     * hubiera dos versiones de la misma regla esperando a discrepar. Lo que
     * prueba esta sentencia son los tests de integración, leyendo la tabla de
     * una D1 real después de anotar.
     */
    db
      .prepare(
        `INSERT INTO estadisticas (jugador_id, partido_id, puntos, bloqueos, chilenas, aces, saques_fallados)
         SELECT jugador_id, partido_id,
                SUM(CASE WHEN lado_punto = lado_jugador THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'bloqueo' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'chilena' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'ace' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'saque_fallado' THEN 1 ELSE 0 END)
           FROM partido_eventos
          WHERE partido_id = ?1 AND jugador_id IS NOT NULL AND tipo <> 'ajuste'
          GROUP BY jugador_id, partido_id
         ON CONFLICT(jugador_id, partido_id) DO UPDATE SET
           puntos = excluded.puntos, bloqueos = excluded.bloqueos, chilenas = excluded.chilenas,
           aces = excluded.aces, saques_fallados = excluded.saques_fallados,
           updated_at = datetime('now')`
      )
      .bind(partido.id),
```

En `corregirEvento` (498-544), cambiar la firma y el bloque de validación:

```ts
export async function corregirEvento(
  db: D1Database,
  partido: PartidoAnotable,
  orden: number,
  cambios: { tipo?: TipoEvento; jugadorId?: number; punto?: boolean },
  alineacion: readonly AlineacionFila[]
): Promise<ResultadoAnotacion> {
```

y, dentro, sustituir el bloque que va de `const tipo = ...` a `const corregido: EventoFila = {...}` por:

```ts
  const tipo = cambios.tipo ?? actual.tipo;
  const jugadorId = cambios.jugadorId ?? actual.jugador_id!;
  const lado = ladosDelPartido(eventos, alineacion).get(jugadorId);
  if (!ACCION_POR_CLAVE.has(tipo) || !lado) {
    throw new ErrorDeAnotacion("Revisa la acción y a quién se le atribuye.");
  }

  /*
   * Si no se dice nada, se conserva lo que la fila ya afirmaba: corregir sólo a
   * quién se atribuye un bloqueo no puede mover el marcador de propina.
   */
  const puntua = cambios.punto ?? actual.lado_punto !== null;

  const corregido: EventoFila = {
    ...actual,
    tipo,
    jugador_id: jugadorId,
    lado_jugador: lado,
    lado_punto: ladoDelPunto(tipo, lado, puntua)
  };
```

- [ ] **Step 6: Actualizar el helper de tests**

En `test/helpers/db.ts`, sustituir el cuerpo de `crearEstadistica` (líneas 425-441) por:

```ts
  await env.DB.prepare(
    `INSERT INTO estadisticas (
       jugador_id, partido_id, puntos, bloqueos, chilenas, aces, saques_fallados
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(
      jugadorId,
      partidoId,
      valores.puntos ?? 0,
      valores.bloqueos ?? 0,
      valores.chilenas ?? 0,
      valores.aces ?? 0,
      valores.saquesFallados ?? 0
    )
    .run();
```

- [ ] **Step 7: Ejecutar los tests unitarios**

Ejecutar: `npm test -- marcador`
Esperado: PASS.

- [ ] **Step 8: Ejecutar la suite entera y arreglar lo que caiga**

Ejecutar: `npm test`
Esperado: fallan los ficheros que siembran `remate` / `defensa` / `error` — al menos `test/integration/anotacion.test.ts`, `anotacion-estres.test.ts`, `cambios-estres.test.ts`, `directo.test.ts`, `plantilla.test.ts`, `jugadores-publico.test.ts`, `perfil.test.ts`, `estadisticas-admin.test.ts`, `estadisticas-solo-lectura.test.ts`, `progresion.test.ts`.

**Estos tests hay que releerlos, no renombrarlos a ciegas.** El criterio, caso por caso:
- `remate` → `punto`: renombrado limpio, mismo significado.
- `error` → `saque_fallado`: sigue dando el punto al rival, así que las aserciones de marcador valen tal cual.
- `defensa` → `bloqueo` con `punto: false`: sigue sin puntuar, pero ahora suma a `bloqueos` en vez de a `defensas`. **Toda aserción sobre `defensas` hay que reescribirla, no traducirla.**
- Cualquier test que afirme algo sobre el error genérico de un jugador del equipo rival ya no describe nada real: se borra o se reescribe como saque fallado.

Un test que haya que **debilitar** para que pase es un hallazgo: pararse y decirlo, no bajarle la exigencia.

- [ ] **Step 9: Volver a ejecutar la suite**

Ejecutar: `npm test`
Esperado: PASS.

- [ ] **Step 10: Commit**

```bash
git add db/migrations/0028_acciones_anotador.sql functions/_lib/marcador.ts functions/_lib/eventos.ts \
        test/helpers/db.ts test/unit/marcador.test.ts test/integration/
git commit -m "$(cat <<'EOF'
feat(anotador): el catálogo de acciones nuevo, y lado_punto como única verdad

Fuera el «error» genérico: todo punto se atribuye a alguien del equipo que
lo gana, salvo el saque fallado. Bloqueo y chilena preguntan si el rally
acabó en punto en vez de darlo por hecho, y la defensa desaparece.

PUNTUA (mapa fijo por tipo) no sabía expresar «el mismo bloqueo puntúa o
no según el evento», y esa frase ya la sabía decir `lado_punto`. Así que
manda esa columna y el catálogo sólo dice si hay que preguntar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: El endpoint pasa el sí/no al corregir

**Files:**
- Modify: `functions/api/anotacion.ts:356-374` (`accionCorregir`)
- Test: `test/integration/anotacion.test.ts`

**Interfaces:**
- Consumes: `corregirEvento(db, partido, orden, { tipo?, jugadorId?, punto? }, alineacion)` y `validarEvento` de la Task 1.
- Produces: `POST /api/anotacion?partido=ID` acepta `punto: boolean` tanto en `accion: "evento"` como en `accion: "corregir"`.

> `accionEvento` **no se toca**: le pasa el `body` entero a `validarEvento`, que ya lee `punto` desde la Task 1.

- [ ] **Step 1: Escribir los tests de integración**

Añadir a `test/integration/anotacion.test.ts` (adaptando los helpers de siembra que ya use el fichero — `crearPartido`, `crearEquipo`, `crearUsuarioConPermisos`, `peticion`, `ctx`):

```ts
describe("bloqueo y chilena: el punto lo decide quien anota", () => {
  it("sin decir si ganó el punto, no se anota", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();

    const res = await onRequestPost(
      ctx(peticion(`/api/anotacion?partido=${partido}`, { method: "POST", cookie, body: {
        accion: "evento", tipo: "bloqueo", jugadorId: jugadorA, ordenEsperado: 0
      } }), env)
    );

    expect(res.status).toBe(400);
    const cuerpo = await res.json();
    expect(cuerpo.campos).toHaveProperty("punto");
  });

  it("un bloqueo sin punto no mueve el marcador, pero cuenta en la ficha", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();

    const res = await anotar(partido, { tipo: "bloqueo", jugadorId: jugadorA, ordenEsperado: 0, punto: false });
    expect(res.status).toBe(201);

    const cuerpo = await res.json();
    expect(cuerpo.estado.puntos).toEqual({ A: 0, B: 0 });

    const ficha = await env.DB.prepare(
      "SELECT puntos, bloqueos FROM estadisticas WHERE jugador_id = ?1"
    ).bind(jugadorA).first();
    expect(ficha).toMatchObject({ puntos: 0, bloqueos: 1 });
  });

  it("un bloqueo con punto suma las dos cosas", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();
    await anotar(partido, { tipo: "bloqueo", jugadorId: jugadorA, ordenEsperado: 0, punto: true });

    const ficha = await env.DB.prepare(
      "SELECT puntos, bloqueos FROM estadisticas WHERE jugador_id = ?1"
    ).bind(jugadorA).first();
    expect(ficha).toMatchObject({ puntos: 1, bloqueos: 1 });
  });

  /*
   * La chilena va por su columna, no por la del bloqueo: comparten el gesto de
   * la pregunta, no la métrica.
   */
  it("la chilena tiene columna propia", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();
    await anotar(partido, { tipo: "chilena", jugadorId: jugadorA, ordenEsperado: 0, punto: true });

    const ficha = await env.DB.prepare(
      "SELECT puntos, chilenas, bloqueos FROM estadisticas WHERE jugador_id = ?1"
    ).bind(jugadorA).first();
    expect(ficha).toMatchObject({ puntos: 1, chilenas: 1, bloqueos: 0 });
  });

  /*
   * Esta sentencia agregada es la única implementación del reparto desde que se
   * borró su espejo en TS, así que un tipo que no llegue a su columna sólo se
   * ve aquí: cada acción con su cifra, en una sola pasada.
   */
  it("cada acción llega a su columna", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();
    await anotar(partido, { tipo: "punto", jugadorId: jugadorA, ordenEsperado: 0 });
    await anotar(partido, { tipo: "ace", jugadorId: jugadorA, ordenEsperado: 1 });
    await anotar(partido, { tipo: "bloqueo", jugadorId: jugadorA, ordenEsperado: 2, punto: true });
    await anotar(partido, { tipo: "chilena", jugadorId: jugadorA, ordenEsperado: 3, punto: false });
    await anotar(partido, { tipo: "saque_fallado", jugadorId: jugadorA, ordenEsperado: 4 });

    const ficha = await env.DB.prepare(
      `SELECT puntos, bloqueos, chilenas, aces, saques_fallados
         FROM estadisticas WHERE jugador_id = ?1`
    ).bind(jugadorA).first();

    // Tres puntos: el punto, el ace y el bloqueo que ganó. Ni la chilena que no
    // ganó ni el saque fallado, que se lo lleva el rival.
    expect(ficha).toEqual({
      puntos: 3,
      bloqueos: 1,
      chilenas: 1,
      aces: 1,
      saques_fallados: 1
    });
  });
});

describe("saque fallado", () => {
  it("da el punto al rival y no suma puntos a quien lo falla", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();

    const res = await anotar(partido, { tipo: "saque_fallado", jugadorId: jugadorA, ordenEsperado: 0 });
    const cuerpo = await res.json();
    expect(cuerpo.estado.puntos).toEqual({ A: 0, B: 1 });

    const ficha = await env.DB.prepare(
      "SELECT puntos, saques_fallados FROM estadisticas WHERE jugador_id = ?1"
    ).bind(jugadorA).first();
    expect(ficha).toMatchObject({ puntos: 0, saques_fallados: 1 });
  });
});

describe("corregir un bloqueo", () => {
  it("de «no fue punto» a «sí» mueve el marcador", async () => {
    const { partido, jugadorA } = await partidoConAlineacion();
    await anotar(partido, { tipo: "bloqueo", jugadorId: jugadorA, ordenEsperado: 0, punto: false });

    const res = await onRequestPost(
      ctx(peticion(`/api/anotacion?partido=${partido}`, { method: "POST", cookie, body: {
        accion: "corregir", orden: 0, punto: true
      } }), env)
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.estado.puntos).toEqual({ A: 1, B: 0 });
  });

  /*
   * Corregir a quién se atribuye no puede mover el marcador de propina: sin
   * `punto` en el cuerpo, la fila conserva lo que ya afirmaba.
   */
  it("cambiar sólo el autor conserva si puntuaba o no", async () => {
    const { partido, jugadorA, otroA } = await partidoConAlineacion();
    await anotar(partido, { tipo: "bloqueo", jugadorId: jugadorA, ordenEsperado: 0, punto: false });

    const res = await onRequestPost(
      ctx(peticion(`/api/anotacion?partido=${partido}`, { method: "POST", cookie, body: {
        accion: "corregir", orden: 0, jugadorId: otroA
      } }), env)
    );

    const cuerpo = await res.json();
    expect(cuerpo.estado.puntos).toEqual({ A: 0, B: 0 });
  });
});
```

- [ ] **Step 2: Ejecutar para verlos fallar**

Ejecutar: `npm test -- anotacion`
Esperado: fallan los dos de «corregir un bloqueo» — el endpoint todavía no lee `body.punto` al corregir, así que el primero deja el marcador en 0–0.

- [ ] **Step 3: Leer `punto` en `accionCorregir`**

En `functions/api/anotacion.ts`, dentro de `accionCorregir`, sustituir el bloque de `cambios`:

```ts
  const alineacion = await leerAlineacion(db, partido.id);
  const cambios: { tipo?: TipoEvento; jugadorId?: number; punto?: boolean } = {};
  if (body.tipo !== undefined) cambios.tipo = String(body.tipo) as TipoEvento;
  if (body.jugadorId !== undefined) cambios.jugadorId = Number(body.jugadorId);
  // Sólo si viene un booleano de verdad: ausente significa «no lo toques», y
  // `Boolean(undefined)` lo convertiría en «no fue punto» sin que nadie lo pida.
  if (typeof body.punto === "boolean") cambios.punto = body.punto;
```

- [ ] **Step 4: Ejecutar los tests**

Ejecutar: `npm test -- anotacion`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/anotacion.ts test/integration/anotacion.test.ts
git commit -m "$(cat <<'EOF'
feat(anotador): corregir un bloqueo puede cambiar si fue punto

Sin esto, un bloqueo anotado como «no fue punto» sólo se arreglaba
deshaciendo todo lo posterior. `punto` ausente conserva lo que la fila ya
decía: corregir a quién se atribuye no mueve el marcador de propina.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Las métricas de la ficha y del panel

**Files:**
- Modify: `functions/_lib/estadisticas.ts:22-30` (`METRICAS`)
- Modify: `public/assets/players-list.js:32-45` (`METRICAS`, `RANKING`)
- Modify: `public/assets/admin/estadisticas.js:40` (`COLUMNAS_TABLA`)
- Modify: `public/assets/perfil.js:156-167` (`resumenEstadisticas`)
- Test: `test/unit/paridad-validacion.test.ts` (ya existe; comprueba solo)

**Interfaces:**
- Consumes: las columnas `chilenas` y `saques_fallados` de la Task 1.
- Produces: claves de API `partidosJugados`, `puntos`, `bloqueos`, `chilenas`, `aces`, `saquesFallados`.

- [ ] **Step 1: Ejecutar el test de paridad para verlo fallar**

Primero cambiar sólo el servidor. En `functions/_lib/estadisticas.ts`, sustituir `METRICAS`:

```ts
export const METRICAS: Metrica[] = [
  { clave: "partidosJugados", columna: "partidos_jugados", etiqueta: "Partidos", derivada: true },
  { clave: "puntos", columna: "puntos", etiqueta: "Puntos" },
  { clave: "bloqueos", columna: "bloqueos", etiqueta: "Bloqueos" },
  { clave: "chilenas", columna: "chilenas", etiqueta: "Chilenas" },
  { clave: "aces", columna: "aces", etiqueta: "Aces" },
  { clave: "saquesFallados", columna: "saques_fallados", etiqueta: "Saques fallados" }
];
```

Y en el comentario de cabecera del fichero, cambiar «(siete, `partidosJugados` flagged `derivada`)» si lo menciona.

Ejecutar: `npm test -- paridad`
Esperado: FAIL — `players-list.js` todavía declara `remates` y `defensas`.

- [ ] **Step 2: Actualizar la copia del cliente**

En `public/assets/players-list.js`, sustituir las líneas 32-45:

```js
  // Debe coincidir con METRICAS en functions/_lib/estadisticas.ts.
  const METRICAS = [
    { clave: "partidosJugados", etiqueta: "Partidos" },
    { clave: "puntos", etiqueta: "Puntos" },
    { clave: "bloqueos", etiqueta: "Bloqueos" },
    { clave: "chilenas", etiqueta: "Chilenas" },
    { clave: "aces", etiqueta: "Aces" },
    { clave: "saquesFallados", etiqueta: "Saques fallados" }
  ];

  // Lo que se corona en el ranking. Ni partidos (no es mérito) ni los saques
  // fallados (coronar al que más falla no es un ranking, es una broma).
  const RANKING = ["puntos", "bloqueos", "chilenas", "aces"];
```

- [ ] **Step 3: Ejecutar el test de paridad**

Ejecutar: `npm test -- paridad`
Esperado: PASS.

- [ ] **Step 4: Actualizar el panel y Mi zona**

En `public/assets/admin/estadisticas.js`, línea 40:

```js
  // Columnas destacadas en la tabla; el resto de cifras se ve en el diálogo.
  const COLUMNAS_TABLA = ["puntos", "bloqueos", "chilenas", "aces"];
```

En `public/assets/perfil.js`, dentro de `resumenEstadisticas`:

```js
    const partes = [
      [stats.puntos, "puntos"],
      [stats.bloqueos, "bloqueos"],
      [stats.chilenas, "chilenas"],
      [stats.aces, "aces"]
    ]
```

- [ ] **Step 5: Ejecutar la suite**

Ejecutar: `npm test`
Esperado: PASS. Si algún test de `estadisticas-admin` o `jugadores-publico` afirma sobre `remates`/`defensas`, reescribirlo con las métricas nuevas.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/estadisticas.ts public/assets/players-list.js \
        public/assets/admin/estadisticas.js public/assets/perfil.js test/
git commit -m "$(cat <<'EOF'
feat(album): las métricas siguen al catálogo nuevo

Puntos, Bloqueos, Chilenas, Aces y Saques fallados. Se va «Remates» —lo
absorbe «Puntos» desde que el botón se llama así— y se va «Defensas», que
ya no se anota. El ranking no corona los saques fallados.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: La botonera del anotador, en dos grupos

**Files:**
- Modify: `src/pages/anotador/partido.astro:89-93` (bloque `[data-anot-acciones]`)
- Modify: `src/styles/anotador/index.css:515-560` (`.anot-tipos`, `.anot-btn--error`, `.anot-btn--defensa`)
- Modify: `public/assets/anotador/partido.js:271-291` (`elegir`)
- Test: `test/unit/anotador-partido.test.ts`

**Interfaces:**
- Consumes: `datos.tipos` con `{ clave, etiqueta, ayuda, punto, aRival }` (Task 1).
- Produces: contenedores `[data-anot-tipos]` (los que suman punto) y `[data-anot-tipos-extra]` (los que sólo cuentan).

- [ ] **Step 1: Escribir el test**

En `test/unit/anotador-partido.test.ts`, añadir al `MARCADO` el contenedor nuevo — justo debajo de `<div data-anot-tipos></div>`:

```html
        <div data-anot-tipos-extra></div>
```

Y añadir un test (siguiendo el estilo de los que ya hay en el fichero, que montan el script con `ejecutarScriptPublico` y una respuesta falsa de la API):

```ts
it("separa las acciones que suman punto de las que sólo cuentan", async () => {
  await montarPartido();
  document.querySelector("[data-anot-mitad-a] button").click();

  const suman = [...document.querySelectorAll("[data-anot-tipos] button")].map(
    (b) => b.querySelector(".anot-tipo-nombre").textContent
  );
  const cuentan = [...document.querySelectorAll("[data-anot-tipos-extra] button")].map(
    (b) => b.querySelector(".anot-tipo-nombre").textContent
  );

  expect(suman).toEqual(["Punto", "Ace", "Falló saque"]);
  expect(cuentan).toEqual(["Bloqueo", "Chilena"]);
});
```

- [ ] **Step 2: Ejecutar para verlo fallar**

Ejecutar: `npm test -- anotador-partido`
Esperado: FAIL — `[data-anot-tipos-extra]` sale vacío; los cinco botones están en `[data-anot-tipos]`.

- [ ] **Step 3: Partir el marcado**

En `src/pages/anotador/partido.astro`, sustituir el bloque `[data-anot-acciones]`:

```astro
      <div class="anot-acciones" data-anot-acciones hidden>
        <p class="anot-pregunta"><strong data-anot-elegido></strong> · ¿qué hizo?</p>
        {/*
          Dos grupos y ningún rótulo. Dos encabezados costarían ~36px en la
          pantalla cuyo presupuesto de alto ya está gastado; la separación la
          llevan los propios botones — el filete, el borde discontinuo del
          segundo grupo y el ancho completo de «Falló saque», que es la única
          acción cuyo punto cruza la red.
        */}
        <div class="anot-tipos" data-anot-tipos></div>
        <div class="anot-tipos anot-tipos--extra" data-anot-tipos-extra></div>
        <button type="button" class="anot-btn anot-btn--cancelar" data-anot-cancelar>Cancelar</button>
      </div>
```

- [ ] **Step 4: Repartir los botones en `elegir`**

En `public/assets/anotador/partido.js`, sustituir el cuerpo de `elegir` a partir de `const caja = $("[data-anot-tipos]");`:

```js
    /*
     * Quién va en cada grupo lo dice el servidor (`punto: "pregunta"`), no una
     * lista escrita aquí: es la misma razón por la que la predicción lee
     * `aRival` en vez de repetir la regla.
     */
    const cajas = {
      siempre: $("[data-anot-tipos]"),
      pregunta: $("[data-anot-tipos-extra]")
    };
    cajas.siempre.textContent = "";
    cajas.pregunta.textContent = "";

    datos.tipos.forEach((tipo) => {
      const boton = el("button", `anot-btn anot-btn--tipo anot-btn--${tipo.clave}`);
      boton.type = "button";
      boton.append(el("span", "anot-tipo-nombre", tipo.etiqueta));
      boton.append(el("span", "anot-tipo-ayuda", tipo.ayuda));
      boton.addEventListener("click", () => elegirAccion(tipo));
      cajas[tipo.punto].append(boton);
    });
```

Y añadir, de momento, un `elegirAccion` que sólo reenvía (la pregunta llega en la Task 5):

```js
  /** Segundo toque. Los tipos que preguntan abren el tercero; el resto anotan. */
  function elegirAccion(tipo) {
    anotarPunto(tipo.clave);
  }
```

- [ ] **Step 5: Los estilos de los dos grupos**

En `src/styles/anotador/index.css`, sustituir el bloque que va de `.anot-btn--error` a `.anot-btn--defensa` (líneas ~541-560) por:

```css
/*
 * El saque fallado es el único que cambia de dueño el punto, así que ocupa la
 * fila entera: el ancho lo dice antes de leer la etiqueta. Ya no en rojo —desde
 * que los equipos son azul y rojo de equipación, un botón rojo se lee como «el
 * botón del equipo rojo», que es lo contrario de lo que hace—. Lo distinguen el
 * doble filo de tinta y la flecha, que dice lo único que importa: el punto cruza
 * la red.
 */
.anot-btn--saque_fallado {
  border-color: var(--anot-tinta);
  box-shadow: inset 0 0 0 3px var(--anot-superficie), inset 0 0 0 6px var(--anot-tinta);
  grid-column: 1 / -1;
}

.anot-btn--saque_fallado .anot-tipo-nombre::after {
  content: " ⇢";
  font-weight: 900;
}

/*
 * El borde discontinuo significa una sola cosa, y aparece en dos sitios: aquí y
 * en «No fue punto» del tercer toque. En los dos quiere decir «esto no mueve el
 * marcador».
 *
 * El grupo va más bajo que el de arriba (56 contra 68) para que se lea como
 * secundario sin necesidad de un rótulo, que costaría el doble de alto. 56 es el
 * suelo táctil de esta hoja y no se baja de ahí.
 */
.anot-tipos--extra {
  border-top: 1px solid var(--anot-linea);
  margin-top: 8px;
  padding-top: 8px;
}

.anot-tipos--extra .anot-btn--tipo {
  border-style: dashed;
  min-height: 56px;
}
```

- [ ] **Step 6: Ejecutar los tests**

Ejecutar: `npm test -- anotador-partido`
Esperado: PASS.

- [ ] **Step 7: Comprobar el alto en un móvil de verdad**

```bash
npm run build && npx wrangler dev --port 8798
```

Abrir `/anotador/partido/?id=<uno de prueba>` a 390×844 y medir `.anot-panel`. Debe salir **igual o por debajo de 742px**. Recordatorio de la casa: Chrome fija la ventana en ~500px de ancho mínimo, así que un «recorte» por la derecha a tamaño móvil suele ser ese artefacto y no un fallo de maqueta.

- [ ] **Step 8: Commit**

```bash
git add src/pages/anotador/partido.astro src/styles/anotador/index.css \
        public/assets/anotador/partido.js test/unit/anotador-partido.test.ts
git commit -m "$(cat <<'EOF'
feat(anotador): la botonera separa lo que suma punto de lo que sólo cuenta

Sin rótulos de grupo: costarían ~36px en la pantalla cuyo presupuesto de
alto ya estaba gastado. Lo dicen el filete, el borde discontinuo y el
ancho completo de «Falló saque», que es la única acción cuyo punto cruza
la red. Sale 11px más baja que la de cinco botones de antes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: El tercer toque

**Files:**
- Modify: `src/pages/anotador/partido.astro` (bloque nuevo `[data-anot-punto]` dentro de `.anot-pulgar`)
- Modify: `src/styles/anotador/index.css`
- Modify: `public/assets/anotador/partido.js` (`elegirAccion`, `predecir`, `anotarPunto`, `cancelar`)
- Test: `test/unit/anotador-partido.test.ts`

**Interfaces:**
- Consumes: `[data-anot-tipos-extra]` y `elegirAccion(tipo)` de la Task 4.
- Produces: `anotarPunto(clave, punto)` donde `punto` es `true`, `false` o `undefined`.

- [ ] **Step 1: Escribir el test**

Añadir al `MARCADO` del test, dentro de `[data-anot-pulgar]`:

```html
      <div data-anot-punto hidden>
        <p><strong data-anot-punto-accion></strong></p>
        <div data-anot-punto-opciones></div>
        <button type="button" data-anot-punto-cancelar>Cancelar</button>
      </div>
```

Y el test:

```ts
it("un bloqueo pregunta si fue punto antes de anotar", async () => {
  await montarPartido();
  document.querySelector("[data-anot-mitad-a] button").click();

  // El bloqueo vive en el grupo de los que sólo cuentan.
  const bloqueo = document.querySelector("[data-anot-tipos-extra] button");
  bloqueo.click();

  expect(document.querySelector("[data-anot-punto]").hidden).toBe(false);
  expect(document.querySelector("[data-anot-acciones]").hidden).toBe(true);
  expect(fetch).not.toHaveBeenCalledWith(
    expect.stringContaining("/api/anotacion"),
    expect.objectContaining({ method: "POST" })
  );

  const opciones = [...document.querySelectorAll("[data-anot-punto-opciones] button")];
  expect(opciones).toHaveLength(2);

  opciones[1].click(); // «No fue punto»
  await esperarPeticiones();

  const cuerpo = JSON.parse(fetch.mock.calls.at(-1)[1].body);
  expect(cuerpo).toMatchObject({ accion: "evento", tipo: "bloqueo", punto: false });
});

it("un punto no pregunta nada", async () => {
  await montarPartido();
  document.querySelector("[data-anot-mitad-a] button").click();
  document.querySelector("[data-anot-tipos] button").click();
  await esperarPeticiones();

  const cuerpo = JSON.parse(fetch.mock.calls.at(-1)[1].body);
  expect(cuerpo).toMatchObject({ accion: "evento", tipo: "punto" });
  expect(cuerpo).not.toHaveProperty("punto");
});
```

- [ ] **Step 2: Ejecutar para verlo fallar**

Ejecutar: `npm test -- anotador-partido`
Esperado: FAIL — el bloqueo se anota directamente y `[data-anot-punto]` no existe en el DOM real.

- [ ] **Step 3: El marcado del tercer estado**

En `src/pages/anotador/partido.astro`, añadir después del bloque `[data-anot-cambio]` y antes del aviso:

```astro
      {/*
        El cuarto estado de la franja, y ocupa el mismo hueco que los otros tres.
        Bloqueo y chilena no dicen por sí solos si el rally acabó en punto, así
        que se pregunta — con la misma gramática que «¿por quién entra?»: el
        toque cae donde ya está el pulgar.

        En pasado: aquí se registra lo que pasó, no lo que debería pasar.
      */}
      <div class="anot-punto" data-anot-punto hidden>
        <p class="anot-pregunta"><strong data-anot-punto-accion></strong></p>
        <div class="anot-tipos" data-anot-punto-opciones></div>
        <button type="button" class="anot-btn anot-btn--cancelar" data-anot-punto-cancelar>Cancelar</button>
      </div>
```

- [ ] **Step 4: El estilo**

En `src/styles/anotador/index.css`, junto al bloque de `.anot-tipos--extra`:

```css
/*
 * «No fue punto» lleva el mismo borde discontinuo que el grupo del que sale, y
 * por la misma razón: no mueve el marcador. Ninguno de los dos es `--primario`
 * — un botón sólido a pleno sol y con prisa sesga el toque, y aquí las dos
 * respuestas son igual de legítimas.
 */
.anot-punto .anot-btn--no {
  border-style: dashed;
}
```

- [ ] **Step 5: La lógica**

En `public/assets/anotador/partido.js`:

Añadir junto a las demás variables de estado (cerca de `let entrante = null;`):

```js
  /** La acción tocada que espera respuesta a «¿fue punto?». */
  let preguntando = null;
```

Sustituir el `elegirAccion` provisional de la Task 4 por:

```js
  /**
   * Segundo toque. Los tipos que preguntan abren el tercero; el resto anotan.
   *
   * Quién pregunta lo dice el servidor (`punto: "pregunta"`), no una lista
   * escrita aquí: con la regla copiada a mano, añadir un tipo la dejaría
   * mintiendo — que es exactamente lo que ya pasó con «todo menos defensa
   * puntúa».
   */
  function elegirAccion(tipo) {
    if (tipo.punto !== "pregunta") return anotarPunto(tipo.clave);

    preguntando = tipo;
    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-punto]").hidden = false;
    $("[data-anot-punto-accion]").textContent = `${tipo.etiqueta} de ${elegido.nombre}`;

    const caja = $("[data-anot-punto-opciones]");
    caja.textContent = "";
    const suyo = nombreEquipo(elegido.lado);
    [
      { nombre: "Fue punto", ayuda: `Para ${suyo}`, punto: true, clase: "" },
      { nombre: "No fue punto", ayuda: "El rally siguió", punto: false, clase: " anot-btn--no" }
    ].forEach((opcion) => {
      const boton = el("button", `anot-btn anot-btn--tipo${opcion.clase}`);
      boton.type = "button";
      boton.append(el("span", "anot-tipo-nombre", opcion.nombre));
      boton.append(el("span", "anot-tipo-ayuda", opcion.ayuda));
      boton.addEventListener("click", () => anotarPunto(preguntando.clave, opcion.punto));
      caja.append(boton);
    });
  }
```

En `cancelar()`, esconder también el bloque nuevo y limpiar `preguntando`:

```js
  function cancelar() {
    elegido = null;
    entrante = null;
    preguntando = null;
    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-cambio]").hidden = true;
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-reposo]").hidden = false;
  }
```

En `elegir()`, esconder el bloque al empezar un toque nuevo — añadir junto a las otras dos líneas:

```js
    $("[data-anot-punto]").hidden = true;
```

Sustituir `predecir`:

```js
  /**
   * Predice el marcador con las reglas del partido para que el número se mueva
   * al instante. No duplica lógica: `applyPoint` es el mismo que usa el panel, y
   * quién se lleva el punto sale de `tipos`, que el servidor construye desde el
   * catálogo. Aquí estaba escrito a mano («todo menos defensa puntúa»), que es
   * una copia esperando a quedarse vieja.
   */
  function predecir(tipo, punto) {
    const meta = datos.tipos.find((t) => t.clave === tipo);
    if (!meta) return null;
    // Con los que preguntan, sólo hay punto que predecir si la respuesta fue sí.
    if (meta.punto === "pregunta" && punto !== true) return null;
    const ladoPunto = meta.aRival ? otroLado(elegido.lado) : elegido.lado;

    const fingido = {
      status: "live",
      setNumber: datos.estado.setNumero,
      points: { ...datos.estado.puntos },
      sets: { ...datos.estado.sets },
      history: [...datos.estado.historial],
      reglas: datos.partido.reglas,
      elapsedMs: 0,
      startedAt: null,
      winner: null,
      teams: { A: { name: "" }, B: { name: "" } }
    };
    return utils.applyPoint(fingido, ladoPunto, 1);
  }
```

En `anotarPunto`, cambiar la firma, la llamada a `predecir` y el cuerpo enviado:

```js
  async function anotarPunto(tipo, punto) {
```

```js
    const prediccion = predecir(tipo, punto);
```

```js
      const respuesta = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "evento",
        tipo,
        jugadorId,
        ordenEsperado: ordenEsperado,
        // Sólo viaja con los tipos que preguntan: el servidor rechaza el evento
        // si falta, y mandarlo siempre sería decidir por él.
        ...(punto === undefined ? {} : { punto })
      });
```

Y registrar el botón de cancelar, junto a los demás oyentes:

```js
  $("[data-anot-punto-cancelar]").addEventListener("click", cancelar);
```

- [ ] **Step 6: Ejecutar los tests**

Ejecutar: `npm test -- anotador-partido`
Esperado: PASS.

- [ ] **Step 7: Comprobar el alto otra vez**

`npm run build && npx wrangler dev --port 8798`, y a 390×844 tocar un jugador y luego «Bloqueo». El bloque del tercer toque **no puede** ser más alto que la botonera a la que sustituye, o los botones se moverían de sitio entre toque y toque — que es la regla de la que sale todo el diseño de esta pantalla.

- [ ] **Step 8: Commit**

```bash
git add src/pages/anotador/partido.astro src/styles/anotador/index.css \
        public/assets/anotador/partido.js test/unit/anotador-partido.test.ts
git commit -m "$(cat <<'EOF'
feat(anotador): bloqueo y chilena preguntan si el rally acabó en punto

Tercer toque en el mismo hueco del pulgar, con la gramática que ya existe
para los cambios. Quién pregunta lo dice el servidor, no una lista escrita
en el cliente: esa copia ya se quedó vieja una vez.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: El diálogo de corregir gana el sí/no

**Files:**
- Modify: `src/pages/anotador/partido.astro:148-166` (diálogo de corregir)
- Modify: `public/assets/anotador/partido.js:491-560` (`abrirCorreccion`, `marcarElegidos`, `guardarCorreccion`)
- Test: `test/unit/anotador-partido.test.ts`

**Interfaces:**
- Consumes: `POST { accion: "corregir", orden, tipo, jugadorId, punto }` de la Task 2.
- Produces: nada aguas abajo.

- [ ] **Step 1: Escribir el test**

Añadir al `MARCADO`, dentro del diálogo de corregir:

```html
      <div data-anot-corregir-punto hidden>
        <button type="button" data-punto="true">Fue punto</button>
        <button type="button" data-punto="false">No fue punto</button>
      </div>
```

```ts
it("corregir enseña el sí/no sólo con los tipos que preguntan", async () => {
  await montarPartido({ eventos: [{ orden: 0, tipo: "punto", jugadorId: 1, jugador: "Berta", setNumero: 1 }] });
  document.querySelector("[data-anot-historial] button").click();

  const bloque = document.querySelector("[data-anot-corregir-punto]");
  expect(bloque.hidden).toBe(true);

  // Elegir «Bloqueo» en el diálogo lo desvela.
  const bloqueo = [...document.querySelectorAll("[data-anot-corregir-tipos] button")].find(
    (b) => b.dataset.tipo === "bloqueo"
  );
  bloqueo.click();
  expect(bloque.hidden).toBe(false);
});
```

- [ ] **Step 2: Ejecutar para verlo fallar**

Ejecutar: `npm test -- anotador-partido`
Esperado: FAIL — `[data-anot-corregir-punto]` no existe.

- [ ] **Step 3: El marcado**

En `src/pages/anotador/partido.astro`, dentro del diálogo de corregir, entre el bloque de tipos y el de «Quién la hizo»:

```astro
      {/*
        Sólo con bloqueo y chilena: los demás tipos ya deciden solos si hubo
        punto. Si no se toca, la corrección conserva lo que la fila ya decía —
        cambiar a quién se atribuye un bloqueo no debe mover el marcador.
      */}
      <div data-anot-corregir-punto hidden>
        <p class="anot-etiqueta">¿Ganó el punto?</p>
        <div class="anot-tipos">
          <button type="button" class="anot-btn anot-btn--tipo" data-punto="true">Fue punto</button>
          <button type="button" class="anot-btn anot-btn--tipo anot-btn--no" data-punto="false">
            No fue punto
          </button>
        </div>
      </div>
```

- [ ] **Step 4: La lógica**

En `abrirCorreccion`, arrancar `correccion` con el estado del evento y refrescar el bloque:

```js
  function abrirCorreccion(evento) {
    correccion = {
      orden: evento.orden,
      tipo: evento.tipo,
      jugadorId: evento.jugadorId,
      // `ladoPunto` no nulo es exactamente «esta fila puntuó».
      punto: evento.ladoPunto !== null
    };
```

y en el `forEach` de tipos del diálogo, tras fijar el tipo:

```js
      boton.addEventListener("click", () => {
        correccion.tipo = tipo.clave;
        marcarElegidos();
      });
```

(sin cambios — `marcarElegidos` es quien desvela el bloque).

Añadir al final de `marcarElegidos`:

```js
    /*
     * El sí/no sólo aparece con los tipos que preguntan. Con los demás, el tipo
     * ya decide y enseñar la pregunta sugeriría una elección que no existe.
     */
    const meta = datos.tipos.find((t) => t.clave === correccion.tipo);
    const pregunta = Boolean(meta && meta.punto === "pregunta");
    $("[data-anot-corregir-punto]").hidden = !pregunta;
    dialogo.querySelectorAll("[data-punto]").forEach((boton) => {
      boton.setAttribute("aria-pressed", String((boton.dataset.punto === "true") === correccion.punto));
    });
```

Registrar los dos botones una sola vez, junto a los demás oyentes del final del fichero:

```js
  $("[data-anot-dialogo-corregir]").querySelectorAll("[data-punto]").forEach((boton) => {
    boton.addEventListener("click", () => {
      if (!correccion) return;
      correccion.punto = boton.dataset.punto === "true";
      marcarElegidos();
    });
  });
```

Y en `guardarCorreccion`, mandar `punto` sólo cuando el tipo lo admite:

```js
      const meta = datos.tipos.find((t) => t.clave === correccion.tipo);
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "corregir",
        orden: correccion.orden,
        tipo: correccion.tipo,
        jugadorId: correccion.jugadorId,
        ...(meta && meta.punto === "pregunta" ? { punto: correccion.punto } : {})
      });
```

- [ ] **Step 5: Ejecutar los tests**

Ejecutar: `npm test -- anotador-partido`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/anotador/partido.astro public/assets/anotador/partido.js \
        test/unit/anotador-partido.test.ts
git commit -m "$(cat <<'EOF'
feat(anotador): corregir un bloqueo puede cambiar si fue punto

El endpoint lo aceptaba desde el commit anterior y no había forma de
pedirlo desde la pantalla: la única salida era deshacer todo lo posterior.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Copy del directo, documentación y verify

**Files:**
- Modify: `src/pages/directo.astro:81`
- Modify: `src/styles/global.css:5603` (comentario)
- Modify: `CLAUDE.md` (sección «Anotación en directo»)
- Test: la suite entera

- [ ] **Step 0: Comentarios y fixtures rezagados (hallazgos de la revisión de la Task 1)**

Tres sitios siguen nombrando el catálogo viejo y no los cubre ninguna otra tarea:

1. `functions/_lib/directo.ts:139` — el comentario de `versionDirecto` dice «fijar
   una alineación, registrar un cambio de jugador o anotar **una defensa** no
   mueven el marcador». Ese tipo ya no existe; el caso que sigue valiendo es
   «anotar un bloqueo que no puntúa».
2. `functions/_lib/eventos.ts:573` — en `ladosDelPartido`, «corregir "ese
   **remate** fue de Ana, no de Nuria"» → «ese punto fue de…».
3. `test/unit/directo-page.test.ts:87-93` y `:113-115` — el fixture
   `PLANTILLA.tipos` y el `feed` siguen con `remate` / `error` / `defensa`. Es
   autocontenido, así que **nunca falla solo**: hay que actualizarlo a mano. Y
   ahí está su gracia — ese test demuestra que `/directo/` saca las etiquetas
   del catálogo del servidor, y con claves que `/api/plantilla` ya no puede
   devolver seguiría pasando aunque el cliente volviera a llevarlas a mano.

- [ ] **Step 1: El texto de `/directo/`**

En `src/pages/directo.astro`, línea 81, sustituir «cada punto, cada bloqueo, cada error y cada cambio» por:

```
El historial, como el de un partido de fútbol: cada punto, cada bloqueo,
cada saque fallado y cada cambio.
```

Y actualizar el comentario equivalente en `src/styles/global.css:5603`.

- [ ] **Step 2: Actualizar CLAUDE.md**

En la sección «Anotación en directo», tres párrafos quedan diciendo cosas falsas. Reescribirlos (no retocarlos):

1. El de «An event carries two sides»: `tipo='error'` → `tipo='saque_fallado'`.
2. El de «`TIPOS` carries `puntua` and `alRival`, built from `PUNTUA`»: sustituirlo por el modelo nuevo — `lado_punto` es lo único que dice si una acción puntuó, y el catálogo sólo dice si hay que preguntarlo.
3. El de `partidos.log_version`: «anotar una `defensa`» ya no existe; vale «anotar un bloqueo que no puntúa», que es el caso que sigue moviendo el log sin mover el marcador.

Añadir además una línea al párrafo de la invariante: sigue siendo «todo punto tiene una acción con un jugador detrás», y ahora también «ninguna acción puntúa por su tipo: puntúa por su `lado_punto`».

**Al resolver conflictos en este fichero, conservar los DOS lados** — el párrafo de la otra sesión describe código que ya está en `development`.

- [ ] **Step 3: Verify completo**

Ejecutar: `npm run verify`
Esperado: PASS (build + `astro check` + `test:types` + unit + integration + e2e).

Recordatorio: no lanzarlo si otra sesión lo está corriendo en su worktree — la carga en paralelo es justo lo que empuja al proyecto `integration` por encima de sus 20 s.

- [ ] **Step 4: Commit**

```bash
git add src/pages/directo.astro src/styles/global.css CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: el catálogo nuevo, en el copy del directo y en CLAUDE.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Integrar**

```bash
npm run integrar -- -m "El anotador atribuye todo punto a quien lo gana, y el bloqueo pregunta"
```

Si el push sale rechazado por no ser fast-forward, otra sesión integró mientras corría verify: **se repite el ciclo entero, verify incluido**. Publicar una combinación que nadie ha verificado es lo que todo esto existe para impedir.

---

## ⚠️ Antes de promover a `main`: parar y preguntar

Esto **no** se promueve sin confirmación explícita, y aquí hay un motivo extra del calendario.

El `CHECK` de la 0028 no admite los valores viejos, así que durante los segundos que tarda el despliegue el código viejo que intentara escribir `'remate'` recibiría una violación de restricción. La spec fija la condición: **la promoción se hace con nadie anotando.**

`event.phases` anuncia el torneo del 31 de julio al 2 de agosto de 2026 — es decir, puede estar empezando hoy mismo. Pero ese dato es **copy suelto**: lo que se juega de verdad sale de `partidos.scheduled_at` en D1, y CLAUDE.md ya avisa de que los dos han estado desincronizados. Así que antes de promover:

1. Comprobar en la D1 de producción si hay partidos `live` o programados para hoy.
2. Si los hay, **esperar** a que acabe la jornada.
3. Y luego la ceremonia de siempre: worktree propio, `npm run db:status`, `npm run db:migrate` **antes** de que suba el código, merge, push, y `npm run db:status` otra vez para que diga «No migrations to apply!».

---

## Autorrevisión del plan

**Cobertura de la spec:**

| Sección de la spec | Tarea |
|---|---|
| Catálogo nuevo (5 tipos + ajuste) | 1 |
| `lado_punto` como única verdad | 1 |
| Migración 0028 y mapeo de filas | 1 |
| Columnas `chilenas` / `saques_fallados`; no borrar las viejas | 1 |
| Ventana del despliegue | 7 + nota final |
| Botonera en dos grupos | 4 |
| Tercer toque en la zona del pulgar | 5 |
| Corregir con el sí/no | 2 (servidor) + 6 (pantalla) |
| `METRICAS` y sus tres copias de cliente | 3 |
| Copy de `/directo/` | 7 |
| Borrado de `estadisticasDeEventos` (y `METRICA_DE_TIPO`, que sólo ella usaba) | 1 |
| Cobertura del agregado, que pasa a estar sólo en integración | 2 |
| Actualizar CLAUDE.md | 7 |

Sin huecos.

**Consistencia de tipos:** `TipoEvento`, `Accion`, `TIPOS`, `ACCION_POR_CLAVE`, `ladoDelPunto(tipo, lado, puntua?)` y la forma de `cambios` en `corregirEvento` se definen en la Task 1 y se usan con esos mismos nombres en las 2, 3, 5 y 6. En el cliente, `tipo.punto` y `tipo.aRival` (Task 4) son los mismos campos que lee `predecir` (Task 5) y `marcarElegidos` (Task 6).
