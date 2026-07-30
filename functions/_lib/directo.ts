// El estado del partido en directo, y la cadencia a la que se puede pedir.
//
// Este es el endpoint que sondea todo el mundo a la vez, así que es el único del
// sitio que puede agotar la cuota de peticiones de Cloudflare — y justo el día
// que más gente mira. De ahí las tres decisiones que lo gobiernan:
//
//   1. Se calcula primero una versión barata (UNA fila agregada). Si coincide
//      con el `If-None-Match` que trae el navegador, se responde 304 sin llegar
//      a construir el cuerpo.
//   2. La cadencia la manda el SERVIDOR, no el cliente. Sale de la tabla
//      `ajustes`, editable desde el panel: subirla de 3 s a 20 s frena a todos
//      los espectadores al siguiente sondeo, sin desplegar nada.
//   3. El payload es minúsculo. Todo lo pesado (cuadro, clasificaciones) vive en
//      /api/torneo, que se cachea y no se sondea.
//
// Ojo con la cuenta: un 304 consume una petición igual que un 200. El ETag
// ahorra ancho de banda y lecturas de D1, no invocaciones. Lo único que ahorra
// invocaciones es sondear menos.

import { AVATAR_DEL_JUGADOR } from "./fotos";
import { json } from "./http";
import { TIPOS } from "./marcador";
import { atributosPorJugador, mediaAtributos, NIVEL_POR_DEFECTO } from "./perfil";
import { normalizarReglas } from "./reglas";

export interface Ajustes {
  sondeoMs: number;
  sondeoLentoMs: number;
  modoAhorro: boolean;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  sondeoMs: 3000,
  sondeoLentoMs: 60000,
  modoAhorro: false
};

interface PartidoDirectoRow {
  id: string;
  ronda: string;
  pista: string | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  status: string;
  points_a: number;
  points_b: number;
  sets_a: number;
  sets_b: number;
  set_number: number;
  set_history: string;
  started_at: string | null;
  scheduled_at: string | null;
  reglas: string;
}

export interface EstadoDirecto {
  hayDirecto: boolean;
  partidos: ReturnType<typeof mapDirecto>[];
  /**
   * Quién está en pista y el historial reciente, **del primer partido en juego**.
   *
   * Hay una sola pista, así que ese es el partido del directo. Si algún día
   * hubiera dos a la vez, el segundo sigue apareciendo en `partidos` con su
   * marcador: lo que no tiene es versus ni historial, porque la pantalla enseña
   * un partido.
   */
  enPista: { A: number[]; B: number[] } | null;
  feed: LineaFeed[];
  /**
   * Cuántos apuntes tiene el partido en total, para que la pantalla pueda decir
   * «y 44 más» sin pedirlos. Sale del `orden` del último —que es una secuencia
   * densa desde 0— y no de un COUNT, que leería el log entero en cada sondeo.
   */
  feedTotal: number;
  /** El siguiente en empezar, para que el botón diga algo cuando no hay nadie jugando. */
  siguiente: { ronda: string; scheduledAt: string | null; equipos: [string, string] } | null;
  siguienteSondeoMs: number;
  modoAhorro: boolean;
}

/**
 * Una línea del historial, con las claves cortas.
 *
 * Este es el payload que sondea todo el mundo a la vez, así que no lleva ni un
 * nombre: los pone el cliente desde la plantilla, que pide una sola vez.
 *
 *   o = orden del evento (o el `tras_orden` del cambio, que es su ancla)
 *   c = id del cambio (solo en los cambios; distingue la clave del cliente)
 *   t = tipo    j = quien lo hizo / quien entra    x = quien sale
 *   l = lado de quien lo hizo    p = lado que se lleva el punto    s = set
 */
export interface LineaFeed {
  o: number;
  c?: number;
  t: string;
  j?: number | null;
  x?: number;
  l?: string | null;
  p?: string | null;
  s: number;
}

/** Cuántos apuntes viajan en cada sondeo. Sube linealmente las lecturas de D1. */
export const FEED_VENTANA = 30;

const EDICION_ACTUAL = "(SELECT id FROM ediciones WHERE es_actual = 1)";

const entero = (valor: string | undefined, porDefecto: number, min: number, max: number): number => {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) return porDefecto;
  return Math.round(n);
};

