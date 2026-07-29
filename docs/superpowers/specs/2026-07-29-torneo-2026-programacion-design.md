# Programación del torneo 2026: formatos, repesca y sorteo

## Contexto

13 equipos inscritos, **una sola pista**, y cinco tardes:

| Día | | Contenido | Empieza |
|---|---|---|---|
| Sáb 01/08 | Grupo A | 4 equipos · 6 partidos | 16:30 |
| Dom 02/08 | Grupo B | 4 equipos · 6 partidos | 16:30 |
| Lun 03/08 | Grupo C | 5 equipos · 10 partidos | 16:30 |
| Sáb 08/08 | Cuartos | 4 partidos | 17:00 |
| Dom 09/08 | Semis + 3.º/4.º + final | 4 partidos | 17:00 |

Restricción dura: **ningún día debe acabar mucho más tarde de las 21:00-21:30.**

Clasifican 8 equipos: los dos primeros de cada grupo, el 3.º del grupo de cinco, y
el mejor 3.º entre los dos grupos de cuatro.

## Decisión 1: los formatos

El plan de partida era «2 sets a 21 sin tercer set» en los grupos de 4 y «1 set a
21» en el de 5. Se descartó por dos motivos independientes.

**Por tiempo.** La intuición de que el grupo de 5 es el día pesado está del revés:
6 partidos × 2 sets = **12 sets**, contra 10 partidos × 1 set = **10 sets**. Con
una pista y sets a 21 de ~22 min más 6 min de cambio, el grupo de 4 a dos sets
cierra a las **21:48** y el de 5 a las **21:10**. El día «ligero» es el que se
pasa de hora.

**Por representabilidad.** En `_lib/reglas.ts` el campo `sets` son *sets que hay
que ganar*, así que `sets: 2` significa «al mejor de tres». «Siempre dos sets, con
empate posible» no existe como concepto: exigiría tocar `reglas.ts`,
`clasificacion.ts` (donde hoy `setsPropios > setsRival` cuenta un 1-1 como derrota
para ambos), el plegado de eventos del anotador, `match-utils.js`, el panel y la
tabla pública. Seis ficheros y sus tests para un formato que además acaba tarde.

### Formatos elegidos

| Fase / grupo | Formato | Fin estimado |
|---|---|---|
| Grupos A y B | al mejor de 3, **15/15/15** | ~21:20 |
| Grupo C | **1 set a 21** | ~21:20 |
| Cuartos, semis, 3.º/4.º y final | al mejor de 3, **21/21/15** | ~21:00 |

Los tres días de grupos cierran a la misma hora. La eliminatoria puede permitirse
el formato estándar completo porque son 4 partidos por tarde. Todo son **reglas en
JSON**: cero código nuevo en el motor de reglas, que es exactamente el caso de uso
para el que se escribió la herencia grupo > fase > defaults.

Coste: los grupos de 4 juegan a 15 en vez de a 21. A cambio no hay empates que
resolver, cada equipo juega 3 partidos de 2-3 sets (6-9 sets en la tarde, contra 6
fijos) y se acaba ~30 min antes.

### Reglas concretas

Fase `grupos` (la heredan A y B):

```json
{
  "partido":       { "sets": 2, "puntosPorSet": 15, "puntosSetDecisivo": 15, "diferencia": 2 },
  "clasificacion": { "puntosVictoria": 3, "puntosDerrota": 0,
                     "puntosVictoriaAjustada": 2, "puntosDerrotaAjustada": 1,
                     "desempates": ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"] }
}
```

Grupo C (sobrescribe):

```json
{
  "partido":       { "sets": 1, "puntosPorSet": 21, "diferencia": 2 },
  "clasificacion": { "puntosVictoria": 3, "puntosDerrota": 0,
                     "puntosVictoriaAjustada": 3, "puntosDerrotaAjustada": 0 }
}
```

El bloque `clasificacion` de C **no es decorativo**. `torneo-vista.ts:158` calcula
`setDecisivo` como `sets_a + sets_b >= setsMaximos(reglas)`, y con `sets: 1`
`setsMaximos` vale 1: todos los partidos de C cuentan como resueltos en el set
decisivo. Sin el override, cada victoria valdría `puntosVictoriaAjustada` (2) y
cada derrota `puntosDerrotaAjustada` (1). El orden dentro de C no cambiaría —es una
transformación monótona— y C no entra en la repesca, así que nada se rompe; pero la
tabla enseñaría 7 puntos donde se leen 9, y eso parece un fallo. Igualando los
valores ajustados a los normales, un partido a un set puntúa 3-0 como debe.

Fase `eliminatoria`: los defaults de `REGLAS_POR_DEFECTO` tal cual.

### Horarios

