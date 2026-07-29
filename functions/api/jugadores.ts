/*
 * GET /api/jugadores            listado público de la edición en juego
 * GET /api/jugadores?id=N       ficha pública de una persona
 * GET /api/jugadores?foto=N     su foto (pública)
 *
 * Es el único endpoint de jugadores que no vive bajo /api/admin/: lo lee el
 * directorio público /jugadores/. Solo tiene GET; no hay forma de escribir aquí.
 *
 * **Qué sale y qué no.** Salen nombre, apellidos, equipo, red social, foto,
 * ficha (apodo, dorsal, posición, mano, lema), atributos y estadísticas: todo
 * ello ya público o pensado para publicarse. No salen **nunca** el teléfono ni
 * el correo — el correo se usa dentro de las consultas para enlazar a la misma
 * persona entre ediciones, pero no viaja en ninguna respuesta.
 *
 * Quien pida no aparecer se marca con `jugadores.oculto_publico` desde el panel:
 * desaparece del listado y su ficha responde 404, como si no existiera.
 */

import { edicionActual } from "../_lib/ediciones";
import { mapEstadisticas, sumarTotales, totalesPorJugador, type Estadisticas } from "../_lib/estadisticas";
import { fotoNoEncontrada, servirFoto } from "../_lib/fotos";
import { json } from "../_lib/http";
import { atributosPorJugador, mediaAtributos, NIVEL_POR_DEFECTO } from "../_lib/perfil";

interface Env {
  DB: D1Database;
  FOTOS?: R2Bucket;
}

/** Cinco minutos: el listado cambia poco y el móvil en la playa lo agradece. */
const CACHE_PUBLICO = "public, max-age=300";

/*
 * La ficha (apodo, dorsal, posición, mano, lema, nivel) ya es del jugador desde
 * la 0022, así que sale de `jugadores` sin cruzar nada. Lo único que sigue
 * colgando de la cuenta es el avatar de Mi zona, y de él dependen `tieneFoto` y
 * el respaldo de `?foto=N`: por eso este enlace por correo sigue aquí, reducido
 * a lo que de verdad hace falta.
 *
 * Va como subconsulta y no como JOIN porque `usuarios.email` no es único (lo
 * único único es `google_sub`) y un JOIN duplicaría filas del listado.
 */
const AVATAR_DEL_JUGADOR = `
  LEFT JOIN perfiles p ON p.usuario_id = (
    SELECT u.id FROM usuarios u WHERE LOWER(TRIM(u.email)) = j.email_normalizado ORDER BY u.id ASC LIMIT 1
  )`;

interface FilaJugador {
  id: number;
  nombre: string;
  apellidos: string;
  red_social: string | null;
  foto_key: string | null;
  es_suplente: number;
  equipo_id: number;
  equipo_nombre: string;
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
  nivel: string | null;
  avatar_key: string | null;
}

/** Columnas de la ficha, idénticas en el listado y en la ficha individual. */
const COLUMNAS_FICHA = `j.apodo, j.dorsal, j.posicion, j.mano, j.lema, j.nivel`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const params = new URL(request.url).searchParams;

  const foto = params.get("foto");
  if (foto !== null) return servirFotoJugador(env, foto);

  const id = params.get("id");
  if (id !== null) return ficha(env, id);

  return listado(env);
};

// ------------------------------------------------------------------ listado ---

async function listado(env: Env): Promise<Response> {
  try {
    const edicion = await edicionActual(env.DB);
    if (!edicion) return json({ edicion: null, jugadores: [] }, 200, { "Cache-Control": CACHE_PUBLICO });

    const { results } = await env.DB
      .prepare(
        `SELECT j.id, j.nombre, j.apellidos, j.red_social, j.foto_key, j.es_suplente,
                e.id AS equipo_id, e.nombre AS equipo_nombre,
                ${COLUMNAS_FICHA}, p.avatar_key
         FROM jugadores j
         JOIN equipos e ON e.id = j.equipo_id
         ${AVATAR_DEL_JUGADOR}
         WHERE j.edicion_id = ?1 AND j.oculto_publico = 0
         ORDER BY e.nombre COLLATE NOCASE ASC, j.orden ASC, j.id ASC`
      )
      .bind(edicion.id)
      .all<FilaJugador>();

    const ids = results.map((j) => j.id);
    const [totales, atributos] = await Promise.all([
      totalesPorJugador(env.DB, ids),
      atributosPorJugador(env.DB, ids)
    ]);

    return json(
      {
        edicion: { anio: edicion.anio, nombre: edicion.nombre, estado: edicion.estado },
        // El listado da `nivel` y `media`, pero **no** los seis atributos
        // crudos: la rejilla pinta el metal y la nota sin una petición por
        // jugador, y quien quiera el desglose abre la ficha.
        jugadores: results.map((fila) => ({
          ...identidadPublica(fila, atributos.get(fila.id)),
          equipoId: fila.equipo_id,
          equipoNombre: fila.equipo_nombre,
          estadisticas: totales.get(fila.id) ?? mapEstadisticas(null)
        }))
      },
      200,
      { "Cache-Control": CACHE_PUBLICO }
    );
  } catch (err) {
    console.error("Error leyendo el listado público de jugadores:", err);
    return json({ error: "No se ha podido cargar la lista de jugadores." }, 500);
  }
}

