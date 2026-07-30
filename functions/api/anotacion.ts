// /api/anotacion?partido=ID
//   GET   estado del partido, alineación y log
//   POST  { accion: "evento" | "deshacer" | "corregir" | "alineacion" | "adoptar" }
//
// Vive fuera de functions/api/admin/ a propósito: tiene otro permiso
// (`partidos.anotar`), otro público (quien está a pie de pista con el móvil) y
// otra cadencia. Un anotador no entra al panel de administración.
//
// Corregir un partido que ya terminó exige `partidos.editar`, no solo
// `partidos.anotar`: rehacer un resultado cerrado ya no es anotar, es enmendar.

import { jsonAdmin, requireAlgunPermiso, requirePermiso, type AdminEnv } from "../_lib/admin";
import {
  ConflictoDeOrden,
  MarcadorSinAdoptar,
  adoptarMarcador,
  corregirEvento,
  deshacerUltimo,
  fijarAlineacion,
  hayMarcadorAMano,
  leerAlineacion,
  leerEstado,
  marcadorPlano,
  recalcularPartido,
  registrarEvento,
  soltarAnotacion,
  validarEvento,
  type PartidoAnotable
} from "../_lib/eventos";
import { TIPOS, type TipoEvento } from "../_lib/marcador";
import { normalizarReglas } from "../_lib/reglas";
import { propagarResultado } from "../_lib/torneo";

const SELECT_PARTIDO = `SELECT id, status, origen_marcador, equipo_a_id, equipo_b_id,
                               points_a, points_b, sets_a, sets_b, reglas, started_at, elapsed_ms
                          FROM partidos WHERE id = ?1`;

const idDelPartido = (url: URL) => url.searchParams.get("partido") || "";

async function cargarPartido(db: D1Database, id: string) {
  if (!id) return null;
  return await db.prepare(SELECT_PARTIDO).bind(id).first<PartidoAnotable>();
}

/** Los dos equipos con su nombre y su plantilla, para elegir quién sale a pista. */
async function plantillas(db: D1Database, partido: PartidoAnotable) {
  const vacio = { A: { nombre: "Equipo A", jugadores: [] }, B: { nombre: "Equipo B", jugadores: [] } };
  const ids = [partido.equipo_a_id, partido.equipo_b_id].filter((id): id is number => id !== null);
  if (ids.length === 0) return vacio;

  const { results } = await db
    .prepare(
      `SELECT id, equipo_id, nombre, apellidos, es_suplente
         FROM jugadores WHERE equipo_id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})
        ORDER BY es_suplente ASC, orden ASC, id ASC`
    )
    .bind(...ids)
    .all<{ id: number; equipo_id: number; nombre: string; apellidos: string; es_suplente: number }>();

  // El nombre congelado del partido es el que vale: es el que se ve en el cuadro.
  const fila = await db
    .prepare("SELECT equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre FROM partidos WHERE id = ?1")
    .bind(partido.id)
    .first<{ equipo_a_id: number | null; equipo_b_id: number | null; equipo_a_nombre: string; equipo_b_nombre: string }>();
  const nombres = new Map<number, string>();
  if (fila?.equipo_a_id) nombres.set(fila.equipo_a_id, fila.equipo_a_nombre);
  if (fila?.equipo_b_id) nombres.set(fila.equipo_b_id, fila.equipo_b_nombre);

  const mapear = (equipoId: number | null, porDefecto: string) => ({
    nombre: (equipoId === null ? null : nombres.get(equipoId)) ?? porDefecto,
    jugadores:
      equipoId === null
        ? []
        : results
            .filter((jugador) => jugador.equipo_id === equipoId)
            .map((jugador) => ({
              id: jugador.id,
              nombre: `${jugador.nombre} ${jugador.apellidos}`.trim(),
              esSuplente: jugador.es_suplente === 1
            }))
  });

  return { A: mapear(partido.equipo_a_id, "Equipo A"), B: mapear(partido.equipo_b_id, "Equipo B") };
}

