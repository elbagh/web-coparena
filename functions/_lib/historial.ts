// El log completo de un partido, replegado: cómo fue punto a punto.
//
// El compañero de `feedPublico` para la otra mitad del problema. Aquél sirve la
// **cola** del log a quien está sondeando el directo, y por eso no puede replegar
// desde el principio ni permitirse leer el log entero cien veces por minuto. Esto
// se pide una vez, cuando alguien abre un partido ya jugado, así que sí lee el
// log entero — y como lo lee entero, puede decir cosas que el directo no puede:
// el marcador exacto que dejó cada punto, en cualquier set, y no sólo en el que
// se está jugando.
//
// Dos consecuencias de leerlo entero, y las dos importan:
//
//   1. El número de set se DERIVA del pliegue, no se lee de
//      `partido_eventos.set_numero`. Esa columna existe justamente para quien
//      sólo trae la cola; aquí sería un dato de segunda mano que puede discrepar.
//      Es lo mismo que hace `leerEstado`.
//   2. No se reescribe ni una regla del juego. El pliegue es `aplicarEvento`, el
//      mismo de `/anotador/` y del directo. Contar puntos aquí a mano sería una
//      segunda versión de quién se lleva cada rally, que es exactamente lo que
//      `lado_punto` existe para evitar.
//
// Y no devuelve ni un nombre de jugador: los pone el cliente desde
// `/api/plantilla`, que ya proyecta a quien pidió no salir del álbum (dorsal, sin
// nombre y sin foto).

import { METRICAS } from "./estadisticas";
import { aplicarEvento, marcadorInicial, type EstadoMarcador, type EventoFila } from "./marcador";
import { normalizarReglas } from "./reglas";

/** Lo que se enseña de un jugador en un solo partido: los partidos jugados, no. */
export const METRICAS_PARTIDO = METRICAS.filter((metrica) => !metrica.derivada);

/**
 * Una línea del historial.
 *
 * Las claves cortas son **las mismas que `LineaFeed`** del directo (`o`, `c`,
 * `t`, `j`, `x`, `l`, `p`, `s`) a propósito: así el mismo código de cliente pinta
 * las dos pantallas y no hay dos vocabularios que mantener a la vez.
 *
 * Lo que añade es el marcador que dejó, que el directo no puede saber para los
 * sets ya cerrados:
 *
 *   a, b   = puntos DENTRO de su set después de la línea
 *   sa, sb = sets después de la línea
 *   pos    = el hueco de `partido_alineacion` que cambia de dueño (sólo cambios)
 */
export interface LineaHistorial {
  o: number;
  c?: number;
  t: string;
  j?: number | null;
  x?: number;
  l?: string | null;
  p?: string | null;
  s: number;
  a: number;
  b: number;
  sa: number;
  sb: number;
  pos?: number;
}

interface MarcadorDeLinea {
  a: number;
  b: number;
  sa: number;
  sb: number;
}

interface PartidoHistorialRow {
  id: string;
  ronda: string;
  pista: string | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  elapsed_ms: number;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  points_a: number;
  points_b: number;
  sets_a: number;
  sets_b: number;
  set_number: number;
  set_history: string;
  winner: "A" | "B" | null;
  reglas: string;
}

/**
 * El marcador que deja una línea, contado dentro de su set.
 *
 * El punto que cierra un set es el caso que obliga a esto: el pliegue pone los
 * puntos a 0–0 y sube el set, así que leer `puntos` después daría «0–0» justo
 * para el punto más importante del set. El parcial recién cerrado está en
 * `historial`, y es el que se enseña.
 */
function marcadorTras(antes: EstadoMarcador, despues: EstadoMarcador): MarcadorDeLinea {
  const cerroSet = despues.historial.length > antes.historial.length;
  const parcial = despues.historial[despues.historial.length - 1];
  return {
    a: cerroSet && parcial ? parcial.a : despues.puntos.A,
    b: cerroSet && parcial ? parcial.b : despues.puntos.B,
    sa: despues.sets.A,
    sb: despues.sets.B
  };
}

const AL_EMPEZAR: MarcadorDeLinea = { a: 0, b: 0, sa: 0, sb: 0 };

