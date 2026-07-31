# Reclamo del partido: dos anotadores no anotan a la vez

**Fecha:** 2026-08-01
**Rama:** `feature/reclamo-anotador` (worktree `.worktrees/reclamo-anotador`, slot 5)
**Estado:** diseño aprobado, pendiente de plan de implementación

## El problema

Hoy lo único que separa a dos anotadores sobre el mismo partido es
`UNIQUE(partido_id, orden)` en `partido_eventos`. El cliente manda el
`ordenEsperado` que ha visto, el servidor lo compara con el log
(`_lib/eventos.ts`, `registrarEvento`) y el índice atrapa la carrera de verdad,
la que se cuela entre el `SELECT` y el `INSERT`. Quien pierde recibe un 409.

Eso impide que un punto pise a otro. No impide lo que preguntó el usuario: que
dos personas lleven el mismo partido **sin enterarse**.

- **El 409 es reactivo y sólo salta si coinciden en el mismo hueco.** Si se
  turnan sin llegar a colisionar —A anota, B relee al volver a la pantalla, B
  anota— no choca nunca. El log queda entrelazado, el marcador sale correcto, y
  cada uno sigue creyendo que es el único.
- **Con una sola pista, esto no es un caso raro.** Cualquiera con
  `partidos.anotar` que entre en `/anotador/` se encuentra el mismo partido en
  juego, que es el que está arriba en la lista.
- **`partido_eventos.usuario_id` y `partido_cambios.usuario_id` se escriben y no
  se leen en ninguna consulta del proyecto.** El dato que haría falta para
  avisar ya está guardado.

Agujeros relacionados que salieron al revisar:

1. `corregir` no lleva `ordenEsperado` (`api/anotacion.ts`, `accionCorregir`).
   Dos correcciones sobre el mismo evento y la segunda pisa a la primera sin
   decir nada.
2. `alineacion` borra el lado entero y reinserta: gana el último, en silencio.
3. `cambio-deshacer` coge el último cambio por `id DESC`, sea de quien sea.
4. `adoptarMarcador` no traduce el `UNIQUE` a `ConflictoDeOrden` — le falta el
   `try/catch` que sí tiene `registrarEvento`. Dos adopciones simultáneas y la
   segunda sale como 500 «No se ha podido guardar».
5. Un `evento` concurrente con un `deshacer` no colisiona: deshacer borra el
   orden N-1 y anotar inserta el N, que está libre. Las sentencias derivadas de
   anotar se calcularon sobre una lista que aún incluía el evento borrado, así
   que las columnas de `partidos` quedan mal hasta la siguiente escritura. El
   log no se corrompe: es la fuente de verdad, y `PATCH /api/anotacion`
   (`recalcularPartido`) ya existe como vía de escape.

## Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| ¿Qué hace el servidor sin relevo? | **Rechaza con 409** | Sólo avisar; rechazar sólo si el reclamo sigue vivo |
| ¿Cuándo se reclama? | **Con la primera escritura** | Al abrir la pantalla; con un botón explícito |
| ¿Caduca el reclamo? | **No** | Caducidad con relevo automático |

Las tres apuntan a lo mismo: **el partido cambia de manos sólo cuando alguien lo
pide**, nunca por un reloj ni por un descuido.

La caducidad se descartó por tres razones. El relevo automático vuelve a meter
por la puerta de atrás el «cambia de manos solo» que la primera decisión
descarta. Añade un parámetro que afinar el día del torneo, con mala
realimentación: si la ventana es corta, dos anotadores activos se pisan igual;
si es larga, no sirve de nada. Y obliga a manipular el reloj en los tests de
`integration`, que ya son los lentos.

El coste que se acepta a cambio: cuando el anterior anotador ya no está, hace
falta un toque de más. La pantalla enseña cuándo fue el último punto, que es la
información necesaria para decidir, sin que el servidor decida por nadie.

## Esquema — migración 0029

```sql
ALTER TABLE partidos ADD COLUMN anotador_usuario_id INTEGER REFERENCES usuarios(id);
```

Una sola columna, y un solo `ALTER` en su fichero, siguiendo lo que dicen la
0021 y la 0027: `ADD COLUMN` no es idempotente y D1 reejecuta el fichero entero
si algo falla a mitad, así que dos `ALTER` juntos dejan el segundo intento
muerto en el primero.

**No hay `anotador_desde`.** `partidos.updated_at` ya sube en toda escritura del
anotador (`sentenciaLogVersion` y el `UPDATE` de `sentenciasDerivadas`), y como
sólo el dueño puede escribir, esa marca ya significa «la última vez que anotó
quien lo lleva». Es lo que necesita el diálogo.

`NULL` significa «no lo lleva nadie», que es el estado de todo partido existente
tras la migración. Migración aditiva y compatible con el código viejo: nada lo
lee hasta que despliega el código nuevo.

