# Poner el partido en directo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que poner un partido en directo sea un acto deliberado y confirmado del anotador, con su cronómetro, y que quien mira sepa desde la cabecera y desde la portada quién está jugando.

**Architecture:** El cerrojo de publicación vive en el servidor (`functions/_lib/eventos.ts`), donde ya viven los otros cerrojos de anotación, porque la pantalla se puede esquivar entrando por URL. Dos acciones nuevas en `POST /api/anotacion` reutilizan el permiso `partidos.anotar`. El cronómetro no añade columnas: reinterpreta `partidos.started_at` (inicio del tramo en curso) y `partidos.elapsed_ms` (acumulado), que es la semántica que `public/assets/match-utils.js` ya implementa. Las siglas se guardan en `equipos.siglas` y se derivan del nombre congelado del partido cuando no las hay.

**Tech Stack:** Astro 5 (salida estática), Cloudflare Pages Functions + D1, TypeScript, JS de cliente en IIFE sin bundler, Vitest (proyectos `unit` / `integration` / `e2e`).

## Global Constraints

- **Worktree:** trabajar en `D:\Repositorio\web-coparena\.worktrees\partido-en-directo`, rama `feature/partido-en-directo`. Nunca en el checkout principal.
- **Puertos (slot 2):** `npm run dev -- --port 4341`, `npx wrangler dev --port 8808`.
- **Migración:** el número libre es **0028**. No reutilizar otro.
- **Idioma:** todo el texto de cara al usuario en español **con tildes** ("Música", "información"). El deporte se escribe **"volley"**, nunca "vóley".
- **Tono:** frases cortas y seguras, sin chistes. El usuario cura la redacción final.
- **CSS público:** todo en `src/styles/global.css`, usando las custom properties existentes (`--sea`, `--cream`, `--lime`, `--coral`, `--dune`, `--pine`, `--dusk`, `--ink`, `--sun`, `--muted`, `--line`). Nada de `<style>` con scope en componentes.
- **CSS del anotador:** tokens `--anot-*` colgados de `body.is-anotador`. El anotador ignora `prefers-color-scheme` a propósito.
- **Responsive obligatorio:** los valores base de `global.css` son la escala **móvil**; la densidad de escritorio vive en el bloque `@media (min-width: 901px)`. Breakpoints existentes: 900px y 560px.
- **Tests:** el comportamiento se prueba en `integration`, nunca en `e2e` (ese proyecto solo demuestra que el middleware está cableado). Sembrar con los helpers de `test/helpers/db.ts`, sin SQL suelto en los ficheros de test.
- **`test/unit/directo-sondeo.test.ts` debe seguir verde sin tocarlo.** Es el presupuesto de peticiones de Cloudflare escrito como test.
- **Comandos:**
  - test de un fichero: `npx vitest run --project unit test/unit/<f>.test.ts`
  - test de integración: `npx vitest run --project integration test/integration/<f>.test.ts`
  - todo lo rápido: `npm test`
  - la puerta antes de integrar: `npm run verify`
- **No ejecutar `npm run verify` en dos worktrees a la vez**: la carga paralela empuja `integration` más allá de su timeout de 20 s.

---

## Estructura de ficheros

**Se crean:**

| Fichero | Responsabilidad |
|---|---|
| `db/migrations/0028_equipos_siglas.sql` | La columna `equipos.siglas` |
| `functions/_lib/siglas.ts` | Derivar siglas de un nombre. Una función, un solo sitio |
| `src/components/BandaDirecto.astro` | El marcado de la banda de la portada |
| `test/unit/siglas.test.ts` | La derivación |
| `test/unit/directo-chip.test.ts` | El chip pinta siglas y no el marcador |
| `test/unit/banda-directo.test.ts` | La banda aparece, desaparece y mide |
| `test/unit/anotador-cronometro.test.ts` | El cerrojo de cliente del reloj |
| `test/integration/anotacion-directo.test.ts` | El cerrojo de publicación |
| `test/integration/cronometro.test.ts` | Arrancar, pausar y la duración final |

**Se modifican:**

| Fichero | Cambio |
|---|---|
| `functions/_lib/eventos.ts` | `PartidoNoEnDirecto`, guardias, arreglo de `elapsed`, `ponerEnDirecto`, `moverCronometro` |
| `functions/api/anotacion.ts` | Acciones `directo` y `cronometro`; `elapsed_ms` en la respuesta |
| `functions/_lib/directo.ts` | `siglas` en `mapDirecto` y en `versionDirecto` |
| `functions/api/admin/equipos.ts` | `siglas` en `?accion=ficha` |
| `functions/_lib/admin.ts` | `siglas` en `cargarEquipoConJugadores` |
| `public/assets/admin/equipos.js` | El campo en el panel |
| `public/assets/anotador/partido.js` | Los tres estados, los dos diálogos, el reloj |
| `src/pages/anotador/partido.astro` | Marcado de los bloques y diálogos nuevos |
| `public/assets/directo.js` | El chip con siglas; la banda de la portada |
| `src/pages/index.astro` | Montar `BandaDirecto` |
| `src/styles/global.css` | Chip, banda, desplazamiento de la cabecera fija |
| `src/styles/admin/*.css` o `anotador` | Estados y reloj del anotador |
| `CLAUDE.md` | Reescribir el párrafo del chip; documentar lo nuevo |
| `test/integration/directo-version.test.ts` | Siglas y cronómetro mueven la versión |
| `test/unit/anotador-partido.test.ts` | El marcado nuevo existe |

---

## Task 1: Siglas — migración y derivación

**Files:**
- Create: `db/migrations/0028_equipos_siglas.sql`
- Create: `functions/_lib/siglas.ts`
- Test: `test/unit/siglas.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `derivarSiglas(nombre: string): string` — exportada desde `functions/_lib/siglas.ts`. La usan las tareas 4 y 5.

- [ ] **Step 1: Write the failing test**

Create `test/unit/siglas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { derivarSiglas } from "../../functions/_lib/siglas";

/*
 * Las siglas son lo único que dice quién juega en el chip de la cabecera, así
 * que dos equipos que colisionan dejan el chip sin información. Por eso la
 * organización puede escribirlas a mano; esto es solo el respaldo.
 */