async function respuesta(db: D1Database, partido: PartidoAnotable, status = 200): Promise<Response> {
  const fresco = (await cargarPartido(db, partido.id))!;
  const [estado, alineacion, equipos] = await Promise.all([
    leerEstado(db, fresco),
    leerAlineacion(db, fresco.id),
    plantillas(db, fresco)
  ]);

  return jsonAdmin(
    {
      partido: {
        id: fresco.id,
        status: fresco.status,
        origenMarcador: fresco.origen_marcador,
        reglas: normalizarReglas(fresco.reglas).partido,
        startedAt: fresco.started_at
      },
      ...estado,
      /*
       * El marcador de las columnas planas viaja SIEMPRE, aparte del plegado.
       * Sin él, la pantalla no podía enseñar el 8–6 de un partido llevado a mano
       * —el pliegue de un log vacío es 0–0— y ofrecía adoptar un marcador que no
       * sabía que existía. `pendienteDeAdoptar` es la misma condición que usa el
       * cerrojo del servidor, resuelta aquí para que cliente y servidor no
       * puedan discrepar sobre cuándo hay que decidir.
       */
      marcadorPanel: marcadorPlano(fresco),
      pendienteDeAdoptar: estado.eventos.length === 0 && hayMarcadorAMano(fresco),
      alineacion,
      equipos,
      tipos: TIPOS
    },
    status
  );
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requireAlgunPermiso(request, env, ["partidos.anotar", "partidos.editar"]);
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const id = idDelPartido(url);

  try {
    // Sin partido concreto, la lista de lo que hay que anotar hoy.
    if (!id) return jsonAdmin({ partidos: await partidosDeHoy(env.DB) });

    const partido = await cargarPartido(env.DB, id);
    if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);
    return await respuesta(env.DB, partido);
  } catch (err) {
    console.error("Error leyendo la anotación:", err);
    return jsonAdmin({ error: "No se ha podido cargar el partido." }, 500);
  }
};