## Servidor

### El reclamo se toma con un CAS

```sql
UPDATE partidos SET anotador_usuario_id = ?1
 WHERE id = ?2 AND anotador_usuario_id IS NULL
```

Si `meta.changes === 1`, lo acaba de reclamar quien pregunta. Dos peticiones
simultáneas sobre un partido libre y sólo una afecta a una fila: la condición la
evalúa la base de datos.

Esto no es un detalle de implementación, es el punto entero. Un `SELECT` seguido
de un `if` en el servidor no es atómico y dejaría el mismo agujero que se está
tapando, sólo que más difícil de ver. El repositorio ya tiene un precedente de
lo contrario: `UNIQUE(partido_id, orden)`.

### Una sola puerta

En `onRequestPost` de `api/anotacion.ts`, antes del `switch`, no repartida por
las funciones de `_lib`. Mismo criterio que el bloqueo de «ver como», que vive
sólo en `_middleware.ts`.

Va **después** de la comprobación de `partidos.editar` que ya existe para los
partidos terminados. Primero se resuelve quién eres, que no depende del partido;
después, si este partido concreto es tuyo. Como consecuencia, `relevo` sobre un
partido terminado hereda esa exigencia de `partidos.editar`, que es lo
coherente: enmendar un resultado cerrado ya pedía ese permiso.

Camino, con el coste en consultas de cada rama:

1. `SELECT_PARTIDO` gana `anotador_usuario_id`, así que la fila ya viene cargada
   de antes (`cargarPartido`, que la petición ya hacía).
2. Si `anotador_usuario_id === acceso.user.id` → pasa. **Cero consultas
   extra.** Es el camino de cada punto anotado.
3. Si es `NULL` → el CAS. Si `changes === 1`, pasa. Una consulta, una vez por
   partido.
4. Si es de otra persona (o el CAS perdió la carrera) → leer su `nombre` y
   responder 409. Una consulta, sólo en el caso que ya se está rechazando.

El orden importa: CLAUDE.md fija que el coste de anotar no puede crecer con lo
anotado, y `anotacion-estres.test.ts` lo comprueba **contando consultas**. Este
diseño no añade ninguna al camino caliente.

### Excepciones a la puerta

- **`relevo`** (acción nueva) es la salida y no pasa por ella.
- **`soltar`** sí pasa: exige ser el dueño, y de paso pone la columna a `NULL`.
  Quien no lo lleva toma el relevo primero. Sin esto sería una puerta trasera
  para quitarle el partido a otro sin que quede dicho.
- **`GET`** no reclama nada. Entrar a mirar el marcador es gratis y no echa a
  nadie.
- **`PATCH /api/anotacion`** (`recalcularPartido`) se queda fuera: exige
  `partidos.editar`, no escribe en el log y existe precisamente para arreglar un
  descuadre. Bloquearla sería quitar la vía de escape.

### La acción `relevo`

```sql
UPDATE partidos SET anotador_usuario_id = ?1 WHERE id = ?2
```

Sin condición. Siempre disponible, nunca falla, para cualquiera con
`partidos.anotar`. Si al anterior anotador se le acabó la batería, el siguiente
tiene que poder entrar sin llamar a nadie: por eso el reclamo es blando y no un
cerrojo.

**No hace falta tabla que registre el relevo.** Cada evento del log ya va
firmado con `usuario_id`, así que el cambio de manos se lee ahí.

### Errores

`PartidoDeOtroAnotador extends ErrorDeAnotacion` (409) en `_lib/eventos.ts`,
junto a `MarcadorSinAdoptar`. Lleva en el cuerpo `anotador: { id, nombre }` y la
última actividad, igual que `MarcadorSinAdoptar` lleva su `marcadorPanel`: la
pantalla necesita el dato para poder decir qué pasa y ofrecer la salida.

### La respuesta

`respuesta()` recibe el `usuarioId` de quien pregunta y devuelve:

```ts
anotador: { id: number | null; nombre: string | null; puedeAnotar: boolean }
ultimaActividad: string   // partidos.updated_at
```

**`puedeAnotar`, no `esMio`.** Son distintos justo en el caso que más se da al
abrir un partido: nadie lo lleva todavía. Con `esMio` ese estado es `false` y la
pantalla arrancaría en modo lectura pidiendo un relevo a nadie. La definición es
explícita:

```ts
puedeAnotar = anotador.id === null || anotador.id === usuarioId
```

El nombre sale de un `LEFT JOIN usuarios` dentro de `cargarPartido`, no de una
consulta aparte. Se usa `usuarios.nombre` y, si es `NULL`, `usuarios.email`:
ambas partes son cuentas de la organización con `partidos.anotar`, y un nombre
vacío en la banda no serviría para decidir.

`partidosDeHoy` gana el mismo `LEFT JOIN` para la lista.

