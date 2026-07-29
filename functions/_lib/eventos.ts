// Escribir el log de un partido: anotar, deshacer, corregir y recalcular.
//
// El log es la fuente de verdad. El marcador de `partidos` y las filas de
// `estadisticas` se DERIVAN de él en cada escritura, con `plegarEventos` y una
// única consulta agregada. Eso es lo que hace que deshacer un punto sea borrar
// una fila y volver a plegar, en vez de restar a mano y confiar en que cuadre.
//
// Un solo camino de recálculo, también al añadir. La alternativa —tocar solo al
// jugador afectado al anotar y recalcular entero al deshacer— ahorraría unas
// pocas filas escritas por punto, pero a cambio habría dos formas de llegar al
// mismo estado y un día dejarían de coincidir. Con 40 partidos de ~60 puntos
// salen ~15.000 filas escritas al día, muy por debajo de las 100.000 del plan
// gratuito de D1: no hay ninguna razón para pagar ese riesgo.

import {
  estadisticasDeEventos,
  ladoDelPunto,
  plegarEventos,
  PUNTUA,
  type EstadoMarcador,
  type EventoFila,
  type Lado,
  type TipoEvento
} from "./marcador";
import { normalizarReglas } from "./reglas";

export interface PartidoAnotable {
  id: string;
  status: "scheduled" | "live" | "finished";
  origen_marcador: string;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  points_a: number;
  points_b: number;
  sets_a: number;
  sets_b: number;
  reglas: string;
  started_at: string | null;
  elapsed_ms: number;
}

export interface AlineacionFila {
  jugador_id: number;
  lado: Lado;
  nombre: string;
  apellidos: string;
  dorsal: number | null;
}

export interface EventoNuevo {
  tipo: TipoEvento;
  jugadorId: number;
  ladoJugador: Lado;
  ladoPunto: Lado | null;
}

const TIPOS_ANOTABLES = new Set<TipoEvento>(["remate", "ace", "bloqueo", "defensa", "error"]);

/**
 * Valida lo que manda el cliente. Solo llegan `tipo` y `jugadorId`: el lado del
 * jugador sale de la alineación y el lado del punto lo calcula el servidor.
 *
 * Aceptar cualquiera de los dos del cliente sería regalar la posibilidad de
 * invertir el marcador, y el daño no se vería hasta el final del torneo.
 */
export function validarEvento(
  body: Record<string, unknown>,
  alineacion: readonly AlineacionFila[]
): { evento: EventoNuevo } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};

  const tipo = String(body.tipo || "") as TipoEvento;
  if (!TIPOS_ANOTABLES.has(tipo)) campos.tipo = "Esa acción no existe.";

  const jugadorId = Number(body.jugadorId);
  const enPista = alineacion.find((fila) => fila.jugador_id === jugadorId);
  if (!Number.isInteger(jugadorId) || jugadorId <= 0) campos.jugadorId = "Elige a quien hizo la acción.";
  else if (!enPista) campos.jugadorId = "Esa persona no está en la alineación de este partido.";

  if (Object.keys(campos).length > 0) return { campos };

  return {
    evento: {
      tipo,
      jugadorId,
      ladoJugador: enPista!.lado,
      ladoPunto: ladoDelPunto(tipo, enPista!.lado)
    }
  };
}

export interface ResultadoAnotacion {
  estado: EstadoMarcador;
  eventos: EventoPublico[];
  /** Cuántos eventos hay. Es el `ordenEsperado` de la siguiente escritura. */
  siguienteOrden: number;
}

export interface EventoPublico {
  orden: number;
  tipo: TipoEvento;
  jugadorId: number | null;
  jugador: string | null;
  ladoJugador: Lado | null;
  ladoPunto: Lado | null;
  setNumero: number;
}

/** Choque entre dos anotadores, o petición con un orden desfasado. */
export class ConflictoDeOrden extends Error {
  constructor() {
    super("Alguien acaba de anotar en este partido. Vuelve a cargarlo antes de seguir.");
    this.name = "ConflictoDeOrden";
  }
}

async function leerEventos(db: D1Database, partidoId: string): Promise<EventoFila[]> {
  const { results } = await db
    .prepare(
      `SELECT orden, tipo, lado_jugador, jugador_id, lado_punto, puntos_a, puntos_b, sets_a, sets_b
         FROM partido_eventos WHERE partido_id = ?1 ORDER BY orden ASC`
    )
    .bind(partidoId)
    .all<EventoFila>();
  return results;
}