export async function leerAjustes(db: D1Database): Promise<Ajustes> {
  const { results } = await db
    .prepare("SELECT clave, valor FROM ajustes WHERE clave LIKE 'directo_%'")
    .all<{ clave: string; valor: string }>();
  const mapa = new Map(results.map((fila) => [fila.clave, fila.valor]));

  return {
    // Mínimo un segundo: por debajo, el sondeo deja de ser sondeo y es un ataque.
    sondeoMs: entero(mapa.get("directo_sondeo_ms"), AJUSTES_POR_DEFECTO.sondeoMs, 1000, 600000),
    sondeoLentoMs: entero(mapa.get("directo_sondeo_lento_ms"), AJUSTES_POR_DEFECTO.sondeoLentoMs, 1000, 600000),
    modoAhorro: mapa.get("directo_modo_ahorro") === "1"
  };
}

/**
 * Una sola fila que cambia con cualquier cosa que pase en un partido en juego.
 *
 * Lleva el marcador sumado además de `updated_at` porque dos escrituras dentro
 * del mismo milisegundo darían la misma marca de tiempo, y un punto que no
 * cambia la versión es un punto que el espectador no ve.
 *
 * Y lleva `log_version` desde que el payload trae también quién está en pista y
 * el historial: fijar una alineación, registrar un cambio de jugador o anotar
 * una defensa no mueven el marcador, así que sin ese contador el espectador se
 * quedaba con un 304 y el cuerpo viejo. Sigue siendo **una fila agregada**: un
 * COUNT sobre `partido_eventos` habría encarecido justo el camino barato, que es
 * el 304 (D1 factura filas leídas).
 */
export async function versionDirecto(db: D1Database): Promise<string> {
  const fila = await db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(MAX(updated_at), '') AS ultimo,
              COALESCE(SUM(points_a + points_b + sets_a + sets_b), 0) AS marcador,
              COALESCE(SUM(log_version), 0) AS log
         FROM partidos
        WHERE edicion_id = ${EDICION_ACTUAL} AND status = 'live'`
    )
    .first<{ n: number; ultimo: string; marcador: number; log: number }>();

  return `${fila?.n ?? 0}-${fila?.marcador ?? 0}-${fila?.log ?? 0}-${fila?.ultimo ?? ""}`;
}

export const etagDe = (version: string): string => `W/"directo-${version}"`;

export async function estadoDirecto(db: D1Database, ajustes: Ajustes): Promise<EstadoDirecto> {
  const [vivos, proximo] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM partidos
          WHERE edicion_id = ${EDICION_ACTUAL} AND status = 'live'
          ORDER BY COALESCE(scheduled_at, '9999'), sort_order ASC`
      )
      .all<PartidoDirectoRow>(),
    db
      .prepare(
        `SELECT ronda, scheduled_at, equipo_a_nombre, equipo_b_nombre FROM partidos
          WHERE edicion_id = ${EDICION_ACTUAL} AND status = 'scheduled' AND scheduled_at IS NOT NULL
          ORDER BY scheduled_at ASC LIMIT 1`
      )
      .first<{ ronda: string; scheduled_at: string; equipo_a_nombre: string; equipo_b_nombre: string }>()
  ]);

  const hayDirecto = vivos.results.length > 0;
  const enJuego = vivos.results[0] ?? null;

  // El versus y el historial solo se leen si hay algo que enseñar: sin partido
  // en juego, el sondeo sigue costando lo que costaba.
  const [enPista, historial] = enJuego
    ? await Promise.all([enPistaDe(db, enJuego.id), feedPublico(db, enJuego.id, FEED_VENTANA)])
    : [null, { lineas: [] as LineaFeed[], total: 0 }];

  return {
    hayDirecto,
    partidos: vivos.results.map(mapDirecto),
    enPista,
    feed: historial.lineas,
    feedTotal: historial.total,
    siguiente: proximo
      ? {
          ronda: proximo.ronda,
          scheduledAt: proximo.scheduled_at,
          equipos: [proximo.equipo_a_nombre, proximo.equipo_b_nombre]
        }
      : null,
    // Sin nadie jugando no hay nada que refrescar deprisa.
    siguienteSondeoMs: hayDirecto ? ajustes.sondeoMs : ajustes.sondeoLentoMs,
    modoAhorro: ajustes.modoAhorro
  };
}

/** Quién está en pista ahora, por lado y en el orden en que se pintan. */
export async function enPistaDe(db: D1Database, partidoId: string): Promise<{ A: number[]; B: number[] }> {
  const { results } = await db
    .prepare(
      `SELECT jugador_id, lado FROM partido_alineacion
        WHERE partido_id = ?1 ORDER BY lado ASC, orden ASC`
    )
    .bind(partidoId)
    .all<{ jugador_id: number; lado: "A" | "B" }>();

  const pista: { A: number[]; B: number[] } = { A: [], B: [] };
  for (const fila of results) pista[fila.lado].push(fila.jugador_id);
  return pista;
}