describe("derivarSiglas", () => {
  it("usa las iniciales cuando llegan a tres", () => {
    expect(derivarSiglas("Rayo Vallecano Beach")).toBe("RVB");
  });

  it("descarta los enlaces y cae a las tres primeras letras si quedan pocas", () => {
    expect(derivarSiglas("Ostreiros do Pozo")).toBe("OST");
  });

  it("con una sola palabra con peso, sus tres primeras letras", () => {
    expect(derivarSiglas("Os Pulpos")).toBe("PUL");
  });

  it("los huecos del cuadro también salen legibles", () => {
    expect(derivarSiglas("Ganador SF1")).toBe("GAN");
  });

  it("corta en cuatro iniciales", () => {
    expect(derivarSiglas("Club Atlético Voleibol Porto Son")).toBe("CAVP");
  });

  it("mantiene las tildes y la eñe: son parte del nombre", () => {
    expect(derivarSiglas("Ñoras")).toBe("ÑOR");
    expect(derivarSiglas("Ría de Muros")).toBe("RÍA");
  });

  it("si todo son enlaces, no se queda sin nada que decir", () => {
    expect(derivarSiglas("Los de la")).toBe("LOS");
  });

  it("con un nombre más corto que tres letras, usa lo que hay", () => {
    expect(derivarSiglas("OK")).toBe("OK");
  });

  it("un nombre vacío no revienta", () => {
    expect(derivarSiglas("")).toBe("");
    expect(derivarSiglas("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit test/unit/siglas.test.ts`
Expected: FAIL — no resuelve `../../functions/_lib/siglas`.

- [ ] **Step 3: Write the implementation**

Create `functions/_lib/siglas.ts`:

```ts
/**
 * Las siglas de un equipo, para el chip de la cabecera.
 *
 * Es el RESPALDO, no la fuente: si `equipos.siglas` tiene algo, manda eso. Esto
 * existe para que un equipo recién inscrito —o un hueco del cuadro que todavía
 * dice «Ganador SF1»— salga legible sin que nadie tenga que escribir nada.
 *
 * Dos iniciales identifican mal («Os Pulpos» y «Os Percebes» dan las mismas), así
 * que cuando las iniciales no llegan a tres se cae a las tres primeras letras de
 * la primera palabra con peso. No se intenta desempatar automáticamente: unas
 * siglas que cambian solas el día que se inscribe otro equipo parecido son peores
 * que un choque, porque nadie las ve cambiar. Para eso está la columna.
 */

/** Palabras que no aportan: no se cuentan como inicial. */
const ENLACES = new Set(["de", "do", "da", "del", "la", "el", "los", "las", "os", "as", "y", "e"]);

const MINIMO = 3;
const MAXIMO = 4;

export function derivarSiglas(nombre: string): string {
  const palabras = String(nombre || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (palabras.length === 0) return "";

  // Si todo son enlaces nos quedamos con lo que haya: es mejor «LOS» que nada.
  const conPeso = palabras.filter((palabra) => !ENLACES.has(palabra.toLocaleLowerCase("es")));
  const utiles = conPeso.length > 0 ? conPeso : palabras;

  const iniciales = utiles.map((palabra) => palabra[0]!).join("");
  if (iniciales.length >= MINIMO) return iniciales.slice(0, MAXIMO).toLocaleUpperCase("es");

  return utiles[0]!.slice(0, MINIMO).toLocaleUpperCase("es");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit test/unit/siglas.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the migration**

Create `db/migrations/0028_equipos_siglas.sql`:

```sql
-- Migration number: 0028 	 equipos_siglas
-- Las siglas con las que el chip de la cabecera dice quién está jugando.
--
-- Anulable y SIN backfill a propósito: NULL significa «derívalas del nombre»
-- (functions/_lib/siglas.ts). Rellenarlas ahora inventaría unas siglas que nadie
-- ha decidido y que la organización se encontraría puestas; dejándolas vacías,
-- lo que hay es un respaldo razonable y un campo que se rellena cuando hace
-- falta —típicamente para deshacer un choque entre dos equipos parecidos—.
--
-- Aditiva, como pide el orden de despliegue: durante los segundos que tarda el
-- deploy, el código viejo sigue sirviendo tráfico contra un esquema que es un
-- superconjunto del que conoce.
ALTER TABLE equipos ADD COLUMN siglas TEXT;
```

- [ ] **Step 6: Apply the migration locally and check the schema**

Run: `npx wrangler d1 migrations apply DB --local`
Expected: aplica `0028_equipos_siglas` sin error.

- [ ] **Step 7: Run the whole fast suite**

Run: `npm test`
Expected: PASS. Ningún test existente toca `equipos.siglas`, así que la columna nueva no debe romper nada.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/0028_equipos_siglas.sql functions/_lib/siglas.ts test/unit/siglas.test.ts
git commit -m "feat(siglas): columna equipos.siglas y derivación de respaldo desde el nombre"
```

---

## Task 2: El cerrojo de publicación

Cierra el agujero de fondo: hoy anotar el primer punto publica el partido en silencio, porque `sentenciasDerivadas` escribe `status = 'live'` en cada pliegue.

**Files:**
- Modify: `functions/_lib/eventos.ts` (clase nueva junto a `PartidoTerminado` en la línea 173; guardias en `registrarEvento` línea 385 y `adoptarMarcador` línea 786; función nueva al final)
- Modify: `functions/api/anotacion.ts` (acción nueva en el `switch` de la línea 260)
- Test: `test/integration/anotacion-directo.test.ts`

**Interfaces:**
- Consumes: `PartidoAnotable`, `ErrorDeAnotacion`, `hayMarcadorAMano`, `marcadorPlano` de `functions/_lib/eventos.ts`.
- Produces:
  - `class PartidoNoEnDirecto extends ErrorDeAnotacion` (estado 409)
  - `ponerEnDirecto(db: D1Database, partido: PartidoAnotable): Promise<void>`
  - Acción HTTP `POST /api/anotacion?partido=ID` con `{ accion: "directo" }`

- [ ] **Step 1: Write the failing test**

Create `test/integration/anotacion-directo.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost, onRequestGet } from "../../functions/api/anotacion";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearEquipo, crearPartido, crearUsuarioConPermisos, peticion } from "../helpers/db";

/*
 * El agujero que esto cierra: `sentenciasDerivadas` escribe `status = 'live'` en
 * cada pliegue, así que el PRIMER punto publicaba el partido —portada, chip de
 * la cabecera y /directo/ para todo el que entrara— sin que nadie lo decidiera y
 * sin forma de volver atrás desde el anotador.
 *
 * Por eso no basta con comprobar que la petición da 409: hay que comprobar que
 * el partido NO se publicó, que es el daño de verdad.
 */

const anotador = () => crearUsuarioConPermisos(["panel.entrar", "partidos.anotar"]);

async function postear(partidoId: string, cuerpo: Record<string, unknown>, cookie: string) {
  return await onRequestPost(
    ctx(
      await peticion(`/api/anotacion?partido=${partidoId}`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo)
      }),
      env
    )
  );
}

const estadoDe = async (partidoId: string) =>
  (await env.DB.prepare("SELECT status, started_at, elapsed_ms FROM partidos WHERE id = ?1").bind(partidoId).first<{
    status: string;
    started_at: string | null;
    elapsed_ms: number;
  }>())!;

/** Un partido programado con dos equipos y su gente ya en pista. */
async function partidoListo() {
  const usuario = await anotador();
  const cookie = await cookieSesion(usuario);
  const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
  const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
  const partidoId = await crearPartido({ equipoA, equipoB, status: "scheduled" });

  await postear(partidoId, { accion: "alineacion", lado: "A", jugadorIds: [equipoA.jugadores[0].id] }, cookie);
  await postear(partidoId, { accion: "alineacion", lado: "B", jugadorIds: [equipoB.jugadores[0].id] }, cookie);

  return { cookie, equipoA, equipoB, partidoId };
}

describe("no se anota sobre un partido que no está en directo", () => {
  it("anotar un punto responde 409 y NO publica el partido", async () => {
    const { cookie, equipoA, partidoId } = await partidoListo();

    const respuesta = await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );

    expect(respuesta.status).toBe(409);
    expect((await estadoDe(partidoId)).status).toBe("scheduled");
    const eventos = await env.DB.prepare("SELECT COUNT(*) AS n FROM partido_eventos WHERE partido_id = ?1")
      .bind(partidoId)
      .first<{ n: number }>();
    expect(eventos!.n).toBe(0);
  });

  /*
   * La otra puerta al mismo agujero: adoptar escribe por el pliegue, así que un
   * partido `scheduled` con puntos puestos a mano desde el panel se publicaría
   * igual sin que nadie lo decidiera.
   */
  it("adoptar un marcador de a mano también responde 409 y no publica", async () => {
    const usuario = await anotador();
    const cookie = await cookieSesion(usuario);
    const partidoId = await crearPartido({ status: "scheduled", puntosA: 8, puntosB: 6 });

    const respuesta = await postear(partidoId, { accion: "adoptar" }, cookie);

    expect(respuesta.status).toBe(409);
    expect((await estadoDe(partidoId)).status).toBe("scheduled");
  });

  it("fijar la alineación SÍ se puede antes del pitido: es preparación", async () => {
    const { partidoId } = await partidoListo();
    const filas = await env.DB.prepare("SELECT COUNT(*) AS n FROM partido_alineacion WHERE partido_id = ?1")
      .bind(partidoId)
      .first<{ n: number }>();

    expect(filas!.n).toBe(2);
    expect((await estadoDe(partidoId)).status).toBe("scheduled");
  });
});

describe("poner en directo", () => {
  it("publica el partido y deja anotar, con solo partidos.anotar", async () => {
    const { cookie, equipoA, partidoId } = await partidoListo();

    const abrir = await postear(partidoId, { accion: "directo" }, cookie);
    expect(abrir.status).toBe(200);
    expect((await estadoDe(partidoId)).status).toBe("live");

    const punto = await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );
    expect(punto.status).toBe(201);
  });

  /* Los dos gestos están separados: publicar no arranca el reloj. */
  it("no toca el cronómetro", async () => {
    const { cookie, partidoId } = await partidoListo();
    await postear(partidoId, { accion: "directo" }, cookie);

    const fila = await estadoDe(partidoId);
    expect(fila.started_at).toBeNull();
    expect(fila.elapsed_ms).toBe(0);
  });

  it("un partido ya en directo responde 409", async () => {
    const { cookie, partidoId } = await partidoListo();
    await postear(partidoId, { accion: "directo" }, cookie);

    expect((await postear(partidoId, { accion: "directo" }, cookie)).status).toBe(409);
  });

  it("un partido terminado no se reabre por aquí", async () => {
    const usuario = await anotador();
    const cookie = await cookieSesion(usuario);
    const partidoId = await crearPartido({ status: "finished", winner: "A" });

    // Sin `partidos.editar`, un partido terminado ya se rechaza antes.
    expect((await postear(partidoId, { accion: "directo" }, cookie)).status).toBe(403);
  });
});

describe("las reparaciones no se bloquean", () => {
  /*
   * Deshacer y corregir actúan sobre un log que solo pudo existir estando en
   * directo. Bloquearlas dejaría atrapado justo a quien tiene que arreglar algo.
   */
  it("deshacer sigue funcionando después de sacar el partido del directo", async () => {
    const { cookie, equipoA, partidoId } = await partidoListo();
    await postear(partidoId, { accion: "directo" }, cookie);
    await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );

    await env.DB.prepare("UPDATE partidos SET status = 'scheduled' WHERE id = ?1").bind(partidoId).run();

    const respuesta = await postear(partidoId, { accion: "deshacer", ordenEsperado: 0 }, cookie);
    expect(respuesta.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration test/integration/anotacion-directo.test.ts`
Expected: FAIL. El primer test falla porque anotar devuelve 201 y el partido queda `live` — que es exactamente el agujero.

- [ ] **Step 3: Add the exception and the guards in `functions/_lib/eventos.ts`**

Justo después de la clase `PartidoTerminado` (línea 173):

```ts
/**
 * El partido no se ha puesto en directo, así que todavía no se anota.
 *
 * Sin esto, anotar el primer punto PUBLICABA el partido: `sentenciasDerivadas`
 * escribe `status = 'live'` en cada pliegue, así que un toque de prueba lo sacaba
 * en la portada, en el chip de la cabecera y en /directo/ para todo el que
 * entrara — sin confirmación y sin vuelta atrás desde el anotador.
 *
 * El cerrojo vive aquí y no en la pantalla por lo mismo que `MarcadorSinAdoptar`:
 * entrar por la URL basta para saltarse cualquier aviso del cliente.
 */
export class PartidoNoEnDirecto extends ErrorDeAnotacion {
  constructor() {
    super("Este partido no está en directo. Ponlo en directo para poder anotar.");
    this.name = "PartidoNoEnDirecto";
  }
}
```

En `registrarEvento`, **antes** del guardia de `hayMarcadorAMano` (línea 397, justo tras leer eventos y plegar):

```ts
  // Antes que nada: si no está en directo, no se anota. Publicar es un acto
  // deliberado y este es el único sitio donde no se puede esquivar.
  if (partido.status !== "live") throw new PartidoNoEnDirecto();
```

En `adoptarMarcador`, como primera línea del cuerpo (antes de `leerEventos`):

```ts
  // Adoptar escribe por el pliegue, así que publicaría igual: es la otra puerta
  // al mismo agujero.
  if (partido.status !== "live") throw new PartidoNoEnDirecto();
```

- [ ] **Step 4: Add `ponerEnDirecto` at the end of `functions/_lib/eventos.ts`**

```ts
/**
 * Saca el partido a la web.
 *
 * NO toca el cronómetro: son dos gestos separados a propósito. Un partido puede
 * estar publicado y con el reloj sin estrenar —es el estado normal entre que se
 * anuncia y se saca el primer servicio—.
 */
export async function ponerEnDirecto(db: D1Database, partido: PartidoAnotable): Promise<void> {
  if (partido.status === "live") {
    throw new ErrorDeAnotacion("Este partido ya está en directo.");
  }
  if (partido.status === "finished") {
    throw new ErrorDeAnotacion("Este partido ya ha terminado.");
  }

  await db
    .prepare(
      "UPDATE partidos SET status = 'live', log_version = log_version + 1, updated_at = ?1 WHERE id = ?2"
    )
    .bind(new Date().toISOString(), partido.id)
    .run();
}
```

- [ ] **Step 5: Wire the action in `functions/api/anotacion.ts`**

Añadir al import de `../_lib/eventos`: `PartidoNoEnDirecto` no hace falta (se propaga como `ErrorDeAnotacion`), pero sí `ponerEnDirecto`.

En el `switch (accion)` de `onRequestPost`, antes de `default`:

```ts
      case "directo":
        await ponerEnDirecto(env.DB, partido);
        return await respuesta(env.DB, partido);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project integration test/integration/anotacion-directo.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing anotación tests — this is where regressions show**

Run: `npx vitest run --project integration test/integration/anotacion.test.ts test/integration/anotacion-estres.test.ts test/integration/cambios-estres.test.ts`
Expected: varios fallos. Esos tests siembran partidos y anotan sin publicarlos.

**Arreglarlos poniendo el partido en directo, no debilitando el guardia.** Dos formas, en este orden de preferencia:
1. Si el test crea el partido con `crearPartido(...)`, pasarle `status: "live"`.
2. Si el partido tiene que empezar `scheduled` por lo que el test prueba, mandar `{ accion: "directo" }` antes de anotar.

Un test que haya que debilitar para que pase es un hallazgo, no una tarea: si aparece uno, pararse y decirlo.

- [ ] **Step 8: Run the fast suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add functions/_lib/eventos.ts functions/api/anotacion.ts test/integration/
git commit -m "feat(anotador): anotar exige el partido en directo, y publicarlo es una acción propia"
```

---

## Task 3: El cronómetro en el servidor

**Files:**
- Modify: `functions/_lib/eventos.ts` (arreglo del cálculo en la línea 253; función nueva al final)
- Modify: `functions/api/anotacion.ts` (acción nueva; `elapsedMs` en la respuesta)
- Test: `test/integration/cronometro.test.ts`

**Interfaces:**
- Consumes: `PartidoAnotable`, `ErrorDeAnotacion` de `functions/_lib/eventos.ts`.
- Produces:
  - `moverCronometro(db: D1Database, partido: PartidoAnotable, marcha: boolean): Promise<void>`
  - Acción HTTP `{ accion: "cronometro", marcha: true | false }`
  - El objeto `partido` de la respuesta de `/api/anotacion` gana `elapsedMs: number` (ya tenía `startedAt`).

- [ ] **Step 1: Write the failing test**

Create `test/integration/cronometro.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost } from "../../functions/api/anotacion";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearEquipo, crearPartido, crearUsuarioConPermisos, peticion } from "../helpers/db";

/*
 * El cronómetro no añade columnas: reinterpreta las dos que ya existen desde la
 * migración 0003.
 *
 *   started_at  inicio del tramo EN CURSO (NULL = parado)
 *   elapsed_ms  acumulado de los tramos ya cerrados
 *
 * Que es exactamente lo que `elapsed()` de public/assets/match-utils.js ya
 * calculaba. Lo que no lo hacía era `sentenciasDerivadas`, que al cerrar el
 * partido tiraba el acumulado.
 */

async function postear(partidoId: string, cuerpo: Record<string, unknown>, cookie: string) {
  return await onRequestPost(
    ctx(
      await peticion(`/api/anotacion?partido=${partidoId}`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo)
      }),
      env
    )
  );
}

const relojDe = async (partidoId: string) =>
  (await env.DB.prepare("SELECT started_at, elapsed_ms, status FROM partidos WHERE id = ?1").bind(partidoId).first<{
    started_at: string | null;
    elapsed_ms: number;
    status: string;
  }>())!;

const sesion = async () => await cookieSesion(await crearUsuarioConPermisos(["panel.entrar", "partidos.anotar"]));

describe("arrancar y pausar", () => {
  it("arrancar pone el ancla; pausar la recoge en el acumulado", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    expect((await relojDe(partidoId)).started_at).not.toBeNull();

    // Un tramo con duración medible sin dormir el test: se retrasa el ancla.
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 5000).toISOString(), partidoId)
      .run();

    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);
    const parado = await relojDe(partidoId);
    expect(parado.started_at).toBeNull();
    expect(parado.elapsed_ms).toBeGreaterThanOrEqual(5000);
  });

  it("volver a arrancar suma sobre lo acumulado, no lo pisa", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 5000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 3000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);

    expect((await relojDe(partidoId)).elapsed_ms).toBeGreaterThanOrEqual(8000);
  });

  it("pausar dos veces seguidas no resta tiempo", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 4000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);
    const primera = (await relojDe(partidoId)).elapsed_ms;

    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);
    expect((await relojDe(partidoId)).elapsed_ms).toBe(primera);
  });

  it("arrancar dos veces no mueve el ancla: sería regalar tiempo", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    const ancla = (await relojDe(partidoId)).started_at;

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    expect((await relojDe(partidoId)).started_at).toBe(ancla);
  });

  it("no hay reloj de un partido que no está en directo", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "scheduled" });

    expect((await postear(partidoId, { accion: "cronometro", marcha: true }, cookie)).status).toBe(409);
  });
});

describe("la duración final incluye lo acumulado", () => {
  /*
   * El bug: `sentenciasDerivadas` calculaba la duración al cerrar como
   * `ahora − started_at`, tirando `elapsed_ms`. Hoy no se nota porque nada
   * escribe `elapsed_ms` antes del final; en cuanto existe la pausa, todo
   * partido pausado reporta mal su duración. `elapsedOnFinish` de
   * functions/api/partidos.ts ya lo hacía bien: eran dos copias y una mentía.
   */
  it("un partido pausado y reanudado no pierde el tramo anterior al cerrarse", async () => {
    const cookie = await sesion();
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    const partidoId = await crearPartido({
      equipoA,
      equipoB,
      status: "live",
      reglas: { sets: 1, puntosPorSet: 2, ventaja: 1 }
    });

    await postear(partidoId, { accion: "alineacion", lado: "A", jugadorIds: [equipoA.jugadores[0].id] }, cookie);
    await postear(partidoId, { accion: "alineacion", lado: "B", jugadorIds: [equipoB.jugadores[0].id] }, cookie);

    // Diez segundos ya acumulados y el reloj corriendo desde hace uno.
    await env.DB.prepare("UPDATE partidos SET elapsed_ms = 10000, started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 1000).toISOString(), partidoId)
      .run();

    await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );
    await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 1 },
      cookie
    );

    const fila = await relojDe(partidoId);
    expect(fila.status).toBe("finished");
    expect(fila.elapsed_ms).toBeGreaterThanOrEqual(10000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration test/integration/cronometro.test.ts`
Expected: FAIL — la acción `cronometro` no existe (400) y el último test da ~1000 en vez de ≥10000.

- [ ] **Step 3: Fix the elapsed calculation in `functions/_lib/eventos.ts`**

En `sentenciasDerivadas`, sustituir el bloque de la línea 253:

```ts
  /*
   * La duración al cerrar: lo ya acumulado MÁS el tramo en curso.
   *
   * Antes era solo `ahora − started_at`, que tira `elapsed_ms` por la ventana.
   * No se notaba porque nada escribía el acumulado antes del final; con la pausa
   * del anotador, cada partido que se pare entre sets reportaría solo su último
   * tramo. `elapsedOnFinish` de functions/api/partidos.ts siempre lo hizo así:
   * eran dos copias de la misma cuenta y una mentía.
   */
  const elapsed =
    estado.terminado && partido.started_at
      ? partido.elapsed_ms + Math.max(0, Date.now() - new Date(partido.started_at).getTime())
      : partido.elapsed_ms;
```

- [ ] **Step 4: Add `moverCronometro` at the end of `functions/_lib/eventos.ts`**

```ts
/**
 * Arranca o para el reloj del partido.
 *
 * `started_at` es el inicio del tramo EN CURSO y `elapsed_ms` el acumulado de los
 * cerrados, así que arrancar pone el ancla y pausar la recoge. Las dos son
 * idempotentes: arrancar un reloj que ya corre movería el ancla hacia adelante y
 * regalaría el tiempo transcurrido, y pausar uno ya parado volvería a sumar el
 * mismo tramo.
 */
export async function moverCronometro(
  db: D1Database,
  partido: PartidoAnotable,
  marcha: boolean
): Promise<void> {
  if (partido.status !== "live") {
    throw new ErrorDeAnotacion("El cronómetro es del partido en directo. Ponlo en directo primero.");
  }

  const ahora = new Date().toISOString();

  if (marcha) {
    if (partido.started_at) return; // ya corre
    await db
      .prepare(
        "UPDATE partidos SET started_at = ?1, log_version = log_version + 1, updated_at = ?1 WHERE id = ?2"
      )
      .bind(ahora, partido.id)
      .run();
    return;
  }

  if (!partido.started_at) return; // ya está parado
  const acumulado = partido.elapsed_ms + Math.max(0, Date.now() - new Date(partido.started_at).getTime());
  await db
    .prepare(
      "UPDATE partidos SET started_at = NULL, elapsed_ms = ?1, log_version = log_version + 1, updated_at = ?2 WHERE id = ?3"
    )
    .bind(acumulado, ahora, partido.id)
    .run();
}
```

- [ ] **Step 5: Wire the action and expose `elapsedMs` in `functions/api/anotacion.ts`**

Añadir `moverCronometro` al import de `../_lib/eventos`.

En el `switch`, junto a `case "directo"`:

```ts
      case "cronometro":
        await moverCronometro(env.DB, partido, body.marcha === true);
        return await respuesta(env.DB, partido);
```

Y en `respuesta()`, dentro del objeto `partido` (donde ya está `startedAt: fresco.started_at`):

```ts
        startedAt: fresco.started_at,
        // El acumulado viaja para que el navegador pueda pintar el reloj: el
        // servidor manda el ancla, no el número que se ve girar.
        elapsedMs: fresco.elapsed_ms,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project integration test/integration/cronometro.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the fast suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/_lib/eventos.ts functions/api/anotacion.ts test/integration/cronometro.test.ts
git commit -m "feat(anotador): cronómetro con pausa, y la duración final deja de tirar el acumulado"
```

---

## Task 4: Siglas en el directo y en su versión

**Files:**
- Modify: `functions/_lib/directo.ts` (`PartidoDirectoRow`, `mapDirecto` línea 462, `versionDirecto` línea 155, `estadoDirecto` línea 207)
- Test: `test/integration/directo-version.test.ts` (se amplía)

**Interfaces:**
- Consumes: `derivarSiglas` de `functions/_lib/siglas.ts` (Task 1).
- Produces: `GET /api/directo` → cada `partidos[i].teams.A` y `.teams.B` llevan `siglas: string` junto a `id` y `name`. Lo usan las tareas 8 y 9.

- [ ] **Step 1: Write the failing test**

Añadir al final de `test/integration/directo-version.test.ts`:

```ts
describe("las siglas viajan y mueven la versión", () => {
  /*
   * `equipos.siglas` se edita desde el panel, pero `updated_at` vive en
   * `partidos`: sin meterlas en la versión, corregir unas siglas durante el
   * torneo no le llega a NADIE —todos siguen con su 304 y el cuerpo viejo—.
   * Es el mismo fallo que ya documentan los ajustes y el próximo partido.
   */
  it("editar las siglas de un equipo cambia la versión", async () => {
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    await crearPartido({ equipoA, equipoB, status: "live" });

    const antes = await versionActual();
    await env.DB.prepare("UPDATE equipos SET siglas = 'OST' WHERE id = ?1").bind(equipoA.id).run();

    expect(await versionActual()).not.toBe(antes);
  });

  it("quien tenía la versión anterior recibe cuerpo, no un 304", async () => {
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    await crearPartido({ equipoA, equipoB, status: "live" });

    const etag = await versionActual();
    expect((await pedir(etag)).status).toBe(304);

    await env.DB.prepare("UPDATE equipos SET siglas = 'OST' WHERE id = ?1").bind(equipoA.id).run();
    expect((await pedir(etag)).status).toBe(200);
  });

  /*
   * La versión acaba en una cabecera HTTP, y ahí solo cabe ASCII imprimible: una
   * sigla con tilde metida en crudo tira un TypeError al leer la respuesta y deja
   * el directo entero caído. Por eso van en hex().
   */
  it("una sigla con tilde no rompe la cabecera", async () => {
    const equipoA = await crearEquipo({ nombre: "Ría de Muros" });
    const equipoB = await crearEquipo({ nombre: "Ñoras" });
    await crearPartido({ equipoA, equipoB, status: "live" });
    await env.DB.prepare("UPDATE equipos SET siglas = 'RÍA' WHERE id = ?1").bind(equipoA.id).run();
    await env.DB.prepare("UPDATE equipos SET siglas = 'ÑOR' WHERE id = ?1").bind(equipoB.id).run();

    const respuesta = await pedir();
    const etag = respuesta.headers.get("ETag")!;

    expect(etag).toMatch(/^[\x20-\x7E]*$/);
    expect(respuesta.status).toBe(200);
  });

  it("arrancar el cronómetro también mueve la versión", async () => {
    const partidoId = await crearPartido({ status: "live" });
    const antes = await versionActual();

    await env.DB
      .prepare("UPDATE partidos SET started_at = ?1, log_version = log_version + 1, updated_at = ?1 WHERE id = ?2")
      .bind(new Date().toISOString(), partidoId)
      .run();

    expect(await versionActual()).not.toBe(antes);
  });
});

describe("el cuerpo del directo lleva siglas", () => {
  it("las guardadas mandan sobre las derivadas", async () => {
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    await crearPartido({ equipoA, equipoB, status: "live" });
    await env.DB.prepare("UPDATE equipos SET siglas = 'ODP' WHERE id = ?1").bind(equipoA.id).run();

    const cuerpo = (await (await pedir()).json()) as {
      partidos: { teams: { A: { siglas: string }; B: { siglas: string } } }[];
    };

    expect(cuerpo.partidos[0]!.teams.A.siglas).toBe("ODP");
    expect(cuerpo.partidos[0]!.teams.B.siglas).toBe("PUL");
  });

  it("un hueco del cuadro sin equipo también sale con siglas", async () => {
    await crearPartido({ status: "live" });

    const cuerpo = (await (await pedir()).json()) as {
      partidos: { teams: { A: { siglas: string } } }[];
    };

    // El helper pone «Equipo A» de nombre congelado cuando no hay equipo.
    expect(cuerpo.partidos[0]!.teams.A.siglas).toBe("EQU");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration test/integration/directo-version.test.ts`
Expected: FAIL — `siglas` es `undefined` y editar la columna no mueve la versión.

- [ ] **Step 3: Carry the siglas through `estadoDirecto`**

En `functions/_lib/directo.ts`, añadir el import:

```ts
import { derivarSiglas } from "./siglas";
```

Añadir a la interfaz `PartidoDirectoRow` (línea 38):

```ts
  siglas_a: string | null;
  siglas_b: string | null;
```

Y sustituir el `SELECT *` de `estadoDirecto` (línea 211) por uno que traiga las dos columnas:

```ts
    db
      .prepare(
        `SELECT p.*, ea.siglas AS siglas_a, eb.siglas AS siglas_b
           FROM partidos p
           LEFT JOIN equipos ea ON ea.id = p.equipo_a_id
           LEFT JOIN equipos eb ON eb.id = p.equipo_b_id
          WHERE p.edicion_id = ${EDICION_ACTUAL} AND p.status = 'live'
          ORDER BY COALESCE(p.scheduled_at, '9999'), p.sort_order ASC`
      )
      .all<PartidoDirectoRow>(),
```

- [ ] **Step 4: Emit the siglas in `mapDirecto`**

Sustituir el bloque `teams` de `mapDirecto` (línea 476):

```ts
    /*
     * La sigla guardada manda; si no la hay, se deriva del nombre CONGELADO del
     * partido —no de `equipos.nombre`—, igual que hace el cuadro. Así un cruce
     * que todavía dice «Ganador SF1» también sale legible en el chip.
     */
    teams: {
      A: {
        id: partido.equipo_a_id,
        name: partido.equipo_a_nombre,
        siglas: partido.siglas_a || derivarSiglas(partido.equipo_a_nombre)
      },
      B: {
        id: partido.equipo_b_id,
        name: partido.equipo_b_nombre,
        siglas: partido.siglas_b || derivarSiglas(partido.equipo_b_nombre)
      }
    }
```

- [ ] **Step 5: Put the siglas in the version**

En `versionDirecto`, añadir una subconsulta más dentro de la misma consulta de una fila, después de la de `proximo`:

```sql
              -- Las siglas de quien está jugando. Van aquí porque se editan
              -- desde el panel y `updated_at` vive en `partidos`: sin esto,
              -- corregirlas durante el torneo no le llega a nadie.
              --
              -- En hex() porque esto acaba en una cabecera HTTP, donde una tilde
              -- tira un TypeError y deja el directo caído. Se escapa en vez de
              -- limpiarse por lo de siempre: sustituir juntaría dos versiones
              -- distintas y devolvería un 304 con el cuerpo viejo.
              (SELECT COALESCE(GROUP_CONCAT(s, ''), '')
                 FROM (SELECT hex(e.siglas) AS s
                         FROM equipos e
                         JOIN partidos p2 ON e.id IN (p2.equipo_a_id, p2.equipo_b_id)
                        WHERE p2.edicion_id = ${EDICION_ACTUAL}
                          AND p2.status = 'live'
                          AND e.siglas IS NOT NULL
                        ORDER BY e.id)) AS siglas,
```

Añadir `siglas: string` al tipo de `first<...>()` y `fila?.siglas ?? ""` al array que se une con `-`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project integration test/integration/directo-version.test.ts`
Expected: PASS.

- [ ] **Step 7: Check the request budget test is untouched**

Run: `npx vitest run --project unit test/unit/directo-sondeo.test.ts && npx vitest run --project integration test/integration/directo.test.ts test/integration/plantilla.test.ts`
Expected: PASS **sin haber modificado `directo-sondeo.test.ts`**. Si hubiera que tocarlo, parar: el presupuesto de peticiones no se negocia.

- [ ] **Step 8: Commit**

```bash
git add functions/_lib/directo.ts test/integration/directo-version.test.ts
git commit -m "feat(directo): las siglas viajan en el marcador y entran en la versión vía hex()"
```

---

## Task 5: Las siglas en el panel

**Dos avisos, comprobados contra el código antes de escribir esto:**

1. **`?accion=ficha` no lo llama ningún cliente.** Existe en el servidor (`functions/api/admin/equipos.ts:251`) pero ningún script del panel lo invoca — `public/assets/admin/equipos.js` solo usa `PATCH ?id=N` (multipart, línea 679), `DELETE ?id=N` y `POST`. Meter `siglas` en la ficha sería un campo inalcanzable.
2. **`siglas` NO va dentro de `payload`.** Ese JSON pasa por `validarRegistro` de `_lib/validacion.ts`, que es la validación **compartida** con `/inscripcion/` y `/mi-equipo/` y está atada por `test/unit/paridad-validacion.test.ts` a cuatro scripts de cliente. Meterla ahí la arrastraría a `/inscripcion/`, que es justo lo que no queremos: esto lo cura la organización. Va como **campo multipart aparte**, igual que `fotoEquipo` y `eliminarFotoEquipo`.

**Files:**
- Modify: `functions/api/admin/equipos.ts` (`editarEquipo`, línea 135 — el handler multipart)
- Modify: `functions/_lib/admin.ts` (`cargarEquipoConJugadores`, línea 93)
- Modify: `public/assets/admin/equipos.js` (`abrirEditor` línea 290; el `envio` del guardado, línea 670)
- Modify: `src/pages/admin/equipos.astro` (el diálogo del editor, junto al campo del nombre)
- Test: `test/integration/equipos-siglas.test.ts`

**Interfaces:**
- Consumes: la ruta `PATCH /api/admin/equipos?id=N` (multipart).
- Produces: el cuerpo de `cargarEquipoConJugadores` gana `siglas: string | null`.

- [ ] **Step 1: Write the failing test**

Create `test/integration/equipos-siglas.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPatch } from "../../functions/api/admin/equipos";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearAdmin, crearEquipo, peticion } from "../helpers/db";

/*
 * Las siglas las cura la organización, no el equipo que se apunta: por eso van
 * en el panel y NO en /inscripcion/. Sirven para deshacer un choque —«Os Pulpos»
 * y «Os Percebes» derivan las mismas— que el chip de la cabecera no sabría
 * explicar.
 *
 * Viajan como campo multipart SUELTO, no dentro de `payload`: ese JSON pasa por
 * `validarRegistro`, que comparten /inscripcion/ y /mi-equipo/ y que ata
 * `paridad-validacion.test.ts` a cuatro scripts de cliente.
 */

/** El editor del panel: multipart con `payload` más los campos sueltos. */
async function guardar(equipo: { id: number; nombre: string; jugadores: { id: number }[] }, siglas?: string) {
  const admin = await crearAdmin();
  const fd = new FormData();
  fd.append(
    "payload",
    JSON.stringify({
      equipo: equipo.nombre,
      jugadores: equipo.jugadores.map((jugador, i) => ({
        id: jugador.id,
        nombre: `Jugador${i}`,
        apellidos: "Apellido",
        telefono: i === 0 ? "600000000" : "",
        email: i === 0 ? `j${i}.${equipo.id}@ejemplo.com` : ""
      }))
    })
  );
  if (siglas !== undefined) fd.append("siglas", siglas);

  return await onRequestPatch(
    ctx(
      await peticion(`/api/admin/equipos?id=${equipo.id}`, {
        method: "PATCH",
        headers: { Cookie: await cookieSesion(admin) },
        body: fd
      }),
      env
    )
  );
}

const siglasDe = async (equipoId: number) =>
  (await env.DB.prepare("SELECT siglas FROM equipos WHERE id = ?1").bind(equipoId).first<{ siglas: string | null }>())!
    .siglas;

describe("siglas desde el panel", () => {
  it("se guardan en mayúsculas", async () => {
    const equipo = await crearEquipo({ nombre: "Ostreiros do Pozo" });

    expect((await guardar(equipo, "odp")).status).toBe(200);
    expect(await siglasDe(equipo.id)).toBe("ODP");
  });

  it("vaciarlas devuelve a la derivación automática", async () => {
    const equipo = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    await guardar(equipo, "ODP");

    expect((await guardar(equipo, "")).status).toBe(200);
    expect(await siglasDe(equipo.id)).toBeNull();
  });

  it("menos de dos o más de cuatro caracteres se rechaza", async () => {
    const equipo = await crearEquipo({ nombre: "Ostreiros do Pozo" });

    expect((await guardar(equipo, "O")).status).toBe(400);
    expect((await guardar(equipo, "OSTRE")).status).toBe(400);
    expect(await siglasDe(equipo.id)).toBeNull();
  });

  /*
   * El editor de plantilla se guarda entero cada vez. Si no mandar el campo
   * borrase las siglas, cualquier cambio de plantilla las perdería en silencio
   * —el mismo tipo de fallo que el UPDATE de `equipo-editor.ts` evita con las
   * columnas del cromo—.
   */
  it("guardar la plantilla sin mandar el campo no las borra", async () => {
    const equipo = await crearEquipo({ nombre: "Os Pulpos" });
    await guardar(equipo, "PUL");

    await guardar(equipo);
    expect(await siglasDe(equipo.id)).toBe("PUL");
  });

  it("el equipo cargado las devuelve", async () => {
    const equipo = await crearEquipo({ nombre: "Os Pulpos" });
    const respuesta = await guardar(equipo, "PUL");
    const cuerpo = (await respuesta.json()) as { equipo: { siglas: string | null } };

    expect(cuerpo.equipo.siglas).toBe("PUL");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration test/integration/equipos-siglas.test.ts`
Expected: FAIL — `editarEquipo` ignora el campo y `siglas` sigue en `NULL`.

- [ ] **Step 3: Accept `siglas` in `editarEquipo`**

En `functions/api/admin/equipos.ts`, dentro de `editarEquipo`, **después** del bloque de `eliminarFotoEquipo` y antes del `if (Object.keys(camposFoto).length > 0)`:

```ts
  /*
   * Las siglas del chip de la cabecera. Van sueltas y no dentro de `payload`
   * porque ese JSON pasa por `validarRegistro`, que comparten /inscripcion/ y
   * /mi-equipo/: meterlas ahí las llevaría al formulario público, y esto lo cura
   * la organización.
   *
   * `null` cuando no llega el campo (no se toca) y cuando llega vacío (se borra,
   * que significa «derívalas del nombre»). La distinción importa: el editor se
   * guarda entero cada vez, así que un campo ausente NO puede borrar nada.
   */
  const siglasCruda = formData.get("siglas");
  let siglas: string | null = null;
  if (typeof siglasCruda === "string") {
    siglas = siglasCruda.trim().toLocaleUpperCase("es");
    if (siglas.length > 0 && (siglas.length < 2 || siglas.length > 4)) {
      return jsonAdmin(
        { error: "Revisa los campos marcados.", campos: { siglas: "Entre 2 y 4 caracteres, o déjalo vacío." } },
        400
      );
    }
  }
```

Y después de `guardarEquipo`, junto a `aplicarFotoEquipo`:

```ts
  if (typeof siglasCruda === "string") {
    await env.DB
      .prepare("UPDATE equipos SET siglas = ?1 WHERE id = ?2")
      .bind(siglas || null, equipoId)
      .run();
  }
```

- [ ] **Step 4: Return `siglas` from `cargarEquipoConJugadores`**

En `functions/_lib/admin.ts`, añadir `e.siglas` al `SELECT`, `siglas: string | null` al tipo, y `siglas: equipo.siglas` al objeto devuelto.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project integration test/integration/equipos-siglas.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the field to the panel**

En `src/pages/admin/equipos.astro`, dentro del diálogo del editor y junto al campo del nombre del equipo (`[data-team-edit-field="equipo"]`):

```html
<label class="adm-campo">
  <span>Siglas</span>
  <input type="text" maxlength="4" data-team-edit-siglas placeholder="Se derivan solas" />
  <small>Dos a cuatro letras. Es lo que sale en el botón de «En directo» de la cabecera.</small>
</label>
```

En `public/assets/admin/equipos.js`, tres cambios:

1. En `abrirEditor` (línea 290), guardar y pintar el valor actual:

```js
    equipoEnEdicion = {
      id: equipo.id,
      nombre: equipo.nombre,
      siglas: equipo.siglas ?? "",
      tieneFoto: Boolean(equipo.tieneFoto),
      capitanJugadorId: equipo.capitanJugadorId ?? null,
      jugadores: (equipo.jugadores || []).map((j) => ({ ...j }))
    };
    ...
    form.querySelector("[data-team-edit-siglas]").value = equipo.siglas ?? "";
```

2. En el guardado (línea 670), junto a los campos sueltos de la foto:

```js
    // Suelto, no dentro de `payload`: ese JSON es el compartido con /inscripcion/.
    envio.append("siglas", form.querySelector("[data-team-edit-siglas]").value.trim());
```

3. En `calcularDiff`, para que el paso de revisión lo cuente como los demás cambios:

```js
    const siglasAhora = form.querySelector("[data-team-edit-siglas]").value.trim().toUpperCase();
    if (siglasAhora !== (equipoEnEdicion.siglas || "").toUpperCase()) {
      cambios.push(`Siglas: ${equipoEnEdicion.siglas || "—"} → ${siglasAhora || "se derivan solas"}.`);
    }
```

El error del servidor llega en `error.campos.siglas` y lo pinta `pintarErroresServidor`, que ya recorre el objeto.

- [ ] **Step 7: Verify in the browser**

Run: `npm run build && npx wrangler dev --port 8808`
Abrir `http://127.0.0.1:8808/admin/equipos/`, editar un equipo, guardar unas siglas y recargar para comprobar que persisten. Comprobar también el ancho del campo a 390px.

- [ ] **Step 8: Run the fast suite and commit**

```bash
npm test
git add functions/api/admin/equipos.ts functions/_lib/admin.ts public/assets/admin/equipos.js src/pages/admin/equipos.astro test/integration/equipos-siglas.test.ts
git commit -m "feat(panel): campo de siglas en la ficha del equipo"
```

---

## Task 6: El anotador — el estado «no está en directo» y su doble confirmación

**Files:**
- Modify: `src/pages/anotador/partido.astro`
- Modify: `public/assets/anotador/partido.js`
- Modify: **`src/styles/anotador/index.css`** — el CSS del anotador **no** está en `global.css`. Vive aquí, con sus propios tokens colgados de `body.is-anotador`: `--anot-fondo`, `--anot-tinta`, `--anot-superficie`, `--anot-linea`, `--anot-a`, `--anot-b`, `--anot-ok`, `--anot-alerta`, `--anot-apagado`. **No existe `--anot-tenue`**: el texto secundario usa `--anot-apagado`.
- Test: `test/unit/anotador-partido.test.ts` (se amplía)

**Interfaces:**
- Consumes: `POST /api/anotacion { accion: "directo" }` (Task 2); `datos.partido.status` de la respuesta.
- Produces: el marcado `[data-anot-fuera]`, `[data-anot-poner-directo]`, `[data-anot-dialogo-directo]`, `[data-anot-directo-acepto]`, `[data-anot-directo-confirmar]`, `[data-anot-directo-cancelar]`. Lo usa la Task 7.

**Antes de empezar:** invocar la skill `frontend-design:frontend-design`, como exige CLAUDE.md para cualquier cambio de interfaz.

- [ ] **Step 1: Write the failing test**

Añadir a `test/unit/anotador-partido.test.ts`. El fichero ya lee el `.astro`; en su último `describe` hay un helper (línea 705):

```ts
const leer = (ruta: string) => readFileSync(path.resolve(import.meta.dirname, ruta), "utf8");
```

Usar ese mismo patrón en un `describe` nuevo al final del fichero:

```ts
describe("el marcado de poner en directo", () => {
  const leer = (ruta: string) => readFileSync(path.resolve(import.meta.dirname, ruta), "utf8");
  const pagina = () => leer("../../src/pages/anotador/partido.astro");

  it("tiene el bloque de fuera de directo y su diálogo", () => {
    const fuente = pagina();
    expect(fuente).toContain("data-anot-fuera");
    expect(fuente).toContain("data-anot-poner-directo");
    expect(fuente).toContain("data-anot-dialogo-directo");
  });

  /*
   * La segunda confirmación es una casilla que hay que marcar, no un segundo
   * diálogo: dos diálogos seguidos en un móvil al sol se despachan a ciegas.
   */
  it("la confirmación es doble: casilla más botón", () => {
    const fuente = pagina();
    expect(fuente).toContain("data-anot-directo-acepto");
    expect(fuente).toContain("data-anot-directo-confirmar");
  });

  /*
   * El aviso tiene que decir QUÉ pasa, no solo que es importante: quien anota no
   * tiene por qué saber dónde sale publicado el partido.
   */
  it("dice dónde va a aparecer el partido", () => {
    expect(pagina()).toContain("portada");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit test/unit/anotador-partido.test.ts`
Expected: FAIL — ninguno de esos atributos existe.

- [ ] **Step 3: Add the markup in `src/pages/anotador/partido.astro`**

Justo **antes** de `<section class="anot-pista" ...>`:

```html
{/*
  Mientras el partido no esté en directo, esto ocupa el sitio de la pista — el
  mismo patrón que `anot-decision`: no se pintan botones que van a responder 409.
  La alineación sí se puede tocar desde «Más»: es la preparación previa.
*/}
<section class="anot-fuera" data-anot-fuera hidden>
  <h2 class="anot-fuera-titulo">Este partido no está en directo</h2>
  <p class="anot-fuera-texto">
    Nadie lo está viendo todavía. Al ponerlo en directo se publica en la web para todo el mundo.
  </p>
  <button type="button" class="anot-btn anot-btn--primario" data-anot-poner-directo>Poner en directo</button>
</section>
```

Y junto a los otros `<dialog>` del final:

```html
{/*
  La doble confirmación es UN diálogo, no dos: dos seguidos en un móvil al sol se
  despachan a ciegas, que es lo contrario de lo que se busca. La casilla es una
  fila ancha y no un cuadradito porque esto se usa de pie y con una mano.
*/}
<dialog class="anot-dialogo" data-anot-dialogo-directo>
  <form method="dialog">
    <h2>¿Poner el partido en directo?</h2>
    <p class="anot-dialogo-cruce" data-anot-directo-cruce></p>
    <p class="anot-hint">
      Se publicará ahora en la web: aparecerá en la portada, en el botón de la cabecera y en la página
      del directo para todo el que entre.
    </p>

    <label class="anot-acepto">
      <input type="checkbox" data-anot-directo-acepto />
      <span>Lo entiendo, publícalo</span>
    </label>

    <div class="anot-dialogo-pie">
      <button type="button" class="anot-btn" data-anot-directo-cancelar>Cancelar</button>
      <button type="button" class="anot-btn anot-btn--primario" data-anot-directo-confirmar disabled>
        Sí, en directo
      </button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 4: Wire it in `public/assets/anotador/partido.js`**

En `pintar()`, tras calcular `decidir`:

```ts
    // Tres estados excluyentes: fuera de directo, decidiendo el marcador de a
    // mano, o anotando. La pista solo se pinta en el tercero y en el segundo no.
    const fuera = datos.partido.status !== "live";
    $("[data-anot-fuera]").hidden = !fuera;
    $("[data-anot-pista]").hidden = decidir || fuera;
    $("[data-anot-pulgar]").hidden = decidir || fuera;
```

(y quitar las dos líneas anteriores que ponían `hidden = decidir` a secas).

Añadir las funciones y los oyentes:

```js
  // ------------------------------------------------------ poner en directo ---

  function abrirDirecto() {
    if (guardando) return;
    const acepto = $("[data-anot-directo-acepto]");
    acepto.checked = false;
    $("[data-anot-directo-confirmar]").disabled = true;
    $("[data-anot-directo-cruce]").textContent = `${nombreEquipo("A")} — ${nombreEquipo("B")}`;
    $("[data-anot-dialogo-directo]").showModal();
  }

  $("[data-anot-poner-directo]").addEventListener("click", abrirDirecto);
  $("[data-anot-directo-acepto]").addEventListener("change", (evento) => {
    $("[data-anot-directo-confirmar]").disabled = !evento.target.checked;
  });
  $("[data-anot-directo-cancelar]").addEventListener("click", () => $("[data-anot-dialogo-directo]").close());
  $("[data-anot-directo-confirmar]").addEventListener("click", async () => {
    $("[data-anot-dialogo-directo]").close();
    await accionSimple({ accion: "directo" });
  });
```

- [ ] **Step 5: Add the styles in `src/styles/anotador/index.css`**

**No en `global.css`**: el anotador tiene su propia hoja. Siguiendo el patrón de `.anot-decision`, que ya está ahí:

```css
/* Ocupa el hueco de la pista, así que se compone igual que `.anot-decision`. */
.anot-fuera {
  align-items: center;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  padding: 24px 16px;
  text-align: center;
}

.anot-fuera-titulo {
  font-family: var(--font-display);
  font-size: 1.3rem;
  margin: 0;
}

.anot-fuera-texto {
  color: var(--anot-apagado);
  margin: 0;
  max-width: 34ch;
}

/* Fila ancha, no casilla diminuta: esto se marca de pie y con una mano. */
.anot-acepto {
  align-items: center;
  border: 2px solid var(--anot-linea);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  margin: 14px 0;
  min-height: 52px;
  padding: 10px 14px;
}

.anot-acepto input {
  height: 24px;
  width: 24px;
}

.anot-dialogo-cruce {
  font-family: var(--font-display);
  font-size: 1.05rem;
  margin: 0 0 6px;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project unit test/unit/anotador-partido.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify on a phone-sized viewport**

Run: `npm run build && npx wrangler dev --port 8808`
Abrir `/anotador/partido/?id=<un partido scheduled>` a 390px de ancho. Comprobar: el bloque ocupa el sitio de la pista, el botón de confirmar arranca apagado, marcar la casilla lo enciende, y tras confirmar aparecen la pista y la franja del pulgar.

**Nota para capturas headless:** Chrome no baja de ~500px de ancho, así que un `--window-size=390,844` renderiza a 500 y recorta. Los "cortes" del borde derecho a tamaños móviles suelen ser eso, no un fallo de maquetación.

- [ ] **Step 8: Commit**

```bash
git add src/pages/anotador/partido.astro public/assets/anotador/partido.js src/styles/anotador/index.css test/unit/anotador-partido.test.ts
git commit -m "feat(anotador): estado fuera de directo y doble confirmación para publicar"
```

---

## Task 7: El anotador — el reloj y el pop-up del primer punto

**Files:**
- Modify: `src/pages/anotador/partido.astro`
- Modify: `public/assets/anotador/partido.js`
- Modify: **`src/styles/anotador/index.css`** (no `global.css`; tokens `--anot-*`, ver Task 6)
- Test: `test/unit/anotador-cronometro.test.ts`

**Interfaces:**
- Consumes: `POST /api/anotacion { accion: "cronometro", marcha }` (Task 3); `datos.partido.startedAt` y `datos.partido.elapsedMs`; `window.CopaArenaMatches.elapsed()` y `.formatClock()` de `match-utils.js`, que la página ya carga.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Write the failing test**

Create `test/unit/anotador-cronometro.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El cerrojo del reloj es de CLIENTE, a diferencia del de `live`.
 *
 * Los dos protegen cosas de distinto tamaño: publicar un partido sin querer se ve
 * desde fuera y no tiene vuelta atrás desde el anotador, así que su guardia va en
 * el servidor, donde no se puede esquivar entrando por URL. Anotar con el reloj
 * sin estrenar solo deja mal la duración de un partido, y un 409 más sería otra
 * forma de que la franja del pulgar se quede muerta a pie de pista.
 */

const MARCADO = `
  <div class="anot-panel" data-anot-panel hidden>
    <p data-anot-rotulo hidden></p>
    <span data-anot-puntos-a>0</span><span data-anot-puntos-b>0</span>
    <p data-anot-detalle></p><p data-anot-parciales hidden></p>
    <span data-anot-reloj hidden></span>
    <button data-anot-reloj-pausa hidden></button>
    <button data-anot-reloj-iniciar hidden>Iniciar cronómetro</button>
    <section data-anot-decision hidden>
      <h2 data-anot-decision-titulo></h2>
      <button data-anot-adoptar></button><button data-anot-cero></button>
    </section>
    <section data-anot-fuera hidden>
      <button data-anot-poner-directo></button>
    </section>
    <section data-anot-pista>
      <p data-anot-banda-a></p><div data-anot-mitad-a></div><div data-anot-banquillo-a></div>
      <p data-anot-banda-b></p><div data-anot-mitad-b></div><div data-anot-banquillo-b></div>
    </section>
    <section data-anot-pulgar>
      <div data-anot-reposo><p data-anot-ultimo></p><button data-anot-deshacer></button></div>
      <div data-anot-acciones hidden><strong data-anot-elegido></strong><div data-anot-tipos></div>
        <button data-anot-cancelar></button></div>
      <div data-anot-cambio hidden><strong data-anot-entra></strong><div data-anot-cambio-opciones></div>
        <button data-anot-cambio-cancelar></button></div>
      <p data-anot-error hidden></p>
    </section>
    <details><button data-anot-alineacion></button><button data-anot-soltar hidden></button>
      <div data-anot-historial></div></details>
  </div>
  <p data-anot-estado></p>
  <dialog data-anot-dialogo-alineacion><div data-anot-plantillas></div>
    <button data-anot-alineacion-cancelar></button><button data-anot-alineacion-guardar></button></dialog>
  <dialog data-anot-dialogo-corregir><h2 data-anot-corregir-titulo></h2>
    <div data-anot-corregir-tipos></div><div data-anot-corregir-jugadores></div>
    <button data-anot-corregir-cancelar></button><button data-anot-corregir-guardar></button></dialog>
  <dialog data-anot-dialogo-directo><p data-anot-directo-cruce></p>
    <input type="checkbox" data-anot-directo-acepto />
    <button data-anot-directo-cancelar></button><button data-anot-directo-confirmar disabled></button></dialog>
  <dialog data-anot-dialogo-reloj>
    <button data-anot-reloj-cancelar></button><button data-anot-reloj-confirmar></button></dialog>
`;

/** El estado que devuelve /api/anotacion, con el reloj donde lo pida el test. */
const estado = (reloj: { startedAt: string | null; elapsedMs: number }) => ({
  partido: {
    id: "p1",
    status: "live",
    origenMarcador: "eventos",
    reglas: { sets: 3, puntosPorSet: 21, ventaja: 2 },
    ...reloj
  },
  estado: {
    puntos: { A: 0, B: 0 },
    sets: { A: 0, B: 0 },
    setNumero: 1,
    historial: [],
    terminado: false,
    winner: null
  },
  eventos: [],
  siguienteOrden: 0,
  marcadorPanel: { puntos: { A: 0, B: 0 }, sets: { A: 0, B: 0 } },
  pendienteDeAdoptar: false,
  alineacion: [{ jugador_id: 1, lado: "A", orden: 0, nombre: "Ana", apellidos: "Ruiz", dorsal: 4 }],
  cambios: [],
  equipos: {
    A: { nombre: "Ostreiros do Pozo", jugadores: [{ id: 1, nombre: "Ana", apellidos: "Ruiz", dorsal: 4, nivel: "oro", media: 80, tieneFoto: false, esSuplente: false }] },
    B: { nombre: "Os Pulpos", jugadores: [] }
  },
  tipos: [{ clave: "remate", etiqueta: "Remate", ayuda: "Punto directo", puntua: true, alRival: false }]
});

let fetchMock: ReturnType<typeof vi.fn>;

async function montar(reloj: { startedAt: string | null; elapsedMs: number }) {
  document.body.innerHTML = MARCADO;
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => estado(reloj) });

  // Los scripts de los que depende la página, en el mismo orden que el .astro.
  const { ejecutarScriptPublico } = await import("../helpers/dom");
  ejecutarScriptPublico("match-utils.js");
  ejecutarScriptPublico("cromo.js");
  ejecutarScriptPublico("anotador/core.js");
  ejecutarScriptPublico("anotador/partido.js");

  window.dispatchEvent(new Event("copa:auth"));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { search: "?id=p1" } as Location);
  (window as unknown as { CopaAuth: unknown }).CopaAuth = {
    state: { loading: false, user: { id: 1 }, acceso: { permisos: ["partidos.anotar"] } }
  };
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("el reloj sin estrenar bloquea el primer punto", () => {
  it("tocar una acción abre el diálogo y no llama a la API", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("confirmar arranca el reloj y anota el punto, en ese orden", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-reloj-confirmar]")!.click();
    await new Promise((r) => setTimeout(r, 0));

    const cuerpos = fetchMock.mock.calls.map((llamada) => JSON.parse(llamada[1].body));
    expect(cuerpos[0]).toMatchObject({ accion: "cronometro", marcha: true });
    expect(cuerpos[1]).toMatchObject({ accion: "evento", tipo: "remate" });
  });

  it("cancelar no manda nada: el punto se pierde a propósito", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-reloj-cancelar]")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("la pausa no bloquea", () => {
  /*
   * Solo el estreno bloquea. La pausa es para el descanso entre sets, y un toque
   * que no hace nada porque el reloj está parado es justo la trampa que esta
   * pantalla no puede permitirse.
   */
  it("con el reloj pausado, el punto se anota directamente", async () => {
    await montar({ startedAt: null, elapsedMs: 120000 });
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ accion: "evento" });
  });

  it("con el reloj corriendo tampoco pregunta", async () => {
    await montar({ startedAt: new Date().toISOString(), elapsedMs: 0 });
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ accion: "evento" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit test/unit/anotador-cronometro.test.ts`
Expected: FAIL — no existe el diálogo del reloj ni el cerrojo.

- [ ] **Step 3: Add the markup in `src/pages/anotador/partido.astro`**

Dentro de `<section class="anot-marcador">`, tras `<p class="anot-detalle" ...>`:

```html
{/*
  El reloj va ARRIBA, lejos del pulgar: la zona de anotar está abajo, así que la
  pausa no se toca sin querer. El número lo pinta el navegador desde el ancla que
  manda el servidor, no viaja hecho.
*/}
<p class="anot-reloj-fila">
  <span class="anot-reloj" data-anot-reloj hidden></span>
  <button type="button" class="anot-reloj-btn" data-anot-reloj-pausa hidden aria-label="Pausar el cronómetro">
    ⏸
  </button>
  <button type="button" class="anot-btn anot-btn--reloj" data-anot-reloj-iniciar hidden>
    Iniciar cronómetro
  </button>
</p>
```

Y junto a los otros diálogos:

```html
{/*
  Sale al tocar un punto con el reloj sin estrenar. Al confirmar se anota el punto
  que lo disparó: un toque descartado a pie de pista es un punto perdido.
*/}
<dialog class="anot-dialogo" data-anot-dialogo-reloj>
  <form method="dialog">
    <h2>¿Arrancamos el cronómetro?</h2>
    <p class="anot-hint">El partido ya está en directo. Al arrancarlo se anota este punto.</p>
    <div class="anot-dialogo-pie">
      <button type="button" class="anot-btn" data-anot-reloj-cancelar>Cancelar</button>
      <button type="button" class="anot-btn anot-btn--primario" data-anot-reloj-confirmar>Arrancar</button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 4: Wire it in `public/assets/anotador/partido.js`**

Añadir el estado y las funciones:

```js
  /** El punto que espera a que arranque el reloj. */
  let puntoEnEspera = null;
  let tictac = null;

  const relojCorriendo = () => Boolean(datos.partido.startedAt);
  const relojSinEstrenar = () => !datos.partido.startedAt && !datos.partido.elapsedMs;

  /**
   * El reloj lo pinta el navegador desde el ancla del servidor.
   *
   * `elapsed()` de match-utils.js ya sabe la cuenta —acumulado más el tramo en
   * curso—, así que aquí no se repite: es la misma que usa el panel.
   */
  function pintarReloj() {
    const caja = $("[data-anot-reloj]");
    const pausa = $("[data-anot-reloj-pausa]");
    const iniciar = $("[data-anot-reloj-iniciar]");
    const fuera = datos.partido.status !== "live";

    iniciar.hidden = fuera || !relojSinEstrenar();
    caja.hidden = fuera || relojSinEstrenar();
    pausa.hidden = caja.hidden;

    if (caja.hidden) return;

    const ms = utils.elapsed({
      status: "live",
      startedAt: datos.partido.startedAt,
      elapsedMs: datos.partido.elapsedMs
    });
    texto(caja, utils.formatClock(ms));
    pausa.textContent = relojCorriendo() ? "⏸" : "▶";
    pausa.setAttribute("aria-label", relojCorriendo() ? "Pausar el cronómetro" : "Reanudar el cronómetro");
  }

  /* Un tick por segundo, y solo mientras corre: parado no hay nada que mover. */
  function vigilarReloj() {
    clearInterval(tictac);
    if (!datos || !relojCorriendo() || document.visibilityState === "hidden") return;
    tictac = setInterval(pintarReloj, 1000);
  }
```

Llamar a `pintarReloj()` y `vigilarReloj()` al final de `pintar()`.

En `anotarPunto(tipo)`, como primeras líneas del cuerpo (antes de `guardando = true`):

```js
    /*
     * El reloj sin estrenar para el primer punto. No es un cerrojo de servidor a
     * propósito: lo único que estropea anotar sin reloj es la duración del
     * partido, y un 409 más sería otra forma de que la franja del pulgar se
     * quede muerta a pie de pista.
     */
    if (relojSinEstrenar()) {
      puntoEnEspera = { tipo, jugador: elegido };
      cancelar();
      $("[data-anot-dialogo-reloj]").showModal();
      return;
    }
```

Y los oyentes, junto a los demás:

```js
  $("[data-anot-reloj-iniciar]").addEventListener("click", () =>
    accionSimple({ accion: "cronometro", marcha: true })
  );
  $("[data-anot-reloj-pausa]").addEventListener("click", () =>
    accionSimple({ accion: "cronometro", marcha: !relojCorriendo() })
  );
  $("[data-anot-reloj-cancelar]").addEventListener("click", () => {
    puntoEnEspera = null;
    $("[data-anot-dialogo-reloj]").close();
  });
  $("[data-anot-reloj-confirmar]").addEventListener("click", async () => {
    $("[data-anot-dialogo-reloj]").close();
    const espera = puntoEnEspera;
    puntoEnEspera = null;
    await accionSimple({ accion: "cronometro", marcha: true });
    // El punto que abrió el diálogo se anota: descartarlo sería perderlo.
    if (espera && datos.partido.startedAt) {
      elegido = espera.jugador;
      await anotarPunto(espera.tipo);
    }
  });

  document.addEventListener("visibilitychange", vigilarReloj);
```

- [ ] **Step 5: Add the styles in `src/styles/anotador/index.css`**

```css
.anot-reloj-fila {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: center;
  margin: 4px 0 0;
  min-height: 34px;
}

/* Tabular para que los dígitos no bailen al pasar de 9 a 10. */
.anot-reloj {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

/* Objetivo cómodo aunque el glifo sea pequeño: se toca con el pulgar de refilón. */
.anot-reloj-btn {
  background: none;
  border: 2px solid var(--anot-linea);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95rem;
  min-height: 34px;
  min-width: 42px;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project unit test/unit/anotador-cronometro.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the height budget on a phone**

Run: `npm run build && npx wrangler dev --port 8808`
A 390×844, con el partido en directo y el reloj corriendo: medir que la franja del pulgar sigue por encima del borde. El presupuesto medido era 742px + 60 de barra; el reloj va en una fila que ya existía, así que no debería moverse. Si sube, decirlo antes de seguir.

- [ ] **Step 8: Commit**

```bash
git add src/pages/anotador/partido.astro public/assets/anotador/partido.js src/styles/anotador/index.css test/unit/anotador-cronometro.test.ts
git commit -m "feat(anotador): cronómetro con pausa y arranque antes del primer punto"
```

---

## Task 8: El chip de la cabecera

**Files:**
- Modify: `public/assets/directo.js` (`pintarBoton`, línea 146)
- Modify: `src/styles/global.css`
- Test: `test/unit/directo-chip.test.ts`

**Interfaces:**
- Consumes: `teams.A.siglas` y `teams.B.siglas` de `/api/directo` (Task 4).
- Produces: nada.

**Antes de empezar:** invocar `frontend-design:frontend-design`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/directo-chip.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico } from "../helpers/dom";

/*
 * El chip encendido pasa a decir QUIÉN juega, no cómo van. El marcador se ve
 * entrando: sin saber de quién, un «12–9» no informa de nada.
 *
 * Y el aria-label pierde el marcador por una razón aparte: el enlace tiene
 * aria-live="polite", así que hoy un lector de pantalla canta cada punto desde
 * cualquier página del sitio. Con siglas se anuncia una vez por partido.
 */

const MARCADO = `
  <details data-directo-apagado data-nav-drop>
    <summary><span data-directo-etiqueta>Offline</span></summary>
  </details>
  <a data-directo-vivo hidden aria-live="polite"><span data-directo-texto></span></a>
`;

const conPartido = () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'W/"directo-1"' },
  json: async () => ({
    hayDirecto: true,
    partidos: [
      {
        id: "p1",
        points: { A: 12, B: 9 },
        sets: { A: 1, B: 0 },
        teams: {
          A: { id: 1, name: "Ostreiros do Pozo", siglas: "OST" },
          B: { id: 2, name: "Os Pulpos", siglas: "PUL" }
        }
      }
    ],
    siguiente: null,
    siguienteSondeoMs: 3000,
    modoAhorro: false
  })
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = MARCADO;
  fetchMock = vi.fn().mockResolvedValue(conPartido());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (globalThis as unknown as Record<string, unknown>).CopaDirecto;
});

describe("el chip encendido", () => {
  it("enseña las siglas de los dos equipos, no el marcador", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    const texto = document.querySelector("[data-directo-texto]")!.textContent!;
    expect(texto).toContain("OST");
    expect(texto).toContain("PUL");
    expect(texto).not.toContain("12");
    expect(texto).not.toContain("9");
  });

  it("no se queda en «En directo»: siempre hay siglas que enseñar", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector("[data-directo-texto]")!.textContent).not.toBe("En directo");
  });

  it("el aria-label lleva los nombres completos y ningún punto", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    const etiqueta = document.querySelector("[data-directo-vivo]")!.getAttribute("aria-label")!;
    expect(etiqueta).toContain("Ostreiros do Pozo");
    expect(etiqueta).toContain("Os Pulpos");
    expect(etiqueta).not.toMatch(/\b12\b/);
  });

  it("enciende el enlace y apaga el desplegable", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect((document.querySelector("[data-directo-vivo]") as HTMLElement).hidden).toBe(false);
    expect((document.querySelector("[data-directo-apagado]") as HTMLElement).hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit test/unit/directo-chip.test.ts`
Expected: FAIL — el chip pinta «12–9».

- [ ] **Step 3: Rewrite `pintarBoton` in `public/assets/directo.js`**

Sustituir el bloque final de `pintarBoton` (desde `const texto = ...`):

```js
    /*
     * Enseña QUIÉN juega, no cómo van: sin saber de quién, un «12–9» no informa
     * de nada, y el marcador está a un toque. De paso desaparece el caso especial
     * de «antes del primer punto el marcador no dice nada»: siglas hay siempre.
     */
    const texto = vivo.querySelector("[data-directo-texto]");
    texto.textContent = `${partido.teams.A.siglas}–${partido.teams.B.siglas}`;
    /*
     * Sin el marcador aquí tampoco. El enlace tiene aria-live="polite": con los
     * puntos dentro, un lector de pantalla cantaba cada punto del partido desde
     * cualquier página del sitio. Así se anuncia una vez por partido.
     */
    vivo.setAttribute(
      "aria-label",
      `En directo: ${partido.teams.A.name} contra ${partido.teams.B.name}. Ver el marcador.`
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit test/unit/directo-chip.test.ts && npx vitest run --project unit test/unit/directo-sondeo.test.ts`
Expected: PASS los dos. `directo-sondeo.test.ts` **sin tocarlo**.

- [ ] **Step 5: Adjust the chip width in `src/styles/global.css`**

El chip pasa de ~60px a ~109px. En `.header-directo.is-vivo` no hace falta cambiar nada estructural (ya tiene `white-space: nowrap`), pero conviene comprobar el apretón a 360px. Si hace falta, en el bloque móvil (fuera del `@media (min-width: 901px)`) reducir la separación:

```css
/* El chip pasa a llevar dos siglas, así que a 360px se aprieta el interior antes
   que quitar la llama, que es lo que dice de un vistazo que hay partido. */
@media (max-width: 560px) {
  .header-directo.is-vivo {
    gap: 4px;
    padding: 5px 10px;
  }
}
```

- [ ] **Step 6: Verify at 360px**

Run: `npm run build && npx wrangler dev --port 8808`
Con un partido `live` en la base local, comprobar que a 360px la cabecera mantiene la marca, el chip y «Menú» sin desbordar.

- [ ] **Step 7: Commit**

```bash
git add public/assets/directo.js src/styles/global.css test/unit/directo-chip.test.ts
git commit -m "feat(directo): el chip de la cabecera dice quién juega en vez del marcador"
```

---

## Task 9: La banda de la portada

**Files:**
- Create: `src/components/BandaDirecto.astro`
- Modify: `src/pages/index.astro`
- Modify: `public/assets/directo.js`
- Modify: `src/styles/global.css`
- Test: `test/unit/banda-directo.test.ts`

**Interfaces:**
- Consumes: `CopaDirecto.suscribir()` y `teams.A.name` / `teams.B.name` de `/api/directo`.
- Produces: nada.

**Antes de empezar:** invocar `frontend-design:frontend-design`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/banda-directo.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico } from "../helpers/dom";

/*
 * La banda de la portada. Se engancha como SEGUNDO suscriptor de CopaDirecto:
 * directo.js ya sondea en esa página porque el chip vive en la cabecera, así que
 * son cero peticiones nuevas y cero cambio de cadencia. El presupuesto de la
 * cuota de Cloudflare se queda como estaba.
 *
 * El obstáculo es que la cabecera es una píldora `position: fixed` con su fondo
 * también fijo —por eso la banda de «ver como» se fue abajo—. Una banda arriba
 * las deja por delante, así que se mide su alto y las dos se apartan con
 * --banda-directo.
 */

const MARCADO = `
  <a class="banda-directo" data-banda-directo href="/directo/" hidden>
    <span data-banda-equipos></span>
  </a>
  <details data-directo-apagado><summary><span data-directo-etiqueta></span></summary></details>
  <a data-directo-vivo hidden><span data-directo-texto></span></a>
`;

const respuesta = (cuerpo: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'W/"directo-1"' },
  json: async () => cuerpo
});

const sinDirecto = () =>
  respuesta({ hayDirecto: false, partidos: [], siguiente: null, siguienteSondeoMs: 60000, modoAhorro: false });

const conDirecto = () =>
  respuesta({
    hayDirecto: true,
    partidos: [
      {
        id: "p1",
        points: { A: 12, B: 9 },
        sets: { A: 1, B: 0 },
        teams: {
          A: { id: 1, name: "Ostreiros do Pozo", siglas: "OST" },
          B: { id: 2, name: "Os Pulpos", siglas: "PUL" }
        }
      }
    ],
    siguiente: null,
    siguienteSondeoMs: 3000,
    modoAhorro: false
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = MARCADO;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom no hace layout: la banda mediría 0 y no se vería el desplazamiento.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 64 } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (globalThis as unknown as Record<string, unknown>).CopaDirecto;
});

describe("la banda de la portada", () => {
  it("sin partido está oculta y no aparta nada", async () => {
    fetchMock.mockResolvedValue(sinDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect((document.querySelector("[data-banda-directo]") as HTMLElement).hidden).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--banda-directo")).toBe("0px");
  });

  it("con partido enseña los nombres COMPLETOS, no las siglas", async () => {
    fetchMock.mockResolvedValue(conDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    const banda = document.querySelector("[data-banda-directo]") as HTMLElement;
    expect(banda.hidden).toBe(false);
    expect(document.querySelector("[data-banda-equipos]")!.textContent).toContain("Ostreiros do Pozo");
    expect(document.querySelector("[data-banda-equipos]")!.textContent).toContain("Os Pulpos");
  });

  it("aparta la cabecera fija por el alto medido", async () => {
    fetchMock.mockResolvedValue(conDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.documentElement.style.getPropertyValue("--banda-directo")).toBe("64px");
  });

  it("al acabar el partido se retira y devuelve el hueco", async () => {
    fetchMock.mockResolvedValue(conDirecto());
    const directo = cargarScriptPublico<{ refrescarAhora(): Promise<void> }>("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    fetchMock.mockResolvedValue(sinDirecto());
    await directo.refrescarAhora();
    await new Promise((r) => setTimeout(r, 0));

    expect((document.querySelector("[data-banda-directo]") as HTMLElement).hidden).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--banda-directo")).toBe("0px");
  });

  it("una página sin banda no falla: el chip vive en todas, la banda solo en la portada", async () => {
    document.body.innerHTML = `
      <details data-directo-apagado><summary><span data-directo-etiqueta></span></summary></details>
      <a data-directo-vivo hidden><span data-directo-texto></span></a>
    `;
    fetchMock.mockResolvedValue(conDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector("[data-directo-texto]")!.textContent).toContain("OST");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit test/unit/banda-directo.test.ts`
Expected: FAIL — nadie pinta la banda ni escribe `--banda-directo`.

- [ ] **Step 3: Create `src/components/BandaDirecto.astro`**

```astro
---
/*
 * «Estamos en directo» en lo alto de la portada.
 *
 * Va EN FLUJO como primer hijo del body, no `fixed`: así el hero, que viene
 * después, baja solo. Lo que sí hay que apartar son la cabecera y su fondo, que
 * son `position: fixed` —es la razón por la que la banda de «ver como» se fue
 * abajo—; de eso se encarga `--banda-directo`, que `directo.js` rellena con el
 * alto medido de esto.
 *
 * Oculta de serie: sin JavaScript no aparece y no mueve nada.
 */
---

<a class="banda-directo" data-banda-directo href="/directo/" hidden>
  <span class="banda-directo-llama" aria-hidden="true">
    <svg viewBox="0 0 16 20">
      <path
        d="M8 0.6c.6 3.2-1.3 4.4-2.9 6C3.2 8.5 2 10.2 2 12.6 2 16.4 4.7 19.4 8 19.4s6-3 6-6.8c0-2.9-1.6-4.6-3.1-6.4-.5.9-1.2 1.5-2 1.8.6-2.7.2-5.4-.9-7.4Z"
        fill="currentColor"
      />
    </svg>
  </span>
  <span class="banda-directo-texto">
    <strong>¡Estamos en directo!</strong>
    <span class="banda-directo-equipos" data-banda-equipos></span>
  </span>
  <span class="banda-directo-cta">Ver el marcador →</span>
</a>
```

- [ ] **Step 4: Mount it in `src/pages/index.astro`**

Añadir el import y ponerlo **antes** de `<SiteHeader />`:

```astro
import BandaDirecto from "../components/BandaDirecto.astro";
```

```astro
<BandaDirecto />
<div class="cursor-blob" data-cursor-blob aria-hidden="true"></div>
<SiteHeader />
```

- [ ] **Step 5: Paint it from `public/assets/directo.js`**

Añadir, junto a `pintarBoton`:

```js
  // ------------------------------------------------- banda de la portada ---

  /*
   * Solo existe en la portada. Se mide el alto real en vez de fijar un número
   * porque en móvil son dos líneas y los nombres largos pueden hacer tres: un
   * 52px a ojo dejaría la cabecera pisando la banda en cuanto un equipo se
   * llamara largo.
   */
  function pintarBanda(datos) {
    const banda = document.querySelector("[data-banda-directo]");
    if (!banda) return;

    const partido = datos?.partidos?.[0] || null;
    banda.hidden = !partido;

    if (!partido) {
      document.documentElement.style.setProperty("--banda-directo", "0px");
      return;
    }

    const equipos = banda.querySelector("[data-banda-equipos]");
    const nombres = `${partido.teams.A.name} — ${partido.teams.B.name}`;
    if (equipos.textContent !== nombres) equipos.textContent = nombres;

    // Después de pintar: el alto depende de lo que se acaba de escribir.
    const alto = Math.round(banda.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--banda-directo", `${alto}px`);
  }
```

Y sustituir la suscripción del final del fichero:

```js
  /*
   * Solo se sondea si hay algo que pintar. Este fichero se carga en todas las
   * páginas porque el botón vive en la cabecera; la banda solo existe en la
   * portada, así que es un suscriptor más del mismo sondeo: cero peticiones
   * nuevas y cero cambio de cadencia.
   */
  if (document.querySelector("[data-directo-apagado]") || document.querySelector("[data-banda-directo]")) {
    suscribir((datos) => {
      pintarBoton(datos);
      pintarBanda(datos);
    });
  }
```

- [ ] **Step 6: Add the styles in `src/styles/global.css`**

```css
/* --------------------------------------------- banda de directo (portada) --- */

/*
 * El hueco que la banda le quita a lo que está `fixed`. Vale 0 mientras no hay
 * partido, así que la cabecera se queda donde siempre.
 */
:root {
  --banda-directo: 0px;
}

.banda-directo {
  align-items: center;
  background: linear-gradient(115deg, var(--coral) 0%, #ff9138 100%);
  border-bottom: 3px solid var(--ink);
  color: #fff;
  display: flex;
  gap: 12px;
  justify-content: center;
  padding: 12px 16px;
  text-decoration: none;
}

.banda-directo-llama {
  flex: none;
  height: 22px;
  width: 18px;
}

.banda-directo-llama svg {
  height: 100%;
  width: 100%;
}

html.js .banda-directo-llama {
  animation: llama 1.4s ease-in-out infinite;
  transform-origin: 50% 90%;
}

.banda-directo-texto {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
}

.banda-directo-texto strong {
  font-family: var(--font-display);
  font-size: 1.05rem;
}

.banda-directo-equipos {
  font-weight: 700;
}

.banda-directo-cta {
  flex: none;
  font-weight: 800;
  text-decoration: underline;
}

.banda-directo:hover .banda-directo-cta,
.banda-directo:focus-visible .banda-directo-cta {
  text-decoration-thickness: 3px;
}

/* La cabecera y su fondo son `fixed`: se apartan por el alto real de la banda. */
.header-backdrop {
  top: var(--banda-directo);
}

.site-header {
  top: calc(34px + var(--banda-directo));
}

@media (max-width: 560px) {
  /* En móvil la banda se apila: el reclamo, los equipos y la llamada. */
  .banda-directo {
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 10px 14px;
  }

  .banda-directo-texto {
    flex-direction: column;
    gap: 2px;
  }

  .banda-directo-texto strong {
    font-size: 0.98rem;
  }

  .banda-directo-cta {
    font-size: 0.86rem;
  }
}
```

**Ojo:** `.header-backdrop` tiene hoy `inset: 0 0 auto 0`, que fija `top: 0`. Poner `top` después no basta porque `inset` lo vuelve a escribir según el orden. Cambiar la declaración original a `inset: var(--banda-directo) 0 auto 0` en vez de añadir una regla nueva.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run --project unit test/unit/banda-directo.test.ts test/unit/directo-chip.test.ts test/unit/directo-sondeo.test.ts`
Expected: PASS los tres, con `directo-sondeo.test.ts` sin tocar.

- [ ] **Step 8: Verify in the browser at two widths**

Run: `npm run build && npx wrangler dev --port 8808`
Con un partido `live` en la base local, abrir `http://127.0.0.1:8808/` a 1280px y a 390px. Comprobar: la banda sale arriba, la cabecera queda debajo sin solaparse, el hero empieza tras la banda y al terminar el partido todo vuelve a su sitio.

- [ ] **Step 9: Commit**

```bash
git add src/components/BandaDirecto.astro src/pages/index.astro public/assets/directo.js src/styles/global.css test/unit/banda-directo.test.ts
git commit -m "feat(portada): banda de «estamos en directo» sobre el hero"
```

---

## Task 10: Documentación y cierre

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** ninguna.

- [ ] **Step 1: Rewrite the chip paragraph in `CLAUDE.md`**

En la sección «Público: `/torneo/` y el directo», el párrafo que empieza «**El botón del directo son dos elementos, no uno deshabilitado**» dice hoy:

> Encendido es un enlace que enseña **el marcador**, no la palabra «directo».

Esta rama lo **invierte**. Sustituir esa frase por:

```markdown
Encendido es un enlace que enseña **las siglas de quien juega** (`OST–PUL`), no el marcador
ni la palabra «directo»: sin saber de quién, un «12–9» no informa de nada, y el marcador está
a un toque. El `aria-label` tampoco lo lleva, y por una razón aparte: el enlace es
`aria-live="polite"`, así que con los puntos dentro un lector de pantalla cantaba **cada punto
del partido desde cualquier página del sitio**. Las siglas salen de `equipos.siglas`, y si
está vacío se derivan del nombre congelado del partido con `_lib/siglas.ts` — nunca se
desempatan solas: unas siglas que cambian el día que se inscribe un equipo parecido son peores
que un choque, porque nadie las ve cambiar.
```

- [ ] **Step 2: Add the new paragraphs to «Anotación en directo»**

```markdown
- **Anotar exige que el partido esté en directo, y eso lo decide una persona.** `sentenciasDerivadas`
  escribe `status = 'live'` en cada pliegue, así que el primer punto **publicaba el partido** —portada,
  chip de la cabecera y `/directo/`— sin confirmación y sin vuelta atrás desde el anotador. Ahora
  `registrarEvento` y `adoptarMarcador` lanzan `PartidoNoEnDirecto` si el partido no está `live`;
  adoptar también, porque escribe por el mismo pliegue y era la otra puerta al mismo agujero. Lo que
  **no** se bloquea: deshacer, corregir y recalcular (son reparaciones sobre un log que sólo pudo
  existir estando en directo) y **fijar la alineación**, que es la preparación previa al pitido.
  Publicar es `POST /api/anotacion {accion:"directo"}`, con el permiso que ya había (`partidos.anotar`),
  y en la pantalla lleva doble confirmación en **un** diálogo: dos seguidos en un móvil al sol se
  despachan a ciegas.
- **El cronómetro no añadió columnas: reinterpreta las de la migración 0003.** `started_at` es el
  inicio del **tramo en curso** (`NULL` = parado) y `elapsed_ms` el acumulado de los cerrados — que es
  exactamente lo que `elapsed()` de `match-utils.js` ya calculaba. Los tres estados se distinguen sin
  nada más: sin estrenar (`NULL` y 0), corriendo (fecha), pausado (`NULL` y > 0). De paso se arregló
  `sentenciasDerivadas`, que al cerrar el partido hacía `ahora − started_at` y **tiraba el acumulado**:
  no se notaba porque nada lo escribía antes del final, pero con la pausa cada partido parado entre
  sets habría reportado sólo su último tramo. `elapsedOnFinish` de `api/partidos.ts` siempre lo hizo
  bien: eran dos copias de la misma cuenta y una mentía.
- **El cerrojo del reloj es de cliente, y el de `live` de servidor, a propósito.** Los dos protegen
  cosas de distinto tamaño: publicar sin querer se ve desde fuera y se puede provocar entrando por
  URL; anotar con el reloj sin estrenar sólo deja mal la duración de un partido, y un 409 más sería
  otra forma de que la franja del pulgar se quede muerta a pie de pista. Sólo el **estreno** bloquea:
  la pausa nunca, porque está para el descanso entre sets.
```

- [ ] **Step 3: Add the paragraphs to «Público: `/torneo/` y el directo»**

```markdown
- **Las siglas van en la versión del directo, en `hex()`.** Se editan desde el panel pero viven en
  `equipos`, y `versionDirecto` agrega `partidos`: sin meterlas, corregir unas siglas durante el
  torneo no le llega a **nadie** —todos siguen con su 304 y el cuerpo viejo—, el mismo fallo que ya
  documentan los ajustes y el próximo partido. Van en `hex()` porque la versión acaba en una cabecera
  HTTP y una tilde ahí tira un `TypeError` que deja el directo entero caído. Es una subconsulta más
  dentro de la misma consulta de una fila: lee como mucho 4 filas de `equipos` y el camino barato
  (el 304) sigue costando lo mismo.
- **La banda de «estamos en directo» de la portada va en flujo, y aparta lo fijo con `--banda-directo`.**
  La cabecera es una píldora `position: fixed` con su fondo también fijo — es la razón documentada de
  que la banda de «ver como» se fuera abajo—, así que una banda arriba las deja por delante.
  `directo.js` **mide** el alto real al pintarla en vez de fijar un número: en móvil son dos líneas y
  un nombre largo puede hacer tres, y un 52px a ojo dejaría la cabecera pisando la banda. Es un
  suscriptor más del sondeo que ya había (el chip vive en la cabecera de esa misma página), así que
  no cuesta ni una petición nueva ni cambia la cadencia.
```

- [ ] **Step 4: Run the full gate**

Run: `npm run verify`
Expected: PASS entero — build, `astro check`, tipos de test y los tres proyectos.

Si `astro check` se queja de tipos en `functions/`, arreglarlos ahí; los ficheros de test se comprueban aparte con `npm run test:types`, que `verify` ya incluye.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: el cerrojo del directo, el cronómetro, las siglas y la banda de la portada"
```

- [ ] **Step 6: Integrate**

```bash
npm run integrar -- -m "El anotador decide cuándo se publica un partido, con cronómetro, y quien mira ve quién juega"
```

`integrar` mezcla `development`, corre `verify` y publica la rama. Si `verify` sale rojo, para ahí: no se integra nada en rojo. Si el push se rechaza por no ser fast-forward, otra sesión integró mientras tanto — se repite el ciclo entero, **incluido `verify`**.

**No promocionar a `main`.** Eso es su propia ceremonia y se pregunta antes.

---

## Notas de riesgo

1. **La Task 2 rompe tests existentes, y eso es la señal de que el guardia funciona.** `anotacion.test.ts`, `anotacion-estres.test.ts` y `cambios-estres.test.ts` siembran partidos y anotan sin publicarlos. Arreglarlos poniendo el partido en directo, nunca debilitando el guardia.
2. **`.header-backdrop` usa `inset`, no `top`.** Añadir una regla `top:` después no funciona de forma fiable; hay que cambiar el `inset` original (Task 9, Step 6).
3. **El presupuesto de alto del anotador estaba gastado** (742px medidos en una pantalla de 844). El reloj va en una fila que ya existía y el bloque de «no está en directo» ocupa el sitio de la pista, así que no debería crecer — pero hay que medirlo (Task 7, Step 7) y decirlo si crece.
4. **`test/unit/directo-sondeo.test.ts` no se toca.** Si alguna tarea lo obliga a cambiar, es que se ha alterado el presupuesto de peticiones de Cloudflare: parar y decirlo.
5. **`action: "start"` de `functions/api/partidos.ts:151` se queda como está.** Sigue poniendo `live` y `started_at` a la vez, que es la prerrogativa del panel: un partido abierto desde ahí llega al anotador con el reloj ya corriendo y el pop-up correctamente no sale. No "unificarlo" con las acciones nuevas.
6. **El CSS del anotador vive en `src/styles/anotador/index.css`, no en `global.css`.** Es la excepción que ya existía para `/admin/*`, aplicada también aquí. Los tokens son `--anot-*` colgados de `body.is-anotador`; `--anot-tenue` **no existe** (es `--anot-apagado`).
7. **`?accion=ficha` de `functions/api/admin/equipos.ts` está muerto desde el panel.** Ningún script lo llama. No es sitio para añadir campos nuevos sin cablearlo antes.
