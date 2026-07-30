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
  ACCION_POR_CLAVE,
  aplicarEvento,
  ladoDelPunto,
  marcadorInicial,
  plegarEventos,
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
  /** El hueco que ocupa en su mitad. Lo hereda quien entre en su lugar. */
  orden: number;
  nombre: string;
  apellidos: string;
  dorsal: number | null;
}

/** Un cambio de jugador. Vive fuera del log de puntos: no pliega ni puntúa. */
export interface CambioFila {
  id: number;
  tras_orden: number;
  lado: Lado;
  entra_jugador_id: number;
  sale_jugador_id: number;
  posicion: number;
  set_numero: number;
}

export interface EventoNuevo {
  tipo: TipoEvento;
  jugadorId: number;
  ladoJugador: Lado;
  ladoPunto: Lado | null;
}

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

/**
 * Un «no» con motivo, dirigido a quien está anotando.
 *
 * Existe para separarlo de lo que NO es esto. El endpoint devolvía como 409
 * cualquier `Error` de menos de 200 caracteres, con su texto: así, un fallo
 * interno de D1 —«variable number must be between ?1 and ?100»— aterrizaba en el
 * móvil del anotador con pinta de regla del juego, y de paso contaba por dentro
 * cómo está construida la consulta. Lo que sale por aquí es lo que se ha
 * decidido decir; lo demás es un 500 y una línea en el log.
 */
export class ErrorDeAnotacion extends Error {
  constructor(
    message: string,
    readonly estado: number = 409
  ) {
    super(message);
    this.name = "ErrorDeAnotacion";
  }
}

/** Choque entre dos anotadores, o petición con un orden desfasado. */
export class ConflictoDeOrden extends ErrorDeAnotacion {
  constructor() {
    super("Alguien acaba de anotar en este partido. Vuelve a cargarlo antes de seguir.");
    this.name = "ConflictoDeOrden";
  }
}

/**
 * El partido trae un marcador llevado a mano y todavía no tiene log.
 *
 * Anotar el primer punto sin más lo borraría: el pliegue reescribe las columnas
 * planas, así que un 8–6 con sets 1–1 pasaría a 1–0 en el primer set y de los
 * puntos anteriores no quedaría rastro en ninguna parte. Hay que decidir antes
 * qué se hace con ellos —adoptarlos o ponerlos a cero—, y esa decisión la
 * bloquea el SERVIDOR y no la pantalla: si dependiera del cliente, un anotador
 * que entra por la URL sin pasar por el aviso seguiría vaciando el marcador.
 */
export class MarcadorSinAdoptar extends ErrorDeAnotacion {
  constructor(readonly marcadorPanel: MarcadorPlano) {
    super(
      `Este partido va ${marcadorPanel.puntos.A}–${marcadorPanel.puntos.B} (sets ` +
        `${marcadorPanel.sets.A}–${marcadorPanel.sets.B}) anotado a mano. Adóptalo o ponlo a cero antes de anotar.`
    );
    this.name = "MarcadorSinAdoptar";
  }
}

/** El partido ya está decidido: no caben más puntos. */
export class PartidoTerminado extends ErrorDeAnotacion {
  constructor() {
    super("Este partido ya ha terminado. Para cambiar el resultado, deshaz o corrige el punto que lo cerró.");
    this.name = "PartidoTerminado";
  }
}

export interface MarcadorPlano {
  puntos: { A: number; B: number };
  sets: { A: number; B: number };
}

/** El marcador de las columnas de `partidos`, el que lleva el panel. */
export const marcadorPlano = (partido: PartidoAnotable): MarcadorPlano => ({
  puntos: { A: partido.points_a, B: partido.points_b },
  sets: { A: partido.sets_a, B: partido.sets_b }
});

