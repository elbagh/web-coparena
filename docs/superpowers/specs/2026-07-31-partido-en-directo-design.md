# Poner el partido en directo, el cronómetro y quién juega

Fecha: 2026-07-31 · Rama: `feature/partido-en-directo`

## El problema

Hoy **anotar el primer punto publica el partido**, en silencio. `sentenciasDerivadas`
([functions/_lib/eventos.ts:274](../../../functions/_lib/eventos.ts)) escribe
`status = terminado ? "finished" : "live"` en cada pliegue, así que un partido `scheduled`
aparece en la portada, en el chip de la cabecera y en `/directo/` en cuanto alguien toca un
botón para probar. No hay confirmación, no hay vuelta atrás desde el anotador, y quien anota
no tiene forma de saber que acaba de emitir.

Además:

- **No hay cronómetro.** `partidos.started_at` y `partidos.elapsed_ms` existen desde la
  migración 0003, pero `started_at` solo lo escribe «Iniciar partido» del panel y `elapsed_ms`
  solo se escribe al terminar. Nada enseña un reloj corriendo.
- **El chip de la cabecera no dice quién juega.** Enseña `12–9`, que sin saber de quién no
  informa de nada.
- **La portada no se entera de que hay torneo.** Quien entra a `lacoparena.es` un sábado de
  agosto con un partido en juego no ve ni rastro.

## Decisiones tomadas

1. **Poner en directo y arrancar el cronómetro son dos gestos**, no uno.
2. **La sigla se guarda si la organización la escribe, y se deriva del nombre si no.**
3. **El chip pierde el marcador** y pasa a decir quién juega: se entra para ver cómo van.
4. **La banda de la portada va encima del hero**, a todo el ancho.

---

## 1. Modelo de datos

### Migración 0028

```sql
ALTER TABLE equipos ADD COLUMN siglas TEXT;
```

Anulable y **sin backfill**: `NULL` significa «derívalas del nombre». Aditiva, como pide el
orden de despliegue (migraciones antes que código).

### El cronómetro no necesita columnas nuevas

Se reinterpretan las dos que ya hay, con la semántica que
[public/assets/match-utils.js:159](../../../public/assets/match-utils.js) **ya implementa**:

| Estado | `started_at` | `elapsed_ms` |
|---|---|---|
| Nunca arrancado | `NULL` | `0` |
| Corriendo | instante del arranque del tramo | acumulado de tramos cerrados |
| Pausado | `NULL` | `> 0` |

`started_at` pasa a ser *el inicio del tramo en curso*, no «cuándo empezó el partido». El
tiempo total es siempre `elapsed_ms + (ahora − started_at)` cuando corre, y `elapsed_ms`
cuando no.

La fila «nunca arrancado» es la que distingue el pop-up: solo sale con el reloj **sin
estrenar**, nunca con uno pausado a propósito.

### Bug que hay que arreglar de paso

[functions/_lib/eventos.ts:253](../../../functions/_lib/eventos.ts) calcula mal el tiempo al
cerrar el partido:

```ts
// mal: tira el acumulado
const elapsed = estado.terminado && partido.started_at
  ? Math.max(0, Date.now() - new Date(partido.started_at).getTime())
  : partido.elapsed_ms;
```

Debe ser `partido.elapsed_ms + (ahora − started_at)`.
[functions/api/partidos.ts:488](../../../functions/api/partidos.ts) (`elapsedOnFinish`) ya lo
hace bien: son dos copias de la misma cuenta y una está equivocada. Hoy no se nota porque
`elapsed_ms` siempre vale 0; en cuanto exista la pausa, **todo partido pausado reportaría mal
su duración**.

---

## 2. Servidor

### El cerrojo

Excepción nueva en [functions/_lib/eventos.ts](../../../functions/_lib/eventos.ts), junto a
las que ya viven ahí:

```ts
export class PartidoNoEnDirecto extends ErrorDeAnotacion {
  constructor() {
    super("Este partido no está en directo. Ponlo en directo para poder anotar.", 409);
  }
}
```

**La lanzan `registrarEvento` y `adoptarMarcador`** cuando `partido.status !== "live"`.

- `adoptarMarcador` también, porque escribe por el pliegue: sin guardia, adoptar un partido
  `scheduled` con puntos puestos a mano desde el panel lo publicaría igual. Es el mismo
  agujero por la otra puerta.