/**
 * La cola del historial: los últimos apuntes del partido, puntos y cambios.
 *
 * Es una **ventana completa**, no un incremento. Un delta («dame lo posterior a
 * X») no sabe expresar una corrección ni un deshacer: el marcador retrocedería y
 * el espectador se quedaría con el punto borrado en pantalla hasta recargar.
 * Mandar la ventana entera hace que las dos cosas funcionen solas, y quien evita
 * repintar es el cliente, que reconcilia por clave.
 *
 * Los cambios se intercalan por su ancla: un evento va en (orden, 0) y un cambio
 * en (tras_orden, 1, id), así que el cambio cae justo detrás del punto que
 * estaba anotado cuando ocurrió.
 */
export async function feedPublico(
  db: D1Database,
  partidoId: string,
  limite: number
): Promise<{ lineas: LineaFeed[]; total: number }> {
  const { results: eventos } = await db
    .prepare(
      `SELECT orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto
         FROM partido_eventos WHERE partido_id = ?1 ORDER BY orden DESC LIMIT ?2`
    )
    .bind(partidoId, limite)
    .all<{
      orden: number;
      set_numero: number;
      tipo: string;
      lado_jugador: string | null;
      jugador_id: number | null;
      lado_punto: string | null;
    }>();

  if (eventos.length === 0) return { lineas: [], total: 0 };

  // Vienen del más nuevo al más viejo por el LIMIT; el historial se lee al revés.
  eventos.reverse();
  const desde = eventos[0]!.orden;
  // `orden` es una secuencia densa desde 0 (el siguiente es el último + 1, y
  // deshacer quita el último), así que el último dice cuántos hay sin contarlos.
  const total = eventos[eventos.length - 1]!.orden + 1;

  const { results: cambios } = await db
    .prepare(
      `SELECT id, tras_orden, lado, entra_jugador_id, sale_jugador_id, set_numero
         FROM partido_cambios WHERE partido_id = ?1 AND tras_orden >= ?2 ORDER BY tras_orden ASC, id ASC`
    )
    .bind(partidoId, desde - 1)
    .all<{
      id: number;
      tras_orden: number;
      lado: string;
      entra_jugador_id: number;
      sale_jugador_id: number;
      set_numero: number;
    }>();

  const lineas: LineaFeed[] = [
    ...eventos.map((evento) => ({
      o: evento.orden,
      t: evento.tipo,
      j: evento.jugador_id,
      l: evento.lado_jugador,
      p: evento.lado_punto,
      s: evento.set_numero
    })),
    ...cambios.map((cambio) => ({
      o: cambio.tras_orden,
      c: cambio.id,
      t: "cambio",
      j: cambio.entra_jugador_id,
      x: cambio.sale_jugador_id,
      l: cambio.lado,
      s: cambio.set_numero
    }))
  ];

  // (orden, cambio detrás del punto, id) — el id desempata dos cambios seguidos.
  lineas.sort((a, b) => a.o - b.o || (a.c ? 1 : 0) - (b.c ? 1 : 0) || (a.c ?? 0) - (b.c ?? 0));

  return { lineas, total };
}

export interface JugadorPlantilla {
  id: number;
  nombre: string | null;
  apellidos: string | null;
  dorsal: number | null;
  nivel: string;
  media: number | null;
  tieneFoto: boolean;
  esSuplente: boolean;
  oculto: boolean;
}

/**
 * Los dos equipos con su gente: lo que el directo necesita para pintar caras.
 *
 * Vive fuera del sondeo (`/api/plantilla`, cacheado) porque no cambia durante el
 * partido: si viajara en cada sondeo serían nombres y dorsales repetidos cien
 * veces por minuto en el único endpoint que no puede permitírselo.
 *
 * **`oculto_publico` no filtra la fila, la proyecta.** Quien ha pedido no salir
 * en el álbum sigue estando en pista y el marcador tiene que cuadrar, así que
 * sale — pero por su dorsal, sin nombre, sin nota y sin foto. Nunca por sus
 * iniciales: dentro de un equipo de cuatro identifican tanto como el nombre.
 * Conserva su metal, que no dice quién es.
 */