/**
 * ¿Hay puntos apuntados a mano que el log todavía no conoce?
 *
 * Se compara el marcador plano con lo que da el log, en vez de mirar sólo si el
 * log está vacío. La versión anterior («sin eventos y con puntos») se saltaba
 * entera por el camino de «soltar»: el anotador suelta el partido, alguien
 * corrige el marcador desde el panel, y al volver a pulsar el log ya no estaba
 * vacío — así que el cerrojo no saltaba y el pliegue reescribía las columnas
 * planas llevándose la corrección por delante. Es exactamente la pérdida
 * silenciosa que esto existe para impedir, entrando por la otra puerta.
 *
 * Con `origen_marcador = 'eventos'` no hay nada que decidir: manda el log por
 * definición. Y si el panel no ha tocado nada mientras estaba suelto, plano y
 * plegado coinciden y anotar sigue sin preguntar nada.
 */
export const hayMarcadorAMano = (partido: PartidoAnotable, segunElLog: EstadoMarcador): boolean =>
  partido.origen_marcador !== "eventos" &&
  (segunElLog.puntos.A !== partido.points_a ||
    segunElLog.puntos.B !== partido.points_b ||
    segunElLog.sets.A !== partido.sets_a ||
    segunElLog.sets.B !== partido.sets_b);

async function leerEventos(db: D1Database, partidoId: string): Promise<EventoFila[]> {
  const { results } = await db
    .prepare(
      `SELECT orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto, puntos_a, puntos_b, sets_a, sets_b
         FROM partido_eventos WHERE partido_id = ?1 ORDER BY orden ASC`
    )
    .bind(partidoId)
    .all<EventoFila>();
  return results;
}

/**
 * Sube el contador que hace que el ETag del directo no mienta.
 *
 * Va en la misma fila de `partidos` que `versionDirecto` ya lee, así que cubrir
 * las escrituras que no tocan el marcador —la alineación, un cambio de jugador,
 * un bloqueo que no puntúa— no encarece el camino barato (el 304). Devuelve la
 * sentencia en vez de ejecutarla para que entre en el mismo `batch` que la
 * provoca: un contador que no sube deja al espectador con el cuerpo viejo y sin
 * saberlo.
 */