- **No** la lanzan `deshacerUltimo`, `corregirEvento`, `deshacerCambio` ni `recalcularPartido`:
  son reparaciones sobre un log que solo pudo existir estando en directo, y bloquearlas
  dejaría atrapado a quien tiene que arreglar algo.
- **No** la lanza `fijarAlineacion`: marcar quién sale a pista es preparación previa y tiene
  sentido hacerla antes del pitido.

`sentenciasDerivadas` **se queda como está**. Escribir `live` estando ya en directo no cambia
nada, y deshacer el punto que cerró un partido tiene que devolverlo a `live`. Quitar `status`
del pliegue dejaría sin dueño la transición `live → finished` del último set, que hoy es
correcta y gratuita.

### Acciones nuevas en `POST /api/anotacion?partido=ID`

Ambas con el permiso que ya existe, **`partidos.anotar`**. No hay permiso nuevo ni migración
de roles: `partidos.anotar` ya significa «quien lleva el marcador de lo que se está jugando».

#### `{ accion: "directo" }`

```
scheduled → live      status = 'live', updated_at = ahora
```

- 409 si el partido ya está `live` o `finished`.
- **No toca `started_at` ni `elapsed_ms`.** El reloj es el otro gesto.
- No propaga al cuadro: abrir un partido no cambia ningún resultado.

#### `{ accion: "cronometro", marcha: true | false }`

| `marcha` | Efecto |
|---|---|
| `true` | `started_at = ahora` (solo si era `NULL`; si ya corre, no-op idempotente) |
| `false` | `elapsed_ms = elapsed_ms + (ahora − started_at)`, `started_at = NULL` |

- 409 si el partido no está `live`: no hay reloj de un partido que no ha empezado.
- Sube `log_version` en las dos, para que el ETag del directo no mienta (§4).

### `action: "start"` del panel se queda como está

[functions/api/partidos.ts:151](../../../functions/api/partidos.ts) sigue poniendo `live` y
`started_at` a la vez. Es la prerrogativa del panel y no rompe nada: un partido abierto desde
ahí llega al anotador con el reloj ya corriendo, y entonces el pop-up correctamente no sale.

### Las siglas

**`functions/_lib/siglas.ts`**, un solo sitio:

```ts
export function derivarSiglas(nombre: string): string
```

Reglas, en orden:

1. Normalizar espacios y partir en palabras.
2. Descartar enlaces (`de do da del la el los las os as y e`), salvo que no quede ninguna.
3. Si las iniciales de lo que queda llegan a **3**, esas son las siglas (tope 4).
4. Si no, las **3 primeras letras** de la primera palabra con peso.
5. Siempre en mayúsculas. Si el nombre da menos de 3 caracteres, se usa lo que haya.

| Nombre | Iniciales | Sigla |
|---|---|---|
| Rayo Vallecano Beach | RVB | `RVB` |
| Ostreiros do Pozo | OP | `OST` |
| Os Pulpos | P | `PUL` |
| Ganador SF1 | GS | `GAN` |

**Se resuelve contra el nombre congelado del partido**, no contra `equipos.nombre`:

```
COALESCE(equipos.siglas, derivarSiglas(partidos.equipo_a_nombre))
```

Misma razón por la que el cuadro pinta el nombre congelado, y así un cruce que todavía no
tiene equipo asignado también sale con sigla legible.

### El campo en el panel

`/admin/equipos/`: entrada `siglas`, 2–4 caracteres, opcional. Validación en
`functions/api/admin/equipos.ts` y en `public/assets/admin/equipos.js`.

**No entra en `/inscripcion/`**: esto lo cura la organización, no el equipo que se apunta.
Por eso tampoco toca `validarRegistro` de `_lib/validacion.ts` ni el test de paridad de los
cuatro scripts de cliente.

---

## 3. El anotador (`/anotador/partido/`)

### Los tres estados de la pantalla

| Estado | Pista | Franja del pulgar | Qué se ofrece |
|---|---|---|---|
| `scheduled` | **oculta** | oculta | «Poner en directo» (§ abajo) |
| `live`, reloj sin estrenar | visible | visible | «Iniciar cronómetro»; tocar un punto abre el pop-up |
| `live`, reloj estrenado | visible | visible | anotar, con el reloj arriba |