function identidadPublica(fila: FilaJugador, atributos?: Record<string, number>) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    apellidos: fila.apellidos,
    apodo: fila.apodo,
    dorsal: fila.dorsal,
    posicion: fila.posicion,
    mano: fila.mano,
    lema: fila.lema,
    nivel: fila.nivel ?? NIVEL_POR_DEFECTO,
    media: mediaAtributos(atributos),
    instagram: fila.red_social,
    esSuplente: fila.es_suplente === 1,
    tieneFoto: Boolean(fila.foto_key || fila.avatar_key)
  };
}

// -------------------------------------------------------------------- ficha ---

interface FilaHistorial {
  jugador_id: number;
  equipo_id: number;
  equipo_nombre: string;
  posicion_final: number | null;
  edicion_id: number | null;
  anio: number | null;
  edicion_nombre: string | null;
  estado: string | null;
}

async function ficha(env: Env, idBruto: string): Promise<Response> {
  const jugadorId = Number(idBruto);
  if (!Number.isInteger(jugadorId) || jugadorId <= 0) {
    return json({ error: "Ese jugador no existe." }, 404, { "Cache-Control": "no-store" });
  }

  try {
    const jugador = await env.DB
      .prepare(
        `SELECT j.id, j.nombre, j.apellidos, j.red_social, j.foto_key, j.es_suplente,
                j.email_normalizado, j.nombre_completo_normalizado, j.edicion_id,
                e.id AS equipo_id, e.nombre AS equipo_nombre,
                ${COLUMNAS_FICHA}, p.avatar_key
         FROM jugadores j
         JOIN equipos e ON e.id = j.equipo_id
         ${AVATAR_DEL_JUGADOR}
         WHERE j.id = ?1 AND j.oculto_publico = 0`
      )
      .bind(jugadorId)
      .first<FilaJugador & { email_normalizado: string | null; nombre_completo_normalizado: string; edicion_id: number | null }>();

    if (!jugador) return json({ error: "Ese jugador no existe." }, 404, { "Cache-Control": "no-store" });

    const edicion = await edicionActual(env.DB);
    const historial = await cargarHistorial(env.DB, jugador.email_normalizado, jugador.nombre_completo_normalizado);
    const jugadorIds = historial.map((h) => h.jugador_id);

    const [totales, atributos, companeros] = await Promise.all([
      totalesPorJugador(env.DB, jugadorIds),
      atributosPorJugador(env.DB, [jugadorId]),
      cargarCompaneros(env.DB, historial.map((h) => h.equipo_id), jugadorIds)
    ]);

    const entradas = historial.map((h) => ({
      edicionId: h.edicion_id,
      anio: h.anio,
      nombreEdicion: h.edicion_nombre,
      estado: h.estado,
      equipoId: h.equipo_id,
      equipoNombre: h.equipo_nombre,
      posicionFinal: h.posicion_final,
      esActual: edicion != null && h.edicion_id === edicion.id,
      estadisticas: totales.get(h.jugador_id) ?? mapEstadisticas(null),
      companeros: companeros.get(h.equipo_id) ?? []
    }));

    return json(
      {
        jugador: {
          ...identidadPublica(jugador, atributos.get(jugadorId)),
          equipoId: jugador.equipo_id,
          equipoNombre: jugador.equipo_nombre,
          atributos: atributos.get(jugadorId) ?? {}
        },
        edicion: edicion ? { anio: edicion.anio, nombre: edicion.nombre, estado: edicion.estado } : null,
        historial: entradas,
        palmares: calcularPalmares(entradas),
        carrera: sumarTotales(entradas.map((e) => e.estadisticas))
      },
      200,
      { "Cache-Control": CACHE_PUBLICO }
    );
  } catch (err) {
    console.error("Error leyendo la ficha pública de un jugador:", err);
    return json({ error: "No se ha podido cargar la ficha del jugador." }, 500);
  }
}