export const sentenciaLogVersion = (db: D1Database, partidoId: string): D1PreparedStatement =>
  db.prepare("UPDATE partidos SET log_version = log_version + 1, updated_at = ?1 WHERE id = ?2").bind(
    new Date().toISOString(),
    partidoId
  );

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
           origen_marcador = 'eventos', log_version = log_version + 1, updated_at = ?10
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
  const reglas = normalizarReglas(partido.reglas).partido;

  /*
   * Una consulta, no dos. Antes se leía el log y luego se volvía a leer entero
   * para sacar los nombres: el mismo recorrido de filas hecho dos veces, en un
   * endpoint que se llama en cada punto y cuyo coste crece con lo anotado. D1
   * factura filas leídas.
   */
  const { results: filas } = await db
    .prepare(
      `SELECT e.orden, e.tipo, e.lado_jugador, e.jugador_id, e.lado_punto,
              e.puntos_a, e.puntos_b, e.sets_a, e.sets_b,
              j.nombre, j.apellidos
         FROM partido_eventos e
         LEFT JOIN jugadores j ON j.id = e.jugador_id
        WHERE e.partido_id = ?1
        ORDER BY e.orden ASC`
    )
    .bind(partido.id)
    .all<EventoFila & { nombre: string | null; apellidos: string | null }>();

  /*
   * El número de set de cada evento no se guarda —corregir uno antiguo puede
   * cambiar en qué set cayeron los siguientes—, así que se saca plegando. En una
   * sola pasada: antes se replegaba el log entero por cada evento, que a 250
   * eventos son ~31.000 pliegues para pintar una lista de doce líneas.
   */
  const publicos: EventoPublico[] = [];
  let estado = marcadorInicial();
  for (const fila of filas) {
    publicos.push({
      orden: fila.orden,
      tipo: fila.tipo,
      jugadorId: fila.jugador_id,
      jugador: fila.nombre ? `${fila.nombre} ${fila.apellidos ?? ""}`.trim() : null,
      ladoJugador: fila.lado_jugador,
      ladoPunto: fila.lado_punto,
      setNumero: estado.setNumero
    });
    estado = aplicarEvento(estado, fila, reglas);
  }

  return {
    estado,
    eventos: publicos,
    siguienteOrden: filas.length === 0 ? 0 : filas[filas.length - 1]!.orden + 1
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
  const reglas = normalizarReglas(partido.reglas).partido;
  const antes = plegarEventos(eventos, reglas);

  // Antes que nada: si viene con marcador a mano, no se anota encima.
  if (hayMarcadorAMano(partido, antes)) throw new MarcadorSinAdoptar(marcadorPlano(partido));

  /*
   * Y no se anota por encima del final. `aplicarPunto` ignora los puntos que
   * llegan con el partido ya decidido, pero la sentencia agregada de
   * estadísticas cuenta TODAS las filas del log: seguir pulsando después del
   * último punto engordaba la ficha del jugador sin mover el marcador, y el
   * partido acababa con más puntos repartidos entre sus jugadores que puntos
   * llegó a tener. La forma de tocar un resultado cerrado es deshacer o
   * corregir, que sí vuelven a plegarlo entero.
   */
  if (antes.terminado) throw new PartidoTerminado();

  const siguiente = eventos.length === 0 ? 0 : eventos[eventos.length - 1]!.orden + 1;
  if (ordenEsperado !== siguiente) throw new ConflictoDeOrden();

  const setNumero = antes.setNumero;

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

  /*
   * El saldo de apertura no se deshace. Borrar esa fila volvía a plegar un log
   * vacío: el 8–6 adoptado pasaba a 0–0 y, como `origen_marcador` se queda en
   * 'eventos', ya no había marcador a mano que ofrecer — no existía forma de
   * recuperarlo. Un toque en «Deshacer» y ocho puntos no estaban en ninguna
   * parte. `corregirEvento` ya decía que ese evento no se toca; esto lo dice
   * igual, y la salida es la misma: soltar y volver a adoptar.
   */
  if (ultimo.tipo === "ajuste") {
    throw new ErrorDeAnotacion(
      "El saldo de apertura no se deshace: suelta la anotación y vuelve a adoptarla."
    );
  }

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
  cambios: { tipo?: TipoEvento; jugadorId?: number; punto?: boolean },
  alineacion: readonly AlineacionFila[]
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  const indice = eventos.findIndex((evento) => evento.orden === orden);
  if (indice === -1) throw new ConflictoDeOrden();

  const actual = eventos[indice]!;
  if (actual.tipo === "ajuste") {
    throw new ErrorDeAnotacion("El saldo de apertura no se corrige: suelta la anotación y vuelve a adoptarla.");
  }

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
  const nuevos = [...eventos];
  nuevos[indice] = corregido;

  const { sentencias } = sentenciasDerivadas(db, partido, nuevos);
  await db.batch([
    db
      .prepare(
        `UPDATE partido_eventos SET tipo = ?1, jugador_id = ?2, lado_jugador = ?3, lado_punto = ?4
          WHERE partido_id = ?5 AND orden = ?6`
      )
      .bind(tipo, jugadorId, lado, corregido.lado_punto, partido.id, orden),
    ...(await sentenciasSetNumero(db, partido, nuevos)),
    ...sentencias
  ]);

  return await leerEstado(db, partido);
}

/**
 * A qué lado pertenece cada jugador que ha pisado este partido.
 *
 * La alineación **actual** manda, pero no basta: en cuanto hay un cambio, quien
 * salió de pista dejaría de poder recibir correcciones — y corregir «ese remate
 * fue de Ana, no de Nuria» es justo lo que hace falta después de un cambio. El
 * log ya dice de qué lado jugaba cada uno, así que se completa con él.
 */
function ladosDelPartido(
  eventos: readonly EventoFila[],
  alineacion: readonly AlineacionFila[]
): Map<number, Lado> {
  const lados = new Map<number, Lado>();
  for (const evento of eventos) {
    if (evento.jugador_id !== null && evento.lado_jugador) lados.set(evento.jugador_id, evento.lado_jugador);
  }
  for (const fila of alineacion) lados.set(fila.jugador_id, fila.lado);
  return lados;
}