En el primero la pista se oculta porque sus botones responderían 409 — el patrón que ya usa
`anot-decision`. En el segundo **no**: ahí anotar sí es posible en cuanto se arranque el reloj,
y esconder la pista obligaría a repintarla justo en el momento de más prisa.

### Estado «todavía no está en directo»

Ocupa el sitio de la pista, con el patrón que ya usa `anot-decision`: mientras haya algo que
decidir no se pintan botones que van a responder 409.

```
┌────────────────────────────────────┐
│  Este partido no está en directo   │
│                                    │
│  Nadie lo está viendo todavía.     │
│  Ponerlo en directo lo publica en  │
│  la web para todo el mundo.        │
│                                    │
│     ┌────────────────────────┐     │
│     │  ⏻  Poner en directo   │     │
│     └────────────────────────┘     │
└────────────────────────────────────┘
```

Desde «Más» sí se puede fijar la alineación: es la preparación.

### La doble confirmación

**Un diálogo, no dos.** Dos diálogos seguidos en un móvil al sol se despachan a ciegas, que
es lo contrario de lo que se busca. La segunda confirmación es una fila ancha que hay que
marcar, y hasta entonces el botón está apagado:

```
┌────────────────────────────────────┐
│ ¿Poner el partido en directo?      │
│                                    │
│ Ostreiros do Pozo — Os Pulpos      │
│                                    │
│ Se publicará AHORA en la web:      │
│ aparecerá en la portada, en el     │
│ chip de la cabecera y en /directo/ │
│ para todo el que entre.            │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ☐  Lo entiendo, publícalo      │ │
│ └────────────────────────────────┘ │
│                                    │
│      [Cancelar]  [ Sí, en directo ]│
└────────────────────────────────────┘
```

Fila ancha y no casilla diminuta porque se usa con una mano y de pie.

### El reloj

Vive **arriba**, dentro de la línea de detalle que ya existe. Coste de alto: 0px.

```
    Set 2 · sets 1–0 · a 21 · ⏱ 24:18 [⏸]
```

- Lejos del pulgar a propósito: la zona de anotar está abajo, así que la pausa no se toca sin
  querer.
- El tiempo lo pinta el navegador con `matchesApi.elapsed()` y `formatClock()` de
  `match-utils.js`, que la página ya carga. El servidor manda el ancla, no el número.
- El tick se para con la pestaña oculta y al pausar.

### El pop-up del primer punto

Con el partido en directo pero el reloj **nunca arrancado**
(`started_at IS NULL AND elapsed_ms = 0`) todavía no se anota. Hay un botón «Iniciar
cronómetro» a la vista, y si en vez de tocarlo se toca un punto, sale el pop-up:

```
┌────────────────────────────────────┐
│ ¿Arrancamos el cronómetro?         │
│                                    │
│ El partido ya está en directo. Al  │
│ arrancarlo se anota este punto.    │
│                                    │
│     [Cancelar]  [ Arrancar ]       │
└────────────────────────────────────┘
```

**Al confirmar, el punto que lo disparó se anota**: un toque descartado a pie de pista es un
punto perdido. Con «Cancelar» no se anota nada y el reloj sigue parado.

**El estreno del reloj es lo único que bloquea; la pausa no.** Una vez arrancado, pausar
nunca impide anotar — un toque que no hace nada porque el reloj está parado es justo la trampa
que esta pantalla no puede permitirse, y la pausa está para el descanso entre sets, no para
cerrar el marcador.

**Este cerrojo es solo de cliente, a diferencia del de `live`.** Los dos protegen cosas de
distinto tamaño: publicar un partido sin querer se ve desde fuera y no tiene vuelta atrás desde
el anotador, así que su guardia va en el servidor, donde no se puede esquivar entrando por URL.
Anotar con el reloj sin estrenar solo deja mal la duración de un partido, y un 409 más sería
otra forma de que la franja del pulgar se quede muerta en el peor momento.

### Presupuesto de alto

Ninguno de los añadidos crece la pantalla anotando: el bloque de «no está en directo» ocupa el
sitio de la pista (que en ese estado no se pinta), el reloj va en una línea que ya existe y los
dos diálogos son `<dialog>`. Los 742px medidos se quedan como están.

---

## 4. El directo público

### `GET /api/directo`

`mapDirecto` gana **dos campos**, uno por equipo:

```ts
teams: {
  A: { id, name, siglas },
  B: { id, name, siglas }
}
```

El nombre completo ya viajaba, así que la banda de la portada no cuesta nada nuevo.

### La versión tiene que llevar las siglas

Si no, editar una sigla desde el panel **no le llega a nadie**: `updated_at` vive en `partidos`
y esto se escribe en `equipos`. Es exactamente el fallo que CLAUDE.md ya documenta con los
ajustes y con el próximo partido programado.

Y como la versión acaba en una cabecera HTTP y una sigla puede llevar tilde, entra en
**`hex()`** — ASCII por construcción y exacto. No se limpia sustituyendo por `_`, que juntaría
dos versiones distintas en una y devolvería un 304 con el cuerpo viejo.

Una subconsulta más dentro de la misma consulta de una fila, con su `ORDER BY` para que
`GROUP_CONCAT` no baile:

```sql
(SELECT COALESCE(GROUP_CONCAT(s, ''), '')
   FROM (SELECT hex(e.siglas) AS s
           FROM equipos e
           JOIN partidos p2
             ON e.id IN (p2.equipo_a_id, p2.equipo_b_id)
          WHERE p2.edicion_id = ${EDICION_ACTUAL}   -- el fragmento que ya usa el fichero
            AND p2.status = 'live'
            AND e.siglas IS NOT NULL
          ORDER BY e.id)) AS siglas
```

Lee como mucho 4 filas de `equipos`. El camino barato (el 304) sigue siendo una consulta.

El cronómetro no necesita nada aparte: arrancar y pausar escriben `updated_at` y suben
`log_version`, y las dos ya están en la versión.

### El chip de la cabecera

```
hoy      🔥 12–9              ~60px
nuevo    🔥 OST–PUL          ~109px      cabe a 360px
```

En `pintarBoton` de [public/assets/directo.js](../../../public/assets/directo.js):

- El texto pasa a ser `siglas A – siglas B`.
- **Desaparece el caso especial** de «antes del primer punto el marcador no dice nada, mejor
  decir qué es»: siempre hay siglas.
- **El `aria-label` también pierde el marcador.** El enlace tiene `aria-live="polite"`: hoy un
  lector de pantalla canta cada punto, desde cualquier página del sitio. Queda
  `En directo: Ostreiros do Pozo contra Os Pulpos. Ver el marcador.`, que se anuncia una vez
  por partido y dice algo.

### La banda de la portada

Solo en `index.astro`. Componente propio (`src/components/BandaDirecto.astro`), oculto de
serie. Se engancha como **segundo suscriptor de `CopaDirecto`**: `directo.js` ya sondea en esa
página porque el chip vive en la cabecera, así que son cero peticiones nuevas y cero cambio de
cadencia.

```
🔥  ¡Estamos en directo!
    Ostreiros do Pozo  —  Os Pulpos          Ver el marcador →
```

La banda entera es el enlace a `/directo/`. Texto a curar por la organización.

**El obstáculo es la cabecera fija.** `.site-header` es una píldora `position: fixed; top: 34px`
con su `.header-backdrop` fijo encima — es la razón documentada de que la banda de «ver como»
se fuera abajo. Una banda arriba deja las dos por delante. Solución, sin números mágicos:

- La banda va **en flujo**, primer hijo del `<body>`. El hero, que viene después, baja solo.
- Al pintarla, `directo.js` mide su alto real y lo escribe en `--banda-directo` sobre
  `<html>`. `.site-header` y `.header-backdrop` suman esa variable a su `top`.
- Medir en vez de fijar 52px aguanta dos líneas en móvil, nombres largos y cualquier
  breakpoint. Se mide al empezar o acabar un partido, no en cada sondeo.
- Sin JS la banda sigue `hidden` y no se mueve nada.

Responsive: una línea en escritorio, dos en móvil (`≤560px`), con el nombre truncado por
`text-overflow: ellipsis` si hace falta.

---

## 5. Tests

Todo en `integration` salvo lo que es lógica pura o de cliente. Ninguno en `e2e`: ahí solo se
prueba que el middleware esté enchufado.

### `test/unit/siglas.test.ts` (nuevo)

- Los cuatro casos de la tabla de derivación.
- Enlaces descartados; nombre de una sola palabra; nombre de menos de 3 letras; nombre con
  tildes y con `ñ`.

