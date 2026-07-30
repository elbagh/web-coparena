# Rediseño de las acciones del anotador

**Fecha:** 2026-07-30
**Rama:** `feature/anotador-acciones` (worktree `.worktrees/anotador-acciones`, slot 1)
**Estado:** diseño aprobado, pendiente de plan de implementación

## El problema

El catálogo de acciones del anotador nació copiado del volley de sala y no se
parece a lo que se anota a pie de pista en La Copa Arena:

- **`error` es genérico y atribuye lo que no toca.** Cuando el rival falla, hoy
  hay que registrar un `error` *del rival*, así que el anotador tiene que tocar
  a alguien del otro equipo para dar un punto al suyo. Al revés de como se mira
  un partido.
- **`bloqueo` siempre puntúa**, así que un bloqueo que solo levanta la pelota no
  se puede apuntar.
- **`defensa`** no se usa: no puntúa y nadie la anota entre punto y punto.
- **`remate`** no distingue nada, porque cualquier punto que no sea ace ni error
  acaba siendo un remate.

## El catálogo nuevo

| clave | etiqueta (botón) | ayuda | ¿punto? |
|---|---|---|---|
| `punto` | Punto | Gana el rally para su equipo | siempre, a su lado |
| `ace` | Ace | Punto directo de saque | siempre, a su lado |
| `saque_fallado` | Falló saque | El punto es del rival | siempre, **al rival** |
| `bloqueo` | Bloqueo | Bloqueo suyo | **pregunta** |
| `chilena` | Chilena | Chilena suya | **pregunta** |
| `ajuste` | — | saldo de apertura al adoptar | nunca |

Desaparecen `remate` (pasa a llamarse `punto`), `error` (lo sustituye
`saque_fallado`, el único error que se sigue anotando) y `defensa`.

**Todo punto se atribuye a alguien del equipo que lo gana**, con una única
excepción deliberada: el saque fallado, que se atribuye a quien lo falló y da el
punto al rival. Es la razón por la que `partido_eventos` sigue guardando los dos
lados y no uno.

## Decisión de arquitectura: quién decide si una acción puntúa

**`lado_punto` es lo único que lo dice, fila a fila.** La columna ya existe y
`NULL` ya significa «no puntuó» — es lo que hace que `plegarEventos` no cambie ni
una línea:

```ts
if (!evento.lado_punto) return estado;   // ya está así hoy
```

El mapa fijo `PUNTUA: Record<TipoEvento, boolean>` se sustituye por un catálogo
con dos ejes:

```ts
{ clave: "bloqueo", punto: "pregunta", aRival: false }
{ clave: "saque_fallado", punto: "siempre", aRival: true }
```

El cliente manda `punto: true | false` **solo** con los tipos que preguntan. El
servidor sigue calculando `lado_punto` y **nunca lo acepta del cliente**:
invertirlo es trivial y el daño (marcador y estadísticas cruzados) no se vería
hasta el final del torneo.

De regalo, `estadisticasDeEventos` se simplifica: `puntos` pasa a ser
`lado_punto === lado_jugador` a secas, sin consultar ningún mapa.

### Alternativas descartadas

**Dos claves por acción** (`bloqueo` / `bloqueo_punto`, `chilena` /
`chilena_punto`). Mantendría `PUNTUA` como mapa fijo y el diálogo de corregir
seguiría siendo elegir de una lista. Pero son cuatro claves para dos acciones, la
ficha tendría que sumar dos columnas para decir «Bloqueos», y el historial
público enseñaría dos etiquetas distintas para la misma cosa.

**Una columna `puntua` propia en `partido_eventos`.** Redundante con
`lado_punto`, que ya es NULL o no. Dos sitios que afirman el mismo hecho acaban
discrepando, y el que discrepa aquí descuadra el marcador.

## Datos

### Migración 0028