/**
 * Reescribe el `set_numero` de lo que haya cambiado de set al replegar.
 *
 * Corregir un evento antiguo puede mover una frontera de set (decir que aquel
 * bloqueo sí ganó el punto desplaza todo lo posterior), y la columna guardada es
 * lo que lee el historial público: sin esto, el feed diría «Set 2» en líneas del
 * set 1 y sería un fallo invisible para cualquier test que solo mire el marcador.
 * Los cambios de jugador se anclan a un evento, así que se recolocan igual.
 */
async function sentenciasSetNumero(
  db: D1Database,
  partido: PartidoAnotable,
  eventos: readonly EventoFila[]
): Promise<D1PreparedStatement[]> {
  const reglas = normalizarReglas(partido.reglas).partido;
  const sentencias: D1PreparedStatement[] = [];
  /**
   * El set en el que queda el partido tras cada `orden`, en orden ascendente.
   *
   * Es una lista y no un mapa porque `partido_cambios.tras_orden` puede apuntar
   * a un evento que ya no existe: no es clave ajena a propósito —el punto al que
   * se ancló un cambio se puede deshacer, y el cambio siguió ocurriendo—. Con un
   * mapa había que buscar ese orden exacto, y al no encontrarlo se caía a 1: un
   * cambio hecho en el tercer set aparecía en el historial público como del
   * primero. Lo que vale es el set del último evento que **sí** sobrevive antes
   * de esa posición.
   */
  const tras: { orden: number; set: number }[] = [];

  /*
   * Una sola pasada. Replegar el log entero por cada evento —y aquí dos veces,
   * antes y después— es O(n²) en el camino que se recorre en cada punto: a 250
   * eventos son ~62.000 pliegues por punto anotado, en un móvil, a pie de pista.
   * `aplicarEvento` es ese mismo pliegue de uno en uno.
   */
  let estado = marcadorInicial();
  for (const evento of eventos) {
    const antes = estado.setNumero;
    if (evento.set_numero !== undefined && evento.set_numero !== antes) {
      sentencias.push(
        db
          .prepare("UPDATE partido_eventos SET set_numero = ?1 WHERE partido_id = ?2 AND orden = ?3")
          .bind(antes, partido.id, evento.orden)
      );
    }
    estado = aplicarEvento(estado, evento, reglas);
    tras.push({ orden: evento.orden, set: estado.setNumero });
  }

  /** El set vigente en esa posición del historial, exista o no ese evento. */
  const setEnLaPosicion = (trasOrden: number): number => {
    let set = 1;
    for (const paso of tras) {
      if (paso.orden > trasOrden) break;
      set = paso.set;
    }
    return set;
  };

  const { results: cambios } = await db
    .prepare("SELECT id, tras_orden, set_numero FROM partido_cambios WHERE partido_id = ?1")
    .bind(partido.id)
    .all<{ id: number; tras_orden: number; set_numero: number }>();

  for (const cambio of cambios) {
    const setAhora = setEnLaPosicion(cambio.tras_orden);
    if (cambio.set_numero !== setAhora) {
      sentencias.push(
        db.prepare("UPDATE partido_cambios SET set_numero = ?1 WHERE id = ?2").bind(setAhora, cambio.id)
      );
    }
  }

  return sentencias;
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
    sentenciaLogVersion(db, partidoId),
    ...jugadorIds.map((jugadorId, indice) =>
      db
        .prepare("INSERT INTO partido_alineacion (partido_id, jugador_id, lado, orden) VALUES (?1, ?2, ?3, ?4)")
        .bind(partidoId, jugadorId, lado, indice)
    )
  ]);
}