/**
 * Todas las inscripciones de la misma persona. Se enlaza por correo, que es lo
 * que ya usa /api/perfil, con el nombre completo normalizado como respaldo para
 * las filas antiguas que se dieron de alta sin correo.
 */
async function cargarHistorial(
  db: D1Database,
  emailNormalizado: string | null,
  nombreNormalizado: string
): Promise<FilaHistorial[]> {
  const { results } = await db
    .prepare(
      `SELECT j.id AS jugador_id, e.id AS equipo_id, e.nombre AS equipo_nombre,
              e.posicion_final, ed.id AS edicion_id, ed.anio, ed.nombre AS edicion_nombre, ed.estado
       FROM jugadores j
       JOIN equipos e ON e.id = j.equipo_id
       LEFT JOIN ediciones ed ON ed.id = j.edicion_id
       WHERE j.oculto_publico = 0
         AND ((?1 IS NOT NULL AND j.email_normalizado = ?1) OR j.nombre_completo_normalizado = ?2)
       ORDER BY ed.anio DESC, j.id DESC`
    )
    .bind(emailNormalizado, nombreNormalizado)
    .all<FilaHistorial>();
  return results;
}

/** Compañeros de cada equipo, para poder saltar de una ficha a otra. */
async function cargarCompaneros(
  db: D1Database,
  equipoIds: number[],
  excluir: number[]
): Promise<Map<number, { id: number; nombre: string; apellidos: string }[]>> {
  const mapa = new Map<number, { id: number; nombre: string; apellidos: string }[]>();
  if (equipoIds.length === 0) return mapa;

  const placeholders = equipoIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id, equipo_id, nombre, apellidos
       FROM jugadores
       WHERE equipo_id IN (${placeholders}) AND oculto_publico = 0
       ORDER BY orden ASC, id ASC`
    )
    .bind(...equipoIds)
    .all<{ id: number; equipo_id: number; nombre: string; apellidos: string }>();

  const propios = new Set(excluir);
  for (const fila of results) {
    if (propios.has(fila.id)) continue;
    const lista = mapa.get(fila.equipo_id) ?? [];
    lista.push({ id: fila.id, nombre: fila.nombre, apellidos: fila.apellidos });
    mapa.set(fila.equipo_id, lista);
  }
  return mapa;
}

interface EntradaHistorial {
  edicionId: number | null;
  posicionFinal: number | null;
  estadisticas: Estadisticas;
  companeros: { id: number }[];
}

function calcularPalmares(historial: EntradaHistorial[]) {
  const ediciones = new Set<number>();
  const companeros = new Set<number>();
  const podios = { oro: 0, plata: 0, bronce: 0 };
  let mejorPuesto: number | null = null;

  for (const h of historial) {
    if (h.edicionId != null) ediciones.add(h.edicionId);
    if (h.posicionFinal === 1) podios.oro += 1;
    else if (h.posicionFinal === 2) podios.plata += 1;
    else if (h.posicionFinal === 3) podios.bronce += 1;
    if (h.posicionFinal != null && (mejorPuesto == null || h.posicionFinal < mejorPuesto)) {
      mejorPuesto = h.posicionFinal;
    }
    for (const c of h.companeros) companeros.add(c.id);
  }

  return {
    edicionesJugadas: ediciones.size,
    podios,
    mejorPuesto,
    totalEquipos: historial.length,
    totalCompaneros: companeros.size
  };
}

// --------------------------------------------------------------------- foto ---

/**
 * Primero la foto que subió al inscribirse y, si no hay, el avatar de Mi zona.
 * A diferencia de /api/admin/fotos —que sirve la misma imagen tras un permiso
 * y con no-store— aquí es pública: el consentimiento de la inscripción cubre
 * publicar las fotos de los participantes en la web.
 */
async function servirFotoJugador(env: Env, idBruto: string): Promise<Response> {
  const jugadorId = Number(idBruto);
  if (!Number.isInteger(jugadorId) || jugadorId <= 0) return fotoNoEncontrada();

  const fila = await env.DB
    .prepare(
      `SELECT j.foto_key, p.avatar_key
       FROM jugadores j
       ${AVATAR_DEL_JUGADOR}
       WHERE j.id = ?1 AND j.oculto_publico = 0`
    )
    .bind(jugadorId)
    .first<{ foto_key: string | null; avatar_key: string | null }>();

  const clave = fila?.foto_key ?? fila?.avatar_key ?? null;
  if (!clave) return fotoNoEncontrada();

  return servirFoto(env.FOTOS, clave, CACHE_PUBLICO);
}
