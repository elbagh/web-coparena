# /torneo/ en tres columnas, con el ascenso pintado

Fecha: 2026-07-29

## El problema

`/torneo/` apila los tres grupos uno debajo de otro y, dentro de cada uno, los
seis o diez partidos con su tarjeta de tres líneas. En un portátil hay que hacer
tres pantallas de scroll para ver algo que cabe de sobra en una: las tres
clasificaciones y los horarios de las tres tardes.

Y lo segundo, que es lo que de verdad se va a mirar el día del torneo: **no se
distingue quién asciende**. El verde de `is-directo` está al 18 % de opacidad
sobre crema y no se ve; y de los dos terceros que se juegan la última plaza,
solo uno lleva color, porque `clasificados.ts` marca `repesca` únicamente al
mejor del bote. El otro sale igual que quien está eliminado.

## El formato real (edición 2026)

Sale de `scripts/cargar-torneo-2026.mjs` y está en la base:

| Grupo | Equipos | Plazas directas | En repesca |
|---|---|---|---|
| A | 4 | 2 | sí |
| B | 4 | 2 | sí |
| C | 5 | 3 | no |

7 plazas directas + 1 repesca entre el 3.º de A y el 3.º de B = el cuadro de
ocho. El 3.º de C **pasa directo**, no está en la repesca.

## Qué se hace

### 1. Las tres columnas

`bloqueDeGrupo` ya construye una columna entera: letra → tabla → nota →
partidos. Falta el contenedor. `seccionDeFase` mete los bloques de una fase de
grupos en un `<div class="torneo-grupos">` y ese div es la rejilla:

- ≥ 901 px → 3 columnas
- 561–900 px → 2 columnas
- ≤ 560 px → 1 columna (como ahora)

La página se ensancha **solo en escritorio**: `.torneo-page` pasa de los 960 px
de `.legal-page` a 1240 px, y solo la sección de grupos usa ese ancho. La
eliminatoria y «otros partidos» se quedan a 900 px, que es lo que ya eran.

Cada grupo es una tarjeta con cabecera propia, para que se lean como tres
bloques y no como un río de tres carriles.

### 2. Horarios compactos

La tarjeta de partido de ahora gasta tres líneas y repite en cada una lo que ya
sabes: el grupo, la fecha y la pista. En un tercio de ancho no cabe. Variante
`.torneo-partido.is-compacto` para los partidos de grupo:

- La letra del grupo está en la cabecera de la columna → en la tarjeta queda
  `J1`, no «A · jornada 1».
- **Si todos los partidos del grupo caen el mismo día y en la misma pista**, la
  fecha y la pista salen una vez en la cabecera de la columna y en la tarjeta
  queda solo la hora. Si no coinciden, cada tarjeta recupera su fecha completa:
  la cabecera no puede afirmar algo que no sea cierto.
- El cruce, en una línea.

### 3. Los colores

| Color | Quién | Cómo |
|---|---|---|
| Verde fuerte | 1.º–2.º de A, 1.º–2.º de B, 1.º–3.º de C | Fondo `--lime` sólido + barra `--sea` + nombre en negrita |
| Ámbar tenue | 3.º de A y 3.º de B | Fondo `--sun` suave, **los dos** |

Que los dos terceros lleven color exige tocar el servidor, no solo el CSS:
`clasificados.ts` gana una tercera condición, `aspirante`, para el resto del
bote de la repesca. La regla de quién se juega qué sigue viviendo en un solo
sitio; el cliente solo pinta lo que le llega.

Los dos comparten fondo ámbar y el que **ahora mismo** ocupa la plaza
(`repesca`) lleva además la barra lateral. Así se lee «estos dos se la juegan»
y, en cuanto haya resultados, «y ahora mismo va este», sin gastar un tercer
color en algo que es un matiz.

### 4. Leyenda y notas

La explicación de la repesca se repetía en las tres columnas. Pasa a ser una
leyenda única bajo el título de la fase, con sus dos muestras de color; la nota
de cada grupo se queda en la frase corta («Pasan los 2 primeros»), que sí es
distinta por grupo (C dice 3).

El color no puede ser el único portador del significado: cada fila coloreada
lleva un `.sr-only` en la celda de posición («Clasificado» / «Aspirante a la
repesca»).

## Qué NO se hace

- No se toca el cuadro de eliminatoria ni el panel del directo.
- No se cambia el formato del torneo: las plazas son las que ya están en la
  base.
- El panel de administración solo recibe el estilo de `is-aspirante`, para que
  la clasificación que ve la organización siga diciendo lo mismo que la pública.

## Tests

- `test/unit/clasificados.test.ts` — la condición `aspirante`: aparece para todo
  el bote menos el que ocupa la plaza, y sigue habiendo exactamente `repesca`
  tantas veces como plazas de repesca.
- `test/unit/torneo-page-clasificacion.test.ts` — `is-aspirante` en la tabla, la
  leyenda una sola vez por fase, la rejilla `.torneo-grupos` con un bloque por
  grupo, y la cabecera de columna con fecha única solo cuando de verdad la hay.
- `test/integration/torneo-publico.test.ts` — repaso: `clasifica` viaja al
  cliente con el valor nuevo.