/**
 * Reescribe marcador y estadísticas a partir del log. Devuelve las sentencias
 * en vez de ejecutarlas, para que quepan en el mismo `batch` que la escritura
 * que las provoca: si algo falla, no queda un log sin su marcador.
 */
function sentenciasDerivadas(
  db: D1Database,
  partido: PartidoAnotable,
  eventos: readonly EventoFila[]
): { sentencias: D1PreparedStatement[]; estado: EstadoMarcador } {
  const reglas = normalizarReglas(partido.reglas).partido;
  const estado = plegarEventos(eventos, reglas);
  const ahora = new Date().toISOString();

  const elapsed =
    estado.terminado && partido.started_at
      ? Math.max(0, Date.now() - new Date(partido.started_at).getTime())
      : partido.elapsed_ms;

  const sentencias: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE partidos SET
           points_a = ?1, points_b = ?2, sets_a = ?3, sets_b = ?4, set_number = ?5,
           set_history = ?6, status = ?7, winner = ?8, elapsed_ms = ?9,
           origen_marcador = 'eventos', updated_at = ?10
         WHERE id = ?11`
      )
      .bind(
        estado.puntos.A,
        estado.puntos.B,
        estado.sets.A,
        estado.sets.B,
        estado.setNumero,
        JSON.stringify(estado.historial),
        estado.terminado ? "finished" : "live",
        estado.winner,
        elapsed,
        ahora,
        partido.id
      ),

    /*
     * Las estadísticas sí son un agregado puro, así que caben en una sentencia
     * sea cual sea el número de jugadores. `puntos` cuenta las acciones que
     * ganaron el punto para el propio equipo: un error da punto al rival y por
     * eso no suma puntos a nadie, solo errores a quien lo comete.
     */
    db
      .prepare(
        `INSERT INTO estadisticas (jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores)
         SELECT jugador_id, partido_id,
                SUM(CASE WHEN tipo IN ('remate','ace','bloqueo','error') AND lado_punto = lado_jugador THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'remate' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'bloqueo' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'ace' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'defensa' THEN 1 ELSE 0 END),
                SUM(CASE WHEN tipo = 'error' THEN 1 ELSE 0 END)
           FROM partido_eventos
          WHERE partido_id = ?1 AND jugador_id IS NOT NULL AND tipo <> 'ajuste'
          GROUP BY jugador_id, partido_id
         ON CONFLICT(jugador_id, partido_id) DO UPDATE SET
           puntos = excluded.puntos, remates = excluded.remates, bloqueos = excluded.bloqueos,
           aces = excluded.aces, defensas = excluded.defensas, errores = excluded.errores,
           updated_at = datetime('now')`
      )
      .bind(partido.id),

    // Quien deja de aparecer en el log deja de tener ficha en este partido.
    db
      .prepare(
        `DELETE FROM estadisticas
          WHERE partido_id = ?1
            AND jugador_id NOT IN (
              SELECT DISTINCT jugador_id FROM partido_eventos
               WHERE partido_id = ?1 AND jugador_id IS NOT NULL AND tipo <> 'ajuste'
            )`
      )
      .bind(partido.id)
  ];

  return { sentencias, estado };
}

/**
 * El estado actual del partido según su log, sin escribir nada. Lo usan tanto
 * las escrituras (para devolver el resultado) como el GET del endpoint: una
 * sola forma de leer, para que no puedan discrepar.
 */
export async function leerEstado(db: D1Database, partido: PartidoAnotable): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  const reglas = normalizarReglas(partido.reglas).partido;

  const { results: nombres } = await db
    .prepare(
      `SELECT e.orden, j.nombre, j.apellidos
         FROM partido_eventos e
         LEFT JOIN jugadores j ON j.id = e.jugador_id
        WHERE e.partido_id = ?1`
    )
    .bind(partido.id)
    .all<{ orden: number; nombre: string | null; apellidos: string | null }>();
  const porOrden = new Map(nombres.map((fila) => [fila.orden, fila]));

  // El número de set de cada evento se saca replegando: no se guarda, porque
  // corregir un evento antiguo puede cambiar en qué set cayeron los siguientes.
  const publicos: EventoPublico[] = [];
  let acumulado: EventoFila[] = [];
  for (const evento of eventos) {
    const antes = plegarEventos(acumulado, reglas);
    const persona = porOrden.get(evento.orden);
    publicos.push({
      orden: evento.orden,
      tipo: evento.tipo,
      jugadorId: evento.jugador_id,
      jugador: persona?.nombre ? `${persona.nombre} ${persona.apellidos ?? ""}`.trim() : null,
      ladoJugador: evento.lado_jugador,
      ladoPunto: evento.lado_punto,
      setNumero: antes.setNumero
    });
    acumulado = [...acumulado, evento];
  }

  return {
    estado: plegarEventos(eventos, reglas),
    eventos: publicos,
    siguienteOrden: eventos.length === 0 ? 0 : eventos[eventos.length - 1]!.orden + 1
  };
}

/**
 * Añade un evento al log.
 *
 * `ordenEsperado` es el control de concurrencia: si otro anotador se adelantó,
 * el UNIQUE(partido_id, orden) rechaza la fila y aquí sale un 409 en vez de
 * pisar su punto en silencio.
 */
export async function registrarEvento(
  db: D1Database,
  partido: PartidoAnotable,
  evento: EventoNuevo,
  ordenEsperado: number,
  usuarioId: number
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  const siguiente = eventos.length === 0 ? 0 : eventos[eventos.length - 1]!.orden + 1;
  if (ordenEsperado !== siguiente) throw new ConflictoDeOrden();

  const reglas = normalizarReglas(partido.reglas).partido;
  const setNumero = plegarEventos(eventos, reglas).setNumero;

  const fila: EventoFila = {
    orden: siguiente,
    tipo: evento.tipo,
    lado_jugador: evento.ladoJugador,
    jugador_id: evento.jugadorId,
    lado_punto: evento.ladoPunto,
    puntos_a: null,
    puntos_b: null,
    sets_a: null,
    sets_b: null
  };

  const { sentencias } = sentenciasDerivadas(db, partido, [...eventos, fila]);

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO partido_eventos
             (partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto, usuario_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        )
        .bind(
          partido.id,
          siguiente,
          setNumero,
          evento.tipo,
          evento.ladoJugador,
          evento.jugadorId,
          evento.ladoPunto,
          usuarioId
        ),
      ...sentencias
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ConflictoDeOrden();
    throw error;
  }

  return await leerEstado(db, partido);
}

/** Quita el último evento y vuelve a plegar. */
export async function deshacerUltimo(
  db: D1Database,
  partido: PartidoAnotable,
  ordenEsperado: number
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  if (eventos.length === 0) return await leerEstado(db, partido);

  const ultimo = eventos[eventos.length - 1]!;
  if (ordenEsperado !== ultimo.orden) throw new ConflictoDeOrden();

  const { sentencias } = sentenciasDerivadas(db, partido, eventos.slice(0, -1));
  await db.batch([
    db.prepare("DELETE FROM partido_eventos WHERE partido_id = ?1 AND orden = ?2").bind(partido.id, ultimo.orden),
    ...sentencias
  ]);

  return await leerEstado(db, partido);
}

/**
 * Cambia el tipo o el autor de un evento ya anotado.
 *
 * Corregir uno antiguo puede cambiar quién ganó un set —y con él el partido—,
 * porque todo lo posterior se vuelve a plegar encima.
 */
export async function corregirEvento(
  db: D1Database,
  partido: PartidoAnotable,
  orden: number,
  cambios: { tipo?: TipoEvento; jugadorId?: number },
  alineacion: readonly AlineacionFila[]
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  const indice = eventos.findIndex((evento) => evento.orden === orden);
  if (indice === -1) throw new ConflictoDeOrden();

  const actual = eventos[indice]!;
  if (actual.tipo === "ajuste") {
    throw new Error("El saldo de apertura no se corrige: suelta la anotación y vuelve a adoptarla.");
  }

  const tipo = cambios.tipo ?? actual.tipo;
  const jugadorId = cambios.jugadorId ?? actual.jugador_id!;
  const enPista = alineacion.find((fila) => fila.jugador_id === jugadorId);
  if (!TIPOS_ANOTABLES.has(tipo) || !enPista) {
    throw new Error("Revisa la acción y a quién se le atribuye.");
  }

  const corregido: EventoFila = {
    ...actual,
    tipo,
    jugador_id: jugadorId,
    lado_jugador: enPista.lado,
    lado_punto: ladoDelPunto(tipo, enPista.lado)
  };
  const nuevos = [...eventos];
  nuevos[indice] = corregido;

  const { sentencias } = sentenciasDerivadas(db, partido, nuevos);
  await db.batch([
    db
      .prepare(
        `UPDATE partido_eventos SET tipo = ?1, jugador_id = ?2, lado_jugador = ?3, lado_punto = ?4
          WHERE partido_id = ?5 AND orden = ?6`
      )
      .bind(tipo, jugadorId, enPista.lado, corregido.lado_punto, partido.id, orden),
    ...sentencias
  ]);

  return await leerEstado(db, partido);
}

/** Vuelve a derivar todo desde el log, sin tocarlo. Idempotente. */
export async function recalcularPartido(db: D1Database, partido: PartidoAnotable): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  const { sentencias } = sentenciasDerivadas(db, partido, eventos);
  await db.batch(sentencias);
  return await leerEstado(db, partido);
}

/** Quién está en pista. Reemplaza la alineación entera de ese lado. */
export async function fijarAlineacion(
  db: D1Database,
  partidoId: string,
  lado: Lado,
  jugadorIds: readonly number[]
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM partido_alineacion WHERE partido_id = ?1 AND lado = ?2").bind(partidoId, lado),
    ...jugadorIds.map((jugadorId, indice) =>
      db
        .prepare("INSERT INTO partido_alineacion (partido_id, jugador_id, lado, orden) VALUES (?1, ?2, ?3, ?4)")
        .bind(partidoId, jugadorId, lado, indice)
    )
  ]);
}

/**
 * Adopta un partido que se venía llevando a mano.
 *
 * Escribe un evento `ajuste` con el saldo actual. No es un punto: no lleva
 * jugador y no genera estadísticas. Es la única forma honesta de que un partido
 * empezado sin anotador gane uno a mitad, porque de los puntos anteriores no se
 * sabe quién los metió y no se van a inventar.
 */
export async function adoptarMarcador(
  db: D1Database,
  partido: PartidoAnotable,
  usuarioId: number
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  if (eventos.length > 0) throw new Error("Este partido ya tiene anotación. No hace falta adoptarlo.");

  const fila: EventoFila = {
    orden: 0,
    tipo: "ajuste",
    lado_jugador: null,
    jugador_id: null,
    lado_punto: null,
    puntos_a: partido.points_a,
    puntos_b: partido.points_b,
    sets_a: partido.sets_a,
    sets_b: partido.sets_b
  };

  const { sentencias } = sentenciasDerivadas(db, partido, [fila]);
  await db.batch([
    db
      .prepare(
        `INSERT INTO partido_eventos
           (partido_id, orden, set_numero, tipo, puntos_a, puntos_b, sets_a, sets_b, usuario_id)
         VALUES (?1, 0, ?2, 'ajuste', ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        partido.id,
        partido.sets_a + partido.sets_b + 1,
        partido.points_a,
        partido.points_b,
        partido.sets_a,
        partido.sets_b,
        usuarioId
      ),
    ...sentencias
  ]);

  return await leerEstado(db, partido);
}

/**
 * Devuelve el mando al panel. El marcador derivado se queda congelado en las
 * columnas planas y el log se conserva: soltar no es borrar lo anotado.
 */
export async function soltarAnotacion(db: D1Database, partidoId: string): Promise<void> {
  await db
    .prepare("UPDATE partidos SET origen_marcador = 'manual', updated_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), partidoId)
    .run();
}

/** Los jugadores en pista, con su ficha mínima para pintar los botones. */
export async function leerAlineacion(db: D1Database, partidoId: string): Promise<AlineacionFila[]> {
  const { results } = await db
    .prepare(
      // El dorsal es del jugador desde la 0023: ya no hay que cruzarlo por
      // correo con la cuenta de Google, y quien nunca inició sesión también lo
      // lleva si la organización se lo puso.
      `SELECT a.jugador_id, a.lado, j.nombre, j.apellidos, j.dorsal
         FROM partido_alineacion a
         JOIN jugadores j ON j.id = a.jugador_id
        WHERE a.partido_id = ?1
        ORDER BY a.lado ASC, a.orden ASC`
    )
    .bind(partidoId)
    .all<AlineacionFila>();
  return results;
}

export { PUNTUA };
