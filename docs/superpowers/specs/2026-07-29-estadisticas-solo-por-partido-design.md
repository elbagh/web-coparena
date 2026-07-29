# Estadísticas sólo por partido — Diseño

**Fecha:** 2026-07-29
**Rama:** `feature/estadisticas-solo-por-partido` (cortada de `development`)

## Objetivo

Que las estadísticas de juego de un jugador —puntos, remates, bloqueos, aces, defensas, errores— **no puedan existir salvo colgando de un partido**. Lo que se ve en el álbum deja de ser una cifra tecleada y pasa a ser, por construcción, el sumatorio de los partidos que esa persona ha jugado.

La regla se pone en la base de datos, no en un endpoint: una fila de `estadisticas` sin `partido_id` deja de ser representable.

## Cómo está hoy

`estadisticas` se diseñó (migración 0009) para admitir dos orígenes:

- `partido_id IS NULL` — la **carga manual** de la edición. Es lo único que existe.
- `partido_id NOT NULL` — lo que registraría el sistema de resultados por partido. Nadie escribe ahí.

La carga manual se teclea en `/admin/estadisticas/` y la guarda `PATCH /api/admin/estadisticas?jugador=N` a través de `sentenciaCargaManual()`. Todas las lecturas (`totalesPorJugador`, `/api/jugadores`, `/api/perfil`) ya agregan con `SUM(...)`, así que la forma de las consultas no es el problema: el problema es que existe una vía de escritura que no responde a ningún partido.

## Alcance

### Entra en este trabajo

El **cerrojo**: cerrar la vía manual, en la base y en la API, y dejar el panel coherente con eso.

### Se aplaza a un segundo spec (fase 2)

Todo lo que toca partidos:

- La **ficha del partido** (`GET`/`PUT /api/admin/estadisticas?partido=X`) y su diálogo en `/admin/torneo/`.
- El **selector de equipos** en el alta de partido, que es lo que rellena `partidos.equipo_a_id` / `equipo_b_id` y sin lo cual no hay plantilla que listar.
- La casilla **«Jugó»** por jugador.
- **Quitar el sorteo** (`action: "draw"`, `crearEmparejamientos`, `sortearDesdeDb`, `reemplazarPartidos`, la previsualización y el pool de equipos) y **quitar «Vaciar cuadro»** (`DELETE /api/partidos?todos=1`).
- La **captura en vivo**, punto a punto, que es un módulo posterior incluso a la fase 2.

**Por qué el sorteo puede esperar.** `estadisticas.partido_id` es `ON DELETE CASCADE`, y tanto el sorteo como «Vaciar cuadro» hacen `DELETE FROM partidos` sin filtro: en cuanto existan fichas, rehacer el cuadro pondría el álbum a cero en silencio. Es un peligro real, pero **sólo a partir de la fase 2**: mientras no haya ninguna estadística colgando de un partido, no hay nada que ese borrado pueda llevarse. La eliminación viaja con la fase 2, que es cuando empieza a hacer falta.

## Decisiones

| Decisión | Motivo |
|---|---|
| El cerrojo va en la base (`partido_id NOT NULL`), no sólo en el endpoint | Una garantía que depende de que nadie vuelva a añadir un `INSERT` no es una garantía. Con la restricción puesta, ni un error de código ni un `wrangler d1 execute` a mano pueden crear una cifra huérfana. |
| `partidos_jugados` deja de ser columna y pasa a contarse | `COUNT(DISTINCT partido_id)`. Deja de ser un número que teclear y no puede desincronizarse de las filas que lo sostienen: si tiene ficha en tres partidos, ha jugado tres. |
| `/admin/estadisticas/` conserva las cifras **en sólo lectura** | Siguen siendo el dato de referencia para valorar a alguien; lo que desaparece son los campos editables. La sección sigue existiendo para lo que sí pone la organización a mano: atributos 1–5 y visibilidad en el álbum. |
| Un `PATCH` con `estadisticas` en el cuerpo se **ignora en silencio** | Es el patrón que ya usa `PATCH /api/perfil` con `atributos`. Lo que lo convierte en garantía y no en descuido es el test que lo comprueba. |
| Se **eliminan** `validarEstadisticas()` y `MAX_METRICA` | Tras el cerrojo, ningún endpoint acepta cifras: un validador de cifras sería código muerto sostenido sólo por su test. La fase 2 lo reintroduce con la forma que pida la ficha real (y con un tope por partido, no por edición: 9999 era el tope de una edición entera). |
| La migración es la **0012**, no la 0011 | `feature/capitan-equipo` tiene una `0011_capitan.sql` sin mergear en `development`. Numerar 0011 crearía dos migraciones con el mismo número al juntarse las ramas. |