### `test/integration/anotacion-directo.test.ts` (nuevo)

- **El agujero original:** anotar sobre un partido `scheduled` responde **409** y el partido
  sigue `scheduled` — no basta con el 409, hay que comprobar que no se publicó.
- `adoptar` sobre un `scheduled` con puntos a mano también responde 409 y no publica.
- `accion:"directo"` lo pone `live`, **no toca `started_at` ni `elapsed_ms`**, y tras ella el
  primer punto entra.
- `accion:"directo"` sobre un partido ya `live` o `finished` → 409.
- Deshacer, corregir y fijar alineación **siguen funcionando** sin estar en directo.
- Todo lo anterior con un rol que solo tiene `partidos.anotar` (`crearUsuarioConPermisos`).

### `test/integration/cronometro.test.ts` (nuevo)

- Arrancar → `started_at` puesto; pausar → `elapsed_ms` acumulado y `started_at` a `NULL`;
  arrancar otra vez → suma sobre lo acumulado, no lo pisa.
- **El bug de `eventos.ts:253`:** partido con `elapsed_ms > 0` que se cierra anotando el
  último punto → la duración final incluye el acumulado. Este test falla hoy.
- Arrancar el reloj de un partido no `live` → 409.
- Pausar dos veces seguidas no resta tiempo.

### `test/integration/directo-version.test.ts` (existente, se amplía)

- Cambiar `equipos.siglas` **mueve la versión**: es lo que impide el 304 con el cuerpo viejo.
- La versión sigue siendo ASCII con siglas acentuadas (`ÑOR`, `RÍA`) — el fichero ya prueba
  esto con nombres de equipo, se extiende a las siglas.
- Arrancar y pausar el cronómetro mueven la versión.

### `test/unit/directo-sondeo.test.ts` (existente)

Debe **seguir verde sin tocarlo**. Es el presupuesto de peticiones escrito como test, y la
banda de la portada no puede cambiarlo: es un suscriptor más del sondeo que ya había.

### `test/unit/directo-chip.test.ts` (nuevo, jsdom)

- El chip encendido pinta `OST–PUL` y **no** el marcador.
- El `aria-label` lleva los nombres completos y no lleva puntos.
- Con siglas presentes desde el primer sondeo no queda el texto «En directo».

### `test/unit/banda-directo.test.ts` (nuevo, jsdom)

- Sin partido, la banda está `hidden` y `--banda-directo` no desplaza nada.
- Con partido, se pinta con los **nombres completos** y `--banda-directo` toma el alto medido.
- Al acabar el partido, la banda vuelve a `hidden` y la variable a `0px`.

### `test/unit/anotador-partido.test.ts` (existente, se amplía)

Lee el `.astro` para que no se pierda el orden de los scripts; se le añade que el diálogo de
confirmación y el bloque de «no está en directo» existen en el marcado.

### `test/unit/anotador-cronometro.test.ts` (nuevo, jsdom)

El cerrojo del reloj es de cliente, así que su prueba también:

- Con el reloj sin estrenar, tocar un punto **no llama a la API** y abre el diálogo.
- Confirmar arranca el reloj **y anota el punto** (dos peticiones, en ese orden).
- Cancelar no manda nada.
- Con el reloj **pausado**, tocar un punto anota directamente: la pausa no bloquea.

---

## Fuera de alcance

- **El cronómetro no se publica en `/directo/`.** Existirá en la base y lo verá quien anota,
  pero no se pinta para el espectador: no se ha pedido y añade superficie al endpoint que no
  puede fallar.
- **No se toca `action: "start"` del panel.**
- **No hay siglas en `/inscripcion/`.**
- **No hay permiso nuevo**: se reutiliza `partidos.anotar`.

## CLAUDE.md

Hay un párrafo que esta rama **invierte** y hay que reescribir, no ampliar:

> «Encendido es un enlace que enseña **el marcador**, no la palabra «directo».»

Pasa a enseñar las siglas de quien juega; el marcador se ve entrando. Y se añaden líneas en:

- «Anotación en directo» — el cerrojo `PartidoNoEnDirecto`, las dos acciones nuevas y la
  semántica de `started_at` / `elapsed_ms`.
- «Público: `/torneo/` y el directo» — las siglas en la versión vía `hex()`, y la banda de la
  portada con el porqué de `--banda-directo`.