Reconstrucción de `partido_eventos`, porque SQLite no sabe alterar un `CHECK`.
El riesgo está acotado y conviene dejarlo escrito: **ninguna tabla apunta a
`partido_eventos` con clave ajena.** `partido_cambios.tras_orden` no lo es a
propósito (el punto al que se ancló un cambio se puede deshacer y el cambio
siguió ocurriendo) y `estadisticas.partido_id` cuelga de `partidos`. Lo único que
hay que rehacer son sus dos índices, incluido el
`UNIQUE(partido_id, orden)` que serializa a dos anotadores.

El fichero se aplica entero de una vez y sin transacción, así que cada sentencia
tiene que poder pasar por encima de lo que dejó un intento anterior — misma
disciplina que la 0012 (`DROP TABLE IF EXISTS ..._nueva` al principio).

Las filas se copian **mapeadas**, para que el copiado no pueda violar el CHECK
nuevo aunque queden restos de pruebas:

| viejo | nuevo | efecto en el marcador |
|---|---|---|
| `remate` | `punto` | ninguno (mismo significado) |
| `ace` | `ace` | ninguno |
| `bloqueo` | `bloqueo` | ninguno: llevaban `lado_punto`, que viaja tal cual |
| `error` | `saque_fallado` | ninguno: `lado_punto` ya apuntaba al rival |
| `defensa` | `bloqueo` | ninguno: no puntuaba, `lado_punto` era NULL |
| `ajuste` | `ajuste` | ninguno |

`lado_punto` se copia sin tocar en todos los casos, así que **ningún marcador se
mueve**. Ese es el criterio del mapeo: no hay ninguno honesto para `defensa`, así
que se elige el que no altera nada.

En el mismo fichero, `estadisticas` gana dos columnas:

```sql
ALTER TABLE estadisticas ADD COLUMN chilenas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE estadisticas ADD COLUMN saques_fallados INTEGER NOT NULL DEFAULT 0;
```

**`remates`, `defensas` y `errores` no se borran aquí.** Una migración se aplica
*antes* de que despliegue el código nuevo, así que durante esos segundos el
código viejo sigue haciendo `INSERT ... (puntos, remates, bloqueos, aces,
defensas, errores)`. Se quedan a 0, dejan de leerse, y caen en una migración
posterior — misma pauta que `is_admin` (0022) y que `perfiles` (0024).

### La ventana del despliegue

El `CHECK` nuevo **no** admite los valores viejos, así que durante los segundos
que tarda el deploy el código viejo que intentara escribir `'remate'` recibiría
una violación de restricción. Es aceptable con una condición explícita: **la
promoción a `main` se hace con nadie anotando.** El torneo es del 31 de julio al
2 de agosto de 2026; esto se promueve antes de que empiece o entre jornadas,
nunca a media pista.

La alternativa —CHECK unión ahora y estrecharlo después— se descartó porque
obliga a reconstruir dos veces la tabla más sensible del sistema para cubrir una
ventana que se puede elegir.

## La pantalla del anotador

El flujo pasa de dos toques a **dos o tres**, según el tipo.

### Segundo toque: la botonera, en dos grupos

```
Elegido: Berta  (equipo A)

── Suman punto ──────────────────
┌────────────┐  ┌────────────┐
│   Punto    │  │    Ace     │
└────────────┘  └────────────┘
┌──────────────────────────────┐
│  Falló saque  → punto rival  │
└──────────────────────────────┘

── Solo estadística ─────────────
┌────────────┐  ┌────────────┐
│  Bloqueo   │  │  Chilena   │
└────────────┘  └────────────┘
```

El doble filo de tinta y la flecha `⇢` se quedan en «Falló saque»: sigue siendo
el único que cruza el punto a la otra mitad, y esa marca existe justo para que no
se confunda con un acierto en un toque rápido. `.anot-btn--defensa` (borde
discontinuo) desaparece como tal y el borde discontinuo pasa a distinguir el
**grupo** que no puntúa.

### Tercer toque: la pregunta, en el mismo hueco del pulgar