/** Lo que se juega o se va a jugar en la edición actual, para elegir. */
async function partidosDeHoy(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT id, ronda, pista, status, origen_marcador, scheduled_at,
              equipo_a_nombre, equipo_b_nombre, points_a, points_b, sets_a, sets_b
         FROM partidos
        WHERE edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
          AND status <> 'finished'
        ORDER BY (status = 'live') DESC, COALESCE(scheduled_at, '9999'), sort_order ASC`
    )
    .all<Record<string, unknown>>();

  return results.map((fila) => ({
    id: fila.id,
    ronda: fila.ronda,
    pista: fila.pista,
    status: fila.status,
    origenMarcador: fila.origen_marcador,
    scheduledAt: fila.scheduled_at,
    teams: { A: { name: fila.equipo_a_nombre }, B: { name: fila.equipo_b_nombre } },
    points: { A: fila.points_a, B: fila.points_b },
    sets: { A: fila.sets_a, B: fila.sets_b }
  }));
}

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requireAlgunPermiso(request, env, ["partidos.anotar", "partidos.editar"]);
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const partido = await cargarPartido(env.DB, idDelPartido(url));
  if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const accion = String(body.accion || "");

  /*
   * Rehacer un partido cerrado ya no es anotar. Quien solo tiene
   * `partidos.anotar` lleva el marcador de lo que se está jugando; enmendar un
   * resultado terminado es otra cosa y pide el permiso de edición.
   */
  if (partido.status === "finished" && accion !== "soltar") {
    const edicion = await requirePermiso(request, env, "partidos.editar");
    if (edicion instanceof Response) {
      return jsonAdmin({ error: "Este partido ya ha terminado. Corregirlo necesita permiso de edición." }, 403);
    }
  }

  try {
    switch (accion) {
      case "evento":
        return await accionEvento(env.DB, partido, body, acceso.user.id);
      case "deshacer":
        return await accionDeshacer(env.DB, partido, body);
      case "corregir":
        return await accionCorregir(env.DB, partido, body);
      case "alineacion":
        return await accionAlineacion(env.DB, partido, body);
      case "adoptar":
        return await accionAdoptar(env.DB, partido, acceso.user.id, body.desdeCero === true);
      case "soltar":
        await soltarAnotacion(env.DB, partido.id);
        return await respuesta(env.DB, partido);
      default:
        return jsonAdmin({ error: "La acción no es válida." }, 400);
    }
  } catch (err) {
    if (err instanceof ConflictoDeOrden) return jsonAdmin({ error: err.message }, 409);
    // Lleva el marcador de a mano en el cuerpo: la pantalla lo necesita para
    // poder decir «va 8–6» y ofrecer las dos salidas.
    if (err instanceof MarcadorSinAdoptar) {
      return jsonAdmin({ error: err.message, marcadorPanel: err.marcadorPanel, pendienteDeAdoptar: true }, 409);
    }
    if (err instanceof Error && err.message.length < 200) return jsonAdmin({ error: err.message }, 409);
    console.error("Error anotando:", err);
    return jsonAdmin({ error: "No se ha podido guardar." }, 500);
  }
};

const ordenDe = (body: Record<string, unknown>): number | null => {
  const valor = Number(body.ordenEsperado);
  return Number.isInteger(valor) && valor >= 0 ? valor : null;
};

async function accionEvento(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
  const orden = ordenDe(body);
  if (orden === null) return jsonAdmin({ error: "Falta el orden esperado." }, 400);

  const alineacion = await leerAlineacion(db, partido.id);
  if (alineacion.length === 0) {
    return jsonAdmin({ error: "Marca antes quién está en pista: cada punto lleva un jugador detrás." }, 409);
  }

  const validado = validarEvento(body, alineacion);
  if ("campos" in validado) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: validado.campos }, 400);
  }

  await registrarEvento(db, partido, validado.evento, orden, usuarioId);

  // Un punto puede cerrar el partido, y entonces el ganador sube al siguiente
  // cruce igual que si se hubiera cerrado desde el panel. Fuera del batch: es
  // otro partido, y que falle no debe deshacer el punto.
  await propagarResultado(db, partido.id);

  return await respuesta(db, partido, 201);
}

async function accionDeshacer(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>
): Promise<Response> {
  const orden = ordenDe(body);
  if (orden === null) return jsonAdmin({ error: "Falta el orden del evento a deshacer." }, 400);

  await deshacerUltimo(db, partido, orden);
  return await respuesta(db, partido);
}

async function accionCorregir(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>
): Promise<Response> {
  const orden = Number(body.orden);
  if (!Number.isInteger(orden) || orden < 0) return jsonAdmin({ error: "Indica qué evento corregir." }, 400);

  const alineacion = await leerAlineacion(db, partido.id);
  const cambios: { tipo?: TipoEvento; jugadorId?: number } = {};
  if (body.tipo !== undefined) cambios.tipo = String(body.tipo) as TipoEvento;
  if (body.jugadorId !== undefined) cambios.jugadorId = Number(body.jugadorId);

  await corregirEvento(db, partido, orden, cambios, alineacion);
  await propagarResultado(db, partido.id);
  return await respuesta(db, partido);
}

async function accionAlineacion(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>
): Promise<Response> {
  const lado = body.lado === "B" ? "B" : "A";
  const brutos = Array.isArray(body.jugadorIds) ? body.jugadorIds : [];
  const ids = [...new Set(brutos.map((valor) => Number(valor)).filter((id) => Number.isInteger(id) && id > 0))];

  const equipoId = lado === "A" ? partido.equipo_a_id : partido.equipo_b_id;
  if (equipoId === null) return jsonAdmin({ error: "Ese lado del partido todavía no tiene equipo." }, 409);

  /*
   * Que el jugador sea de ese equipo se comprueba aquí y no solo en el cliente:
   * atribuir puntos a alguien de otro equipo —o de otra edición— falsearía el
   * álbum entero y no se notaría hasta mucho después.
   */
  if (ids.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT id FROM jugadores
          WHERE equipo_id = ?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(", ")})`
      )
      .bind(equipoId, ...ids)
      .all<{ id: number }>();
    if (results.length !== ids.length) {
      return jsonAdmin({ error: "Alguna de esas personas no juega en ese equipo." }, 400);
    }
  }

  await fijarAlineacion(db, partido.id, lado, ids);
  return await respuesta(db, partido);
}

async function accionAdoptar(
  db: D1Database,
  partido: PartidoAnotable,
  usuarioId: number,
  desdeCero: boolean
): Promise<Response> {
  await adoptarMarcador(db, partido, usuarioId, desdeCero);
  return await respuesta(db, partido, 201);
}

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "partidos.editar");
  if (acceso instanceof Response) return acceso;

  const partido = await cargarPartido(env.DB, idDelPartido(new URL(request.url)));
  if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);

  // Vía de escape: volver a derivar todo desde el log si algo quedó descuadrado.
  try {
    await recalcularPartido(env.DB, partido);
    return await respuesta(env.DB, partido);
  } catch (err) {
    console.error("Error recalculando:", err);
    return jsonAdmin({ error: "No se ha podido recalcular." }, 500);
  }
};