export async function plantillaPublica(db: D1Database, partidoId: string) {
  const partido = await db
    .prepare(
      `SELECT id, ronda, pista, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre
         FROM partidos WHERE id = ?1`
    )
    .bind(partidoId)
    .first<{
      id: string;
      ronda: string;
      pista: string | null;
      equipo_a_id: number | null;
      equipo_b_id: number | null;
      equipo_a_nombre: string;
      equipo_b_nombre: string;
    }>();
  if (!partido) return null;

  const ids = [partido.equipo_a_id, partido.equipo_b_id].filter((id): id is number => id !== null);
  const { results } = ids.length
    ? await db
        .prepare(
          `SELECT j.id, j.equipo_id, j.nombre, j.apellidos, j.dorsal, j.nivel, j.es_suplente,
                  j.oculto_publico, j.foto_key, p.avatar_key
             FROM jugadores j
             ${AVATAR_DEL_JUGADOR}
            WHERE j.equipo_id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})
            ORDER BY j.es_suplente ASC, j.orden ASC, j.id ASC`
        )
        .bind(...ids)
        .all<{
          id: number;
          equipo_id: number;
          nombre: string;
          apellidos: string;
          dorsal: number | null;
          nivel: string | null;
          es_suplente: number;
          oculto_publico: number;
          foto_key: string | null;
          avatar_key: string | null;
        }>()
    : { results: [] };

  const atributos = await atributosPorJugador(db, results.map((jugador) => jugador.id));

  const mapear = (equipoId: number | null, nombre: string) => ({
    id: equipoId,
    nombre,
    jugadores: results
      .filter((jugador) => jugador.equipo_id === equipoId)
      .map((jugador): JugadorPlantilla => {
        const oculto = jugador.oculto_publico === 1;
        return {
          id: jugador.id,
          nombre: oculto ? null : jugador.nombre,
          apellidos: oculto ? null : jugador.apellidos,
          dorsal: jugador.dorsal,
          nivel: jugador.nivel ?? NIVEL_POR_DEFECTO,
          media: oculto ? null : mediaAtributos(atributos.get(jugador.id)),
          // `/api/jugadores?foto=N` responde 404 a quien está oculto: pedirla
          // sería gastar una petición en un fallo seguro.
          tieneFoto: !oculto && Boolean(jugador.foto_key || jugador.avatar_key),
          esSuplente: jugador.es_suplente === 1,
          oculto
        };
      })
  });

  return {
    partido: { id: partido.id, ronda: partido.ronda, pista: partido.pista },
    equipos: {
      A: mapear(partido.equipo_a_id, partido.equipo_a_nombre),
      B: mapear(partido.equipo_b_id, partido.equipo_b_nombre)
    },
    /*
     * Las etiquetas de las acciones viajan aquí y no en el sondeo: el historial
     * público necesita escribir «Remate» o «Bloqueo», y esta respuesta se pide
     * una vez y se cachea. Mandarlas en cada sondeo serían las mismas cinco
     * palabras cien veces por minuto; copiarlas al cliente sería una lista más
     * que mantener a mano.
     */
    tipos: TIPOS.map((tipo) => ({ clave: tipo.clave, etiqueta: tipo.etiqueta }))
  };
}

function mapDirecto(partido: PartidoDirectoRow) {
  return {
    id: partido.id,
    ronda: partido.ronda,
    pista: partido.pista,
    status: partido.status,
    setNumber: partido.set_number,
    points: { A: partido.points_a, B: partido.points_b },
    sets: { A: partido.sets_a, B: partido.sets_b },
    history: leerHistorial(partido.set_history),
    startedAt: partido.started_at,
    scheduledAt: partido.scheduled_at,
    reglas: normalizarReglas(partido.reglas).partido,
    teams: {
      A: { id: partido.equipo_a_id, name: partido.equipo_a_nombre },
      B: { id: partido.equipo_b_id, name: partido.equipo_b_nombre }
    }
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

/**
 * 304 si el navegador ya tiene esta versión, 200 con el cuerpo si no.
 *
 * `no-cache` y no `no-store`: el navegador tiene que poder guardar la respuesta
 * para poder mandar el `If-None-Match` la próxima vez, pero siempre revalidando.
 */
export function respuestaDirecto(request: Request, version: string, cuerpo: unknown | null): Response {
  const etag = etagDe(version);
  if (cuerpo === null) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
  }
  return json(cuerpo, 200, { ETag: etag, "Cache-Control": "no-cache" });
}

export const coincideEtag = (request: Request, version: string): boolean => {
  const recibido = request.headers.get("If-None-Match");
  return recibido !== null && recibido.split(",").some((valor) => valor.trim() === etagDe(version));
};