## Modelo de datos

### `db/migrations/0012_estadisticas_por_partido.sql`

SQLite no sabe volver `NOT NULL` una columna existente, así que la tabla se recrea:

```sql
-- Migration number: 0012 	 estadisticas solo por partido
-- Una estadistica solo puede existir colgando de un partido. La carga manual de
-- la edicion (partido_id IS NULL) desaparece: era la unica via de escritura y
-- permitia teclear cifras que no respondian a ningun partido jugado.
--
-- `partidos_jugados` deja de ser columna. Se deriva contando partidos con ficha,
-- de modo que no puede desincronizarse de las filas que la sostienen.

DELETE FROM estadisticas WHERE partido_id IS NULL;

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
-- carga manual (idx_estadisticas_manual) se va con la fila que vigilaba.
CREATE UNIQUE INDEX idx_estadisticas_partido ON estadisticas (jugador_id, partido_id);
CREATE INDEX idx_estadisticas_jugador ON estadisticas (jugador_id);
CREATE INDEX idx_estadisticas_por_partido ON estadisticas (partido_id);
```

Notas:

- El `DELETE` previo es seguro: en producción no hay ninguna estadística cargada. Aun así va explícito, porque el `INSERT ... SELECT` fallaría contra el `NOT NULL` si existieran.
- `DROP TABLE` se lleva por delante sus propios índices; no hay que borrarlos a mano.
- Ninguna otra tabla apunta a `estadisticas`, así que el `RENAME` no tiene referencias externas que reescribir.
- El índice por `partido_id` no lo necesita la fase 1 (nadie consulta por partido todavía). Va ahora porque es el que sostendrá la ficha y porque recrear la tabla es el momento natural de dejarla con sus índices definitivos.

## `functions/_lib/estadisticas.ts`

Una sola lista literal. `columna` se mantiene **siempre rellena** —es el nombre con el que el valor llega en la fila agregada— y lo que se marca aparte es que la métrica no se almacena:

```ts
export interface Metrica {
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

/** Las que se registran en un partido: las únicas que llegan a una columna real. */
export const METRICAS_PARTIDO = METRICAS.filter((m) => !m.derivada);
```

**Por qué `columna` no puede ser `null`.** `mapEstadisticas()` recorre `METRICAS` y lee `fila[m.columna]`. Con `columna: null` leería `fila[null]`, obtendría `undefined` y dejaría `partidosJugados` a cero siempre — un fallo silencioso, porque el resto de métricas seguirían cuadrando. La columna sigue existiendo en la fila que devuelve la consulta: es el alias del `COUNT`. Lo que la distingue no es que le falte columna, sino que nadie la escribe. De ahí `derivada`.

**La dirección de la derivación importa.** `paridad-validacion.test.ts` lee el literal de `METRICAS` con una expresión regular y lo compara con el de `players-list.js`. Si `METRICAS` se compusiera a partir de un *spread* de `METRICAS_PARTIDO`, la regex sólo vería una entrada y el test fallaría por la forma del código, no por una divergencia real. Derivando hacia abajo, **`players-list.js` no se toca** y el test sigue vigilando lo que debe.