Grupos A y B (huecos de 50 min): 16:30, 17:20, 18:10, 19:00, 19:50, 20:40.
Grupo C (huecos de 30 min): 16:30, 17:00, 17:30, 18:00, 18:30, 19:00, 19:30,
20:00, 20:30, 21:00.
Cuartos: 17:00, 18:00, 19:00, 20:00.
Domingo 09/08: semifinal 1 a las 17:00, semifinal 2 a las 18:00, 3.º/4.º a las
19:00, final a las 20:00. El orden importa: el 3.º/4.º necesita las dos semifinales
cerradas, y con una pista eso está garantizado por construcción.

`generarLiga` no escribe `scheduled_at` ni `pista`, así que las horas se ponen
después, partido a partido, vía `PATCH /api/partidos`.

## Decisión 2: la repesca y sus colores

### El problema

Hoy `torneo_fases.clasifican` es un número y significa «los N primeros de **cada**
grupo». `torneo-page.js:163` pinta `.is-clasificado` con esa regla, y
`sembrarEliminatoria` siembra por posición con ese mismo número. La regla de este
torneo no cabe ahí: son 2 plazas directas en A y B, 3 en C, y 1 plaza más que se
disputan el 3.º de A y el 3.º de B.

Dejar a C fuera de la repesca no es un capricho: con los formatos elegidos, C juega
a un set de 21 y A/B al mejor de 3 a 15. Sus puntos y sus sets no miden lo mismo.
Comparar al 4.º de C con el 3.º de A sería comparar dos escalas distintas. Entre A
y B sí es limpio —mismo formato, mismos partidos—, y por eso la repesca se disputa
solo entre ellos.

### Modelo de datos (migración 0022)

- `torneo_grupos.clasifican INTEGER` — plazas directas del grupo. `NULL` = hereda
  de la fase. Mismo patrón que `torneo_grupos.reglas`, y por el mismo motivo:
  distinguir «hereda» de «coincide por casualidad» importa al editar.
- `torneo_fases.repesca INTEGER NOT NULL DEFAULT 0` — plazas extra que se reparten
  comparando entre grupos.
- `torneo_grupos.en_repesca INTEGER NOT NULL DEFAULT 1` — si el siguiente
  clasificado de ese grupo entra al bote de la repesca.

Configuración resultante: fase `clasifican: 2`, `repesca: 1`; A y B por defecto; C
con `clasifican: 3` y `en_repesca: 0`. Total 2+2+3+1 = 8.

Solo `ALTER TABLE`, y por tanto en su propio fichero de migración: `ADD COLUMN` no
es idempotente y D1 reejecuta el fichero entero si una sentencia falla a mitad.

### Cálculo compartido: `_lib/clasificados.ts`

Una función pura, sin base de datos delante, que recibe los grupos ya clasificados
(con sus filas y su `clasifican` efectivo) más `repesca`, y devuelve:

- por cada fila, su condición: `"directo" | "repesca" | null`
- la lista ordenada de semillas para sembrar el cuadro

**Las dos salidas vienen de la misma pasada, y eso es el punto.** Si el pintado
fuese por un lado y `sembrarEliminatoria` por otro, un día la tabla diría que pasa
uno y el cuadro colocaría a otro, sin forma de saber cuál miente. Es el mismo
motivo por el que `cargarTorneo` ya está compartida entre el panel y la página
pública.

Ordenación del bote de repesca: los mismos criterios de desempate de la fase,
**saltándose `enfrentamiento_directo`**, que entre equipos de grupos distintos no
significa nada (no hay partidos entre ellos; `bloquesPorEnfrentamiento` devolvería
`null` de todos modos, pero saltarlo explícitamente documenta la intención).

### Frontend

- `torneo-vista.ts` expone `clasifica` en cada fila de clasificación y `repesca` en
  la fase.
- `torneo-page.js` y la tabla del panel pintan dos colores distintos: plaza directa
  y plaza de repesca. La nota al pie deja de ser «pasan los N primeros» y pasa a
  describir la regla real.
- CSS: `.is-clasificado` ya existe en `global.css`; se añade la variante de
  repesca. En el panel, su equivalente en `src/styles/admin/torneo.css`.
- Ambas vistas responsive, como manda CLAUDE.md: la tabla de clasificación ya vive
  dentro de `.torneo-tabla-scroll` y el color va en la fila, así que no debería
  necesitar breakpoints nuevos — a verificar en 390 px.

`sembrarEliminatoria` pasa a consumir las semillas de `clasificados.ts` en vez de
recorrer posiciones a mano en `api/admin/torneo.ts`.

## Decisión 3: el sorteo

Aleatorio, con restricciones de disponibilidad:

| Equipo | Puede | Grupo forzado |
|---|---|---|
| Calvos de Orión | solo sábado | A |
| Bye Bye Bye | solo sábado | A |
| Free Copa Arena | solo sábado | A |
| Showtime | solo lunes | C |
| Dosilva | solo lunes | C |
| Kylian dictador | al lunes, a petición (no consta que sea disponibilidad) | C |
| Limens | sábado o domingo | A o B |

Quedan 8 huecos libres (A:1, B:4, C:3) para Limens más los 7 equipos sin
restricción. Es factible, pero con poco margen: A llega con 3 de sus 4 plazas ya
ocupadas.

Para que el sorteo sea uniforme sobre las asignaciones válidas y no solo «aleatorio
a ojo», Limens se coloca con probabilidad proporcional a los huecos libres (1/5 a
A, 4/5 a B) y el resto se baraja sobre los huecos restantes.

El resultado del sorteo se presenta para validación **antes** de escribir nada.

### Resultado

Sorteado con `randomInt` de `node:crypto` sobre los 13 equipos reales leídos de
producción, con las restricciones aplicadas y verificadas (tamaños, sin
duplicados, cada equipo atado en su grupo):

| Grupo A · Sáb 01/08 | Grupo B · Dom 02/08 | Grupo C · Lun 03/08 |
|---|---|---|
| Calvos de Orion 🔒 | Limens | Showtime 🔒 |
| Bye Bye Bye 🔒 | Los Julais | Dosilva 🔒 |
| Free Copa Arena 🔒 | Segarro | Kylian dictador 🔒 |
| Croquetillas de Arena | Deportivo A Silva | ONDA BRAVA |
| | | Alejo Mouris |

🔒 = plaza forzada por disponibilidad. Limens salió a B. Kylian dictador se movió
a C a petición expresa después del primer sorteo, intercambiándose con
Croquetillas de Arena (elegida al azar entre los tres equipos de C sin atar).

Los nombres son los de producción, tal como los escribieron sus capitanes:
«Calvos de Orion» va sin tilde y «ONDA BRAVA» en mayúsculas. Son datos de
usuario, no copy del sitio, así que la convención de acentos de CLAUDE.md no
aplica y no se tocan.

## Fuera de alcance

- **No se toca producción.** Todo se monta y se prueba en local con 13 equipos
  fabricados. Crear la fase y generar la liga borra los partidos de esa fase
  (`torneo.ts:179`), así que la escritura real se hace solo con confirmación
  explícita y por una vía acordada.
- No se añade el concepto de empate al motor de reglas. Lo pide «2 sets fijos», que
  queda descartado.
- No se toca `setDecisivo` en `torneo-vista.ts`. Que un partido a un set siempre
  sea «decisivo» es una arruga real del motor, pero se resuelve por configuración
  para este torneo y refactorizarla no sirve al objetivo.

## Alcance de las restricciones de disponibilidad (resuelto)

**Valen solo para el primer fin de semana**, el de la fase de grupos. El 8 y el 9
de agosto pueden jugar todos, así que la eliminatoria se disputa sin condiciones.

Queda escrito porque la alternativa rompía el torneo, y no por un caso raro: el
grupo A tiene 3 equipos «solo sábado» de 4 y clasifican 2, así que **siempre** pasa
al menos uno, y las semifinales son en domingo. Con las restricciones entendidas
como absolutas no había recolocación de días que lo salvara — el problema no era
qué grupo juega qué día, sino el segundo fin de semana entero. Si algún año vuelven
restricciones de este tipo, hay que comprobarlas contra la eliminatoria y no solo
contra los grupos.

## Tests

- `test/unit/clasificados.test.ts` — nuevo. La lógica de plazas directas + repesca
  con `clasifican` heredado y sobrescrito, grupos dentro y fuera del bote, empate en
  el bote resuelto por los criterios de la fase, y que las semillas salgan en el
  mismo orden que los colores.
- `test/unit/clasificacion.test.ts` — que el override de C puntúa 3-0 y no 2-1, que
  es el fallo concreto que motiva su bloque `clasificacion`. El comportamiento nace
  en `aClasificable` (`torneo-vista.ts`), no en `reglas.ts`: el test tiene que
  atravesar las dos piezas juntas, porque por separado ninguna está mal.
- `test/integration/torneo-admin.test.ts` — `clasifican` por grupo, `repesca` y
  `en_repesca` van y vuelven por la API; sembrar el cuadro coloca exactamente a los
  8 que la clasificación pinta como clasificados.
- `test/integration/torneo-publico.test.ts` — `GET /api/torneo` expone `clasifica`
  por fila.
- `test/integration/setup.ts` — sin tablas nuevas, así que no hay que tocar
  `TABLAS`. Confirmar de todas formas al añadir la migración.
- `npm run verify` en verde antes de mezclar en `development`.