export async function historialDePartido(db: D1Database, partidoId: string) {
  const partido = await db
    .prepare(
      `SELECT id, ronda, pista, status, scheduled_at, started_at, elapsed_ms,
              equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre,
              points_a, points_b, sets_a, sets_b, set_number, set_history, winner, reglas
         FROM partidos WHERE id = ?1`
    )
    .bind(partidoId)
    .first<PartidoHistorialRow>();
  if (!partido) return null;

  const reglas = normalizarReglas(partido.reglas).partido;

  const [eventos, cambios, alineacion, estadisticas] = await Promise.all([
    db
      .prepare(
        `SELECT orden, tipo, lado_jugador, jugador_id, lado_punto, puntos_a, puntos_b, sets_a, sets_b
           FROM partido_eventos WHERE partido_id = ?1 ORDER BY orden ASC`
      )
      .bind(partidoId)
      .all<EventoFila>(),
    db
      .prepare(
        `SELECT id, tras_orden, lado, entra_jugador_id, sale_jugador_id, posicion
           FROM partido_cambios WHERE partido_id = ?1 ORDER BY tras_orden ASC, id ASC`
      )
      .bind(partidoId)
      .all<{
        id: number;
        tras_orden: number;
        lado: "A" | "B";
        entra_jugador_id: number;
        sale_jugador_id: number;
        posicion: number;
      }>(),
    db
      .prepare(
        `SELECT jugador_id, lado, orden FROM partido_alineacion
          WHERE partido_id = ?1 ORDER BY lado ASC, orden ASC`
      )
      .bind(partidoId)
      .all<{ jugador_id: number; lado: "A" | "B"; orden: number }>(),
    db
      .prepare(
        `SELECT jugador_id, ${METRICAS_PARTIDO.map((m) => m.columna).join(", ")}
           FROM estadisticas WHERE partido_id = ?1`
      )
      .bind(partidoId)
      .all<Record<string, number>>()
  ]);

  // Una sola pasada: el estado tras cada evento es a la vez lo que pinta su línea
  // y el ancla de los cambios colgados de ese orden.
  const lineas: LineaHistorial[] = [];
  const anclas: { orden: number; marcador: MarcadorDeLinea; set: number }[] = [];
  let estado = marcadorInicial();

  for (const fila of eventos.results) {
    const antes = estado;
    estado = aplicarEvento(antes, fila, reglas);
    const marcador = marcadorTras(antes, estado);
    // Un `ajuste` no se juega dentro de un set: lo establece. El resto de los
    // eventos pertenecen al set en el que se anotaron, o sea al de ANTES.
    const set = fila.tipo === "ajuste" ? estado.setNumero : antes.setNumero;

    anclas.push({ orden: fila.orden, marcador, set });
    lineas.push({
      o: fila.orden,
      t: fila.tipo,
      j: fila.jugador_id,
      l: fila.lado_jugador,
      p: fila.lado_punto,
      s: set,
      ...marcador
    });
  }

  /*
   * El marcador con el que sale un cambio: el del último evento que sobreviva en
   * su ancla o antes.
   *
   * `tras_orden` NO es clave ajena, y eso no es un descuido: el punto al que se
   * ancló un cambio se puede deshacer y el cambio siguió ocurriendo. Buscar el
   * orden exacto y caer al principio del partido cuando no aparece es el fallo
   * que ya se pagó una vez en `sentenciasSetNumero` — mandaba un cambio del
   * tercer set al primero. Las dos listas vienen ordenadas, así que el barrido
   * es uno solo para todos los cambios.
   */
  let cursor = 0;
  for (const cambio of cambios.results) {
    while (cursor < anclas.length && anclas[cursor]!.orden <= cambio.tras_orden) cursor += 1;
    const ancla = cursor > 0 ? anclas[cursor - 1]! : null;

    lineas.push({
      o: cambio.tras_orden,
      c: cambio.id,
      t: "cambio",
      j: cambio.entra_jugador_id,
      x: cambio.sale_jugador_id,
      l: cambio.lado,
      s: ancla ? ancla.set : 1,
      pos: cambio.posicion,
      ...(ancla ? ancla.marcador : AL_EMPEZAR)
    });
  }

  // (orden, el cambio detrás del punto, id) — el id desempata dos cambios
  // seguidos sin punto entre medias. Mismo criterio que `feedPublico`.
  lineas.sort((a, b) => a.o - b.o || (a.c ? 1 : 0) - (b.c ? 1 : 0) || (a.c ?? 0) - (b.c ?? 0));

  /*
   * La alineación con la que acabó el partido, y el hueco que ocupa cada uno.
   * Los huecos van en su propia lista, en paralelo: `enPistaFinal` tiene la misma
   * forma que el `enPista` del directo para que el pintado sea el mismo, y añadir
   * ahí un objeto obligaría a que las dos pantallas dejaran de compartirlo.
   */
  const enPistaFinal: { A: number[]; B: number[] } = { A: [], B: [] };
  const huecos: { A: number[]; B: number[] } = { A: [], B: [] };
  for (const fila of alineacion.results) {
    enPistaFinal[fila.lado].push(fila.jugador_id);
    huecos[fila.lado].push(fila.orden);
  }

  return {
    partido: {
      id: partido.id,
      ronda: partido.ronda,
      pista: partido.pista,
      status: partido.status,
      scheduledAt: partido.scheduled_at,
      startedAt: partido.started_at,
      elapsedMs: partido.elapsed_ms,
      setNumber: partido.set_number,
      points: { A: partido.points_a, B: partido.points_b },
      sets: { A: partido.sets_a, B: partido.sets_b },
      history: leerHistorial(partido.set_history),
      winner: partido.winner,
      reglas,
      teams: {
        A: { id: partido.equipo_a_id, name: partido.equipo_a_nombre },
        B: { id: partido.equipo_b_id, name: partido.equipo_b_nombre }
      }
    },
    lineas,
    enPistaFinal,
    huecos,
    totales: estadisticas.results.map((fila) => {
      const totales: Record<string, number> = { jugadorId: fila.jugador_id };
      for (const metrica of METRICAS_PARTIDO) totales[metrica.clave] = fila[metrica.columna] ?? 0;
      return totales;
    }),
    /*
     * Las etiquetas viajan con los datos, igual que `tipos` en `/api/plantilla`:
     * copiarlas al cliente sería una lista más que mantener a mano, y ya hay una
     * (la de `players-list.js`) que necesita un test de paridad para no mentir.
     */
    metricas: METRICAS_PARTIDO.map((metrica) => ({ clave: metrica.clave, etiqueta: metrica.etiqueta }))
  };
}

function leerHistorial(valor: string) {
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