```
Bloqueo de Berta

┌────────────┐  ┌──────────────────┐
│  Sí, punto │  │ No, sigue el rally│
└────────────┘  └──────────────────┘
                          [Cancelar]
```

Sustituye a la botonera de tipos, **sin ampliar la franja**. Es exactamente la
gramática que ya existe para los cambios (tocar suplente → «¿por quién entra?»),
así que no hay nada nuevo que aprender a pleno sol.

Esto importa porque el alto del móvil ya está gastado: el panel mide 742px + 60
de barra en una pantalla de 844. **El tercer paso reutiliza el hueco del
segundo**; si mide más que la botonera de cinco tipos, el diseño está mal.

La pintada optimista se retrasa al tercer toque para `bloqueo` y `chilena`, y se
queda donde está para los otros tres. `predecir(tipo)` pasa a `predecir(tipo,
punto)`.

## Corregir un evento

El diálogo de corrección gana el sí/no cuando el tipo elegido pregunta.

`corregirEvento` recibe `cambios.punto?: boolean` y resuelve:

```ts
const puntua = cambios.punto ?? (actual.lado_punto !== null);
```

Es decir: si no se dice nada, **se conserva lo que la fila ya afirmaba**, que es
lo que no mueve el marcador por accidente al corregir solo el autor. Corregir un
bloqueo de «no» a «sí» sí puede reabrir un set o un partido — ya pasaba con los
tipos, y por eso `accionCorregir` llama a `sincronizarCuadro`.

## Estadísticas y ficha pública

`METRICAS` en `functions/_lib/estadisticas.ts` queda en seis:

| clave (API) | columna | etiqueta |
|---|---|---|
| `partidosJugados` | `COUNT(DISTINCT partido_id)` | Partidos |
| `puntos` | `puntos` | Puntos |
| `bloqueos` | `bloqueos` | Bloqueos |
| `chilenas` | `chilenas` | Chilenas |
| `aces` | `aces` | Aces |
| `saquesFallados` | `saques_fallados` | Saques fallados |

Se van «Remates» (lo absorbe «Puntos») y «Defensas».

La sentencia agregada de `sentenciasDerivadas` pierde la lista de tipos en el
`CASE` de puntos:

```sql
SUM(CASE WHEN lado_punto = lado_jugador THEN 1 ELSE 0 END) AS puntos
```

`ajuste` no tiene `lado_punto` y además ya está excluido por el `WHERE`, así que
la simplificación no cambia ninguna cifra.

`METRICA_DE_TIPO` queda: `punto → null` (no tiene columna propia, se cuenta en
`puntos`), `ace → aces`, `saque_fallado → saques_fallados`, `bloqueo →
bloqueos`, `chilena → chilenas`, `ajuste → null`.

### `estadisticasDeEventos` es el oráculo, y hoy tiene un import muerto

`estadisticasDeEventos` en `marcador.ts` es una segunda implementación, en TS, de
esa misma sentencia SQL. Comprobado: **fuera de `test/unit/marcador.test.ts` no
la usa nadie**; `eventos.ts` la importa y no llega a llamarla nunca — el trabajo
lo hace el agregado.

Se conserva, con su papel escrito: es el **oráculo legible** contra el que se
contrasta el SQL, que es lo que hace que un `CASE` mal puesto salga en un test en
vez de en el álbum de septiembre. Lo que sí se quita es el import muerto de
`eventos.ts`, porque una copia importada y no usada parece la fuente de verdad
sin serlo.

## Directo público

Casi nada. El feed sondeado solo lleva la clave del tipo (`t`) y las etiquetas
viajan en `GET /api/plantilla`, que se pide una vez por partido y se cachea 300 s:
las nuevas llegan solas desde `TIPOS`.

Un bloqueo que no puntúa ya se pinta bien sin tocar nada: `marcadoresDelSet` solo
asigna parcial a las líneas con `linea.p`, así que esa línea sale con «Set 2» en
vez de un marcador. Es correcto — no hubo punto.