/**
 * Mete a un suplente y saca a un titular.
 *
 * No pasa por `fijarAlineacion` a propósito: aquella fija el lado entero y con
 * ello reparte de nuevo los huecos, así que los retratos de la pista saltarían
 * de sitio. Aquí quien entra hereda **el hueco exacto** del que sale.
 *
 * Y no es un evento del log: no pliega, no puntúa y no genera estadísticas. Lo
 * único que comparte con los puntos es el sitio en el historial, que es lo que
 * ancla `tras_orden`.
 */
export async function registrarCambio(
  db: D1Database,
  partido: PartidoAnotable,
  entraId: number,
  saleId: number,
  usuarioId: number
): Promise<void> {
  if (entraId === saleId) throw new ErrorDeAnotacion("Elige a dos personas distintas.");

  const alineacion = await leerAlineacion(db, partido.id);
  const sale = alineacion.find((fila) => fila.jugador_id === saleId);
  if (!sale) throw new ErrorDeAnotacion("Quien sale ya no está en pista. Vuelve a cargar el partido.");
  if (alineacion.some((fila) => fila.jugador_id === entraId)) {
    throw new ErrorDeAnotacion("Esa persona ya está en pista.");
  }

  const ultimo = await db
    .prepare("SELECT COALESCE(MAX(orden), -1) AS orden FROM partido_eventos WHERE partido_id = ?1")
    .bind(partido.id)
    .first<{ orden: number }>();

  /*
   * Un cambio a medio aplicar deja el lado con un jugador de menos y el punto
   * siguiente rebota en `validarEvento`: las tres escrituras van juntas.
   */
  await db.batch([
    db
      .prepare(
        `INSERT INTO partido_cambios
           (partido_id, tras_orden, lado, entra_jugador_id, sale_jugador_id, posicion, set_numero, usuario_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(
        partido.id,
        ultimo?.orden ?? -1,
        sale.lado,
        entraId,
        saleId,
        sale.orden,
        // El set que se está jugando: los cerrados más uno, igual que el pliegue.
        partido.sets_a + partido.sets_b + 1,
        usuarioId
      ),
    db
      .prepare("DELETE FROM partido_alineacion WHERE partido_id = ?1 AND jugador_id = ?2")
      .bind(partido.id, saleId),
    db
      .prepare("INSERT INTO partido_alineacion (partido_id, jugador_id, lado, orden) VALUES (?1, ?2, ?3, ?4)")
      .bind(partido.id, entraId, sale.lado, sale.orden),
    sentenciaLogVersion(db, partido.id)
  ]);
}

/**
 * Deshace el último cambio. Solo el último, igual que con los puntos: deshacer
 * el penúltimo dejaría la pista en una alineación que no existió nunca.
 */
export async function deshacerCambio(db: D1Database, partido: PartidoAnotable): Promise<void> {
  const cambio = await db
    .prepare(
      `SELECT id, tras_orden, lado, entra_jugador_id, sale_jugador_id, posicion, set_numero
         FROM partido_cambios WHERE partido_id = ?1 ORDER BY id DESC LIMIT 1`
    )
    .bind(partido.id)
    .first<CambioFila>();
  if (!cambio) throw new ErrorDeAnotacion("No hay ningún cambio que deshacer.");

  const sigueEnPista = await db
    .prepare("SELECT 1 AS hay FROM partido_alineacion WHERE partido_id = ?1 AND jugador_id = ?2")
    .bind(partido.id, cambio.entra_jugador_id)
    .first<{ hay: number }>();
  if (!sigueEnPista) {
    throw new ErrorDeAnotacion("Ese cambio ya no se puede deshacer: quien entró ha salido después.");
  }

  await db.batch([
    db.prepare("DELETE FROM partido_cambios WHERE id = ?1").bind(cambio.id),
    db
      .prepare("DELETE FROM partido_alineacion WHERE partido_id = ?1 AND jugador_id = ?2")
      .bind(partido.id, cambio.entra_jugador_id),
    db
      .prepare("INSERT INTO partido_alineacion (partido_id, jugador_id, lado, orden) VALUES (?1, ?2, ?3, ?4)")
      .bind(partido.id, cambio.sale_jugador_id, cambio.lado, cambio.posicion),
    sentenciaLogVersion(db, partido.id)
  ]);
}

/** Los cambios de un partido, en el orden en que ocurrieron. */
export async function leerCambios(db: D1Database, partidoId: string): Promise<CambioFila[]> {
  const { results } = await db
    .prepare(
      `SELECT id, tras_orden, lado, entra_jugador_id, sale_jugador_id, posicion, set_numero
         FROM partido_cambios WHERE partido_id = ?1 ORDER BY tras_orden ASC, id ASC`
    )
    .bind(partidoId)
    .all<CambioFila>();
  return results;
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
  usuarioId: number,
  desdeCero = false
): Promise<ResultadoAnotacion> {
  const eventos = await leerEventos(db, partido.id);
  const reglas = normalizarReglas(partido.reglas).partido;

  /*
   * Se adopta cuando hay algo que adoptar, no cuando el log está vacío. Esa era
   * la condición antes, y dejaba sin salida el caso de «soltar»: con el partido
   * suelto y el marcador corregido desde el panel, el log NO está vacío, así que
   * anotar chocaba contra el cerrojo y adoptar contestaba «ya tiene anotación».
   * El anotador se quedaba encerrado entre las dos puertas.
   *
   * Adoptar con log detrás escribe el saldo al FINAL del log, no en el orden 0:
   * un `ajuste` es un saldo de apertura «de aquí en adelante», y plegar lo
   * reinicia todo a partir de ahí. Lo anotado antes sigue en el log y sigue
   * contando en las fichas de quien lo hizo —esos puntos se metieron de verdad—;
   * lo que se pierde son los parciales anteriores, que es justo lo que el panel
   * tampoco sabe.
   */
  if (!hayMarcadorAMano(partido, plegarEventos(eventos, reglas))) {
    throw new ErrorDeAnotacion("Este partido ya tiene anotación. No hace falta adoptarlo.");
  }
  const orden = eventos.length === 0 ? 0 : eventos[eventos.length - 1]!.orden + 1;

  /*
   * `desdeCero` es la otra salida del cerrojo de `MarcadorSinAdoptar`: cuando el
   * marcador de a mano no sirve (se apuntó mal, o se decide rejugar), se escribe
   * un saldo de apertura de 0–0. Sigue siendo un `ajuste` y no un borrado: en el
   * log queda dicho que ahí se empezó de cero, con quién y cuándo.
   */
  const saldo = desdeCero ? { puntos_a: 0, puntos_b: 0, sets_a: 0, sets_b: 0 } : {
    puntos_a: partido.points_a,
    puntos_b: partido.points_b,
    sets_a: partido.sets_a,
    sets_b: partido.sets_b
  };

  const fila: EventoFila = {
    orden,
    tipo: "ajuste",
    lado_jugador: null,
    jugador_id: null,
    lado_punto: null,
    ...saldo
  };

  const { sentencias } = sentenciasDerivadas(db, partido, [...eventos, fila]);
  await db.batch([
    db
      .prepare(
        `INSERT INTO partido_eventos
           (partido_id, orden, set_numero, tipo, puntos_a, puntos_b, sets_a, sets_b, usuario_id)
         VALUES (?1, ?2, ?3, 'ajuste', ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(
        partido.id,
        orden,
        saldo.sets_a + saldo.sets_b + 1,
        saldo.puntos_a,
        saldo.puntos_b,
        saldo.sets_a,
        saldo.sets_b,
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
    .prepare(
      "UPDATE partidos SET origen_marcador = 'manual', log_version = log_version + 1, updated_at = ?1 WHERE id = ?2"
    )
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
      `SELECT a.jugador_id, a.lado, a.orden, j.nombre, j.apellidos, j.dorsal
         FROM partido_alineacion a
         JOIN jugadores j ON j.id = a.jugador_id
        WHERE a.partido_id = ?1
        ORDER BY a.lado ASC, a.orden ASC`
    )
    .bind(partidoId)
    .all<AlineacionFila>();
  return results;
}