`SUMA_METRICAS` cuenta la derivada en vez de sumar la columna que ya no existe, y sigue recorriendo `METRICAS` entera para que el orden y los alias no dependan de dos listas:

```ts
export const SUMA_METRICAS = METRICAS.map((m) =>
  m.derivada
    ? `COUNT(DISTINCT e.partido_id) AS ${m.columna}`
    : `COALESCE(SUM(e.${m.columna}), 0) AS ${m.columna}`
).join(", ");
```

`mapEstadisticas`, `sumarTotales`, `hayEstadisticas`, `estadisticasVacias` y `totalesPorJugador` **no cambian**: siguen trabajando sobre `METRICAS` y sobre las mismas claves de siempre.

Se eliminan `sentenciaCargaManual()`, `validarEstadisticas()` y `MAX_METRICA`.

### Un matiz de `sumarTotales`

`sumarTotales` suma objetos ya agregados, y con `partidosJugados` eso sigue siendo correcto para el uso que tiene: en `/api/jugadores`, la carrera de una persona se calcula sumando sus ediciones, y un partido pertenece a una sola edición, así que no hay doble conteo posible.

## `functions/api/admin/estadisticas.ts`

- **`GET`** — la respuesta mantiene exactamente su forma. Lo único que cambia es de dónde sale `estadisticas` de cada jugador: la función local `cargasManuales()` (que filtraba `partido_id IS NULL`) se sustituye por `totalesPorJugador()`, la misma que ya usa el álbum público. Su comentario «solo la fila manual, no la suma» pierde su motivo: ahora sólo hay suma.
- **`PATCH ?jugador=N`** — deja de leer `body.estadisticas` y de llamar a `sentenciaCargaManual`. Guarda atributos y `ocultoPublico`. La respuesta sigue devolviendo `estadisticas` (releídas, ahora los totales), para que el panel repinte sin recargar.

No hay endpoint nuevo en esta fase.

## Panel `/admin/estadisticas/`

- **`src/pages/admin/estadisticas.astro`**: el contenedor `[data-stats-metricas]` deja de ser un formulario. Pasa a ser un bloque de lectura con las cifras y una línea que explica su origen.
- **`public/assets/admin/estadisticas.js`**: `campoNumero()` se sigue usando para los atributos (1–5) pero ya no para las métricas; el `recoger("metrica")` desaparece del guardado, igual que el remapeo de errores `estadisticas.* → metrica.*` en el `catch`.
- La tabla no cambia: sigue mostrando puntos, remates, bloqueos y aces por jugador.

Texto del diálogo:

> **Estadísticas de la edición** — Puntos 0 · Remates 0 · Bloqueos 0 · Aces 0 · Defensas 0 · Errores 0
> Salen de los partidos jugados. Se cargarán partido a partido.

Los estilos van en `src/styles/admin/dialog.css` o `forms.css` según dónde encaje el bloque, con los tokens `--adm-*` existentes. Se comprueba en móvil (media queries de 900 px y 560 px).

## Lo que no cambia

- `/jugadores/`, `/mi-equipo/` y `/api/perfil`: leen totales agregados y los seguirán leyendo igual.
- `public/assets/players-list.js`: su lista de métricas sigue siendo válida; `partidosJugados` sigue en la respuesta, sólo cambia de dónde sale.
- `jugador_atributos` y `oculto_publico`: son cosa de la organización, no del juego, y se siguen editando a mano. Nada en este spec los toca.

## Casos límite