Lo que sí hay que cambiar es el texto de `/directo/`, que hoy dice «cada punto,
cada bloqueo, cada error y cada cambio».

## Ficheros que se tocan

**Servidor**
- `db/migrations/0028_*.sql` — nuevo
- `functions/_lib/marcador.ts` — `TipoEvento`, el catálogo, `ladoDelPunto`,
  `METRICA_DE_TIPO`, `EstadisticasJugador`, `estadisticasDeEventos`
- `functions/_lib/eventos.ts` — `TIPOS_ANOTABLES`, `validarEvento`,
  `corregirEvento`, el SQL de `sentenciasDerivadas`, fuera el import muerto de
  `estadisticasDeEventos`
- `functions/_lib/estadisticas.ts` — `METRICAS`
- `functions/api/anotacion.ts` — `accionEvento` y `accionCorregir` pasan `punto`

**Cliente**
- `public/assets/anotador/partido.js` — tercer toque, `predecir`, diálogo de
  corregir
- `src/pages/anotador/partido.astro` — el marcado del tercer paso
- `src/styles/anotador/index.css` — grupos, `--saque_fallado`, fuera `--defensa`
- `public/assets/players-list.js` — `METRICAS` (copia a mano) y `RANKING`
- `public/assets/admin/estadisticas.js` — `COLUMNAS_TABLA`
- `public/assets/perfil.js` — `resumenEstadisticas`
- `src/pages/directo.astro` — copy

**No se tocan:** `public/assets/cromo.js` y `functions/_lib/perfil.ts`. Sus
`remate` / `bloqueo` / `defensa` son los **atributos 1–99 de la carta**, otra cosa
completamente, y `paridad-validacion.test.ts` los vigila aparte.

## Tests

- `test/unit/marcador.test.ts` — el pliegue con bloqueo que puntúa y bloqueo que
  no; `ladoDelPunto` del saque fallado.
- `test/integration/anotacion.test.ts` — falta `punto` en un tipo que pregunta →
  400 con campo; `saque_fallado` da el punto al rival y suma a la ficha del que
  falló, no a la del que lo recibe; bloqueo sin punto no mueve el marcador pero
  sí suma un bloqueo; corregir un bloqueo de «no» a «sí» reabre el marcador y
  arrastra el cuadro.
- `test/unit/anotador-partido.test.ts` — el tercer toque existe y cae en la
  franja del pulgar.
- `test/unit/paridad-validacion.test.ts` — `METRICAS` servidor ↔ `players-list.js`.
- `test/integration/anotacion-estres.test.ts` — **cuenta consultas**: el tercer
  toque no puede añadir ninguna. Es el test que fija que el coste de anotar no
  crece con lo anotado.
- `test/helpers/db.ts` — el helper de estadísticas escribe las columnas nuevas.

Los tests que hoy usan `remate` / `defensa` / `error` hay que **releerlos**, no
renombrarlos a ciegas: alguno afirma cosas sobre el error genérico que ya no
tienen sentido, y un test que hubo que debilitar para que siguiera pasando es un
hallazgo, no una tarea.

`test/integration/setup.ts` no necesita cambios: no hay tablas nuevas.

## Documentación

`CLAUDE.md`, sección «Anotación en directo», tiene al menos tres párrafos que
quedan desactualizados y que hay que reescribir, no solo retocar:

- «With `tipo='error'` they **differ**» → ahora es `saque_fallado`.
- «`TIPOS` carries `puntua` and `alRival`, built from `PUNTUA`» → el modelo nuevo.
- La mención a «anotar una `defensa`» en el párrafo de `partidos.log_version`.

## Fuera de alcance

- Los atributos 1–99 del cromo.
- El formato y las reglas del torneo (`_lib/reglas.ts`).
- Borrar `remates`, `defensas` y `errores` de `estadisticas`: va en una migración
  posterior, un release después.