## Cliente

`partido.js` arranca en **modo lectura** cuando `anotador.puedeAnotar === false`:
banda con «Lo lleva Ana · último punto a las 17:40» y un botón «Tomar el
relevo». Reutiliza el patrón que ya existe para `pendienteDeAdoptar`
(`pintarDecision`): ocultar pista y zona del pulgar mientras hay algo que
decidir, para no pintar botones que van a responder 409.

Prioridad entre las dos bandas: **el relevo va primero**. No se puede decidir
sobre el marcador de un partido que no se lleva.

Si el 409 llega a media partida —alguien tomó el relevo mientras anotabas— cae
en el `catch` que ya deshace la pintada optimista y pinta la misma banda.

En `lista.js`, la nota de la tarjeta pasa de «Ya se está anotando» (que hoy sale
de `origen_marcador === 'eventos'`) a «Lo lleva Ana». Cuando el partido tiene log
pero nadie lo lleva, se mantiene el texto de hoy.

El diseño visual de la banda pasa por la skill `frontend-design` en la
implementación, y se verifica en móvil: CLAUDE.md avisa de que el alto de esta
pantalla ya está gastado entero (742px + 60 de barra en un móvil de 844), así
que la banda no puede empujar la zona del pulgar fuera de la pantalla. Como
sustituye a la pista y al pulgar en vez de sumarse a ellos, no debería, pero hay
que medirlo.

## Lo que esto arregla de propina

Con el reclamo, los puntos 2, 3 y 5 del problema desaparecen: si sólo una cuenta
puede escribir en un partido, no hay una alineación pisada, ni un
`cambio-deshacer` ajeno, ni un `deshacer` cruzándose con un `evento`.

Lo que **no** cubre es la misma persona con dos pestañas abiertas: mismo
`usuario_id`, pasa la puerta. Ahí sigue haciendo falta el `ordenEsperado`.

**Reparto de papeles: el reclamo separa a dos personas, el `UNIQUE` separa a dos
pestañas.** Por eso entran en esta rama los dos arreglos que quedan:

- `ordenEsperado` en `corregir`, con el mismo 409 que las demás acciones. El
  cliente ya tiene el dato.
- El `catch` del `UNIQUE` en `adoptarMarcador`, que hoy sale como 500.

## Tests

### `test/integration/anotador-reclamo.test.ts` (nuevo)

1. El primer evento reclama el partido: el `GET` posterior trae `anotador.id`.
2. Un segundo anotador recibe 409 al anotar, y el marcador no cambia.
3. El 409 lleva el nombre de quien lo lleva.
4. Tras `relevo`, el segundo anota; el primero pasa a recibir 409.
5. El `GET` no reclama: dos usuarios leen, y el partido sigue sin dueño.
6. `soltar` libera: después, otro anota sin pasar por el relevo.
7. `soltar` de quien no lo lleva responde 409.
8. El CAS: dos peticiones a la vez (`Promise.all`) sobre un partido libre dan
   una 201 y una 409, y el dueño acaba siendo uno solo.
9. La puerta cubre **todas** las acciones de escritura, no sólo `evento`:
   `alineacion`, `cambio`, `cambio-deshacer`, `corregir`, `deshacer`, `adoptar`.

### En `test/integration/anotacion.test.ts`

- `corregir` con `ordenEsperado` desfasado → 409.
- Dos `adoptar` en carrera → 409 con su mensaje, no 500.
- El bloque «dos anotadores a la vez» que ya existe usa el **mismo** admin para
  las dos peticiones, así que sigue verde y pasa a documentar el caso de las dos
  pestañas. Hay que actualizar su comentario, que hoy dice «dos anotadores».
- Repasar el resto del fichero: donde se monte un partido con un usuario y se
  escriba con otro, el 409 será legítimo y toca actualizar el test. **No se
  debilita la puerta para que un test viejo siga pasando.**

### `test/unit/anotador-partido.test.ts`

- En modo lectura, la pista y la zona del pulgar quedan ocultas y no se manda
  ningún evento.
- El botón de relevo manda `{ accion: "relevo" }`.

### Sin cambios en `test/integration/setup.ts`

No hay tabla nueva. `partidos` ya está en `TABLAS` y la columna nace `NULL`.

## Fuera de alcance

- **El panel (`/api/partidos`) no consulta el reclamo.** Su separación con el
  anotador ya es `origen_marcador`, que responde 409 a lo que toque el marcador
  mientras manda el log. Meter aquí una segunda regla sería duplicar esa
  frontera.
- **Nada de presencia en tiempo real** (quién tiene la pantalla abierta ahora
  mismo). Exigiría sondear, y el presupuesto de peticiones del día del torneo
  está contado.
- **No se registra el histórico de relevos** en tabla propia. El `usuario_id` de
  cada evento ya lo dice.