| Caso | Comportamiento |
|---|---|
| Todas las cifras a cero (fase 1 entera) | `hayEstadisticas()` devuelve `false` y `/jugadores/` ya se salta los bloques vacíos. No hace falta nada nuevo. |
| `PATCH ?jugador=N` con `estadisticas` en el cuerpo | Se ignora; el resto del cuerpo se guarda con normalidad. Respuesta 200. |
| Borrar un partido | Se lleva sus estadísticas por `ON DELETE CASCADE`. Es la semántica correcta y es la que hace que los totales no puedan quedar apuntando a un partido inexistente. |
| Mover un jugador de equipo desde el panel | Sus fichas anteriores no se mueven: cuelgan de `jugador_id` y de un partido, no del equipo. Correcto. |
| Borrar un jugador | `ON DELETE CASCADE` sobre `jugador_id`, ya existente. Sin cambios. |

## Testing

### `test/helpers/db.ts`

- `crearEstadistica(jugadorId, partidoId, valores)` — el partido pasa a **segundo parámetro y obligatorio** (hoy es el tercero, opcional, con `null` por defecto). Cambia de orden porque en TypeScript un parámetro obligatorio no puede ir detrás de uno con valor por defecto. Desaparece `partidos_jugados` de su `INSERT`.
- **`crearPartido()`** — nuevo en los helpers compartidos. Ya existe un `sembrarPartido()` local al final de `jugadores-publico.test.ts`: se sube a `test/helpers/db.ts`, se le añaden la edición y los equipos opcionales, y el local se borra.

`partidos` ya está en la lista `TABLAS` de `test/integration/setup.ts`, así que sembrar partidos no filtra estado entre tests.

### `test/unit/estadisticas.test.ts`

- `SUMA_METRICAS` cuenta partidos con `COUNT(DISTINCT e.partido_id)` y no menciona una columna `partidos_jugados`.
- `METRICAS_PARTIDO` deja fuera la derivada y conserva las seis columnas.
- `METRICAS` sigue teniendo las siete claves que espera el cliente.
- Se retiran las pruebas de `validarEstadisticas`, que desaparece.

### `test/integration/estadisticas-admin.test.ts`

- **La prueba del cerrojo**: un `INSERT INTO estadisticas` con `partido_id NULL` **falla contra la base real**. Es el único test que demuestra que la regla no depende del endpoint; es el más importante del lote.
- `PATCH ?jugador=N` con cifras en el cuerpo **no las guarda**: los totales siguen siendo los de los partidos.
- `PATCH` sigue guardando atributos y `ocultoPublico`.
- `GET` devuelve la suma de filas de **varios partidos distintos**, y `partidosJugados` vale el número de partidos, no el de filas.
- Sigue exigiendo admin (`requireAdmin`).

### `test/integration/jugadores-publico.test.ts` y `perfil.test.ts`

Pasan a colgar sus cifras de partidos sembrados. Son los tests que más dicen si el cambio está bien pensado, porque son los que **leen**: si los totales del álbum siguen saliendo bien con las filas colgando de partidos, la sustitución es correcta.

### `test/unit/paridad-validacion.test.ts`

Sin cambios previstos. Que siga verde sin tocarlo es parte de la comprobación: significa que el literal de `METRICAS` no se ha deformado.

### `test/unit/album-jugadores.test.ts`

Revisar: si siembra estadísticas para probar el pintado, sus datos de entrada siguen valiendo (son objetos ya agregados, no filas).

## Verificación

`npm run verify` en verde antes de mezclar con `development`, según la regla del repositorio.

## Riesgos

- **Colisión de migraciones con `feature/capitan-equipo`.** Esa rama trae una `0011_capitan.sql` sin mergear. Esta usa la 0012 precisamente por eso. Si `capitan-equipo` se mezcla antes, no hay conflicto; si se mezclara después y alguien renumerase, habría que revisarlo.
- **El álbum queda a cero hasta la fase 2.** Es consecuencia buscada del alcance, no un efecto secundario: no habrá cifras publicables hasta que exista la ficha del partido.

## Fuera de alcance

La fase 2 (ficha del partido, selector de equipos, casilla «Jugó», eliminación del sorteo y de «Vaciar cuadro») tendrá su propio spec. La captura en vivo punto a punto es posterior a ambas.
