// /api/admin/estadisticas
//   GET             plantilla de la edición en juego con su carga manual, sus
//                   atributos y si está oculta del directorio público
//   PATCH ?jugador=N guarda las tres cosas de un jugador
//
// Es el reverso del directorio público: aquí se rellena lo que /api/jugadores
// enseña. Mientras el registro por partido no exista, todo lo que se carga aquí
// va a la fila manual de `estadisticas` (la que tiene `partido_id IS NULL`).

import { requireAdmin, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { edicionActual } from "../../_lib/ediciones";
import {
  mapEstadisticas,
  METRICAS,
  sentenciaCargaManual,
  SUMA_METRICAS,
  validarEstadisticas
} from "../../_lib/estadisticas";
import { ATRIBUTOS, atributosPorJugador, sentenciaAtributos, validarAtributos } from "../../_lib/perfil";

interface FilaPlantilla {
  id: number;
  nombre: string;
  apellidos: string;
  es_suplente: number;
  oculto_publico: number;
  equipo_id: number;
  equipo_nombre: string;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    const edicion = await edicionActual(env.DB);
    if (!edicion) return jsonAdmin({ edicion: null, jugadores: [], metricas: METRICAS, atributos: ATRIBUTOS });

    const { results } = await env.DB
      .prepare(
        `SELECT j.id, j.nombre, j.apellidos, j.es_suplente, j.oculto_publico,
                e.id AS equipo_id, e.nombre AS equipo_nombre
         FROM jugadores j
         JOIN equipos e ON e.id = j.equipo_id
         WHERE j.edicion_id = ?1
         ORDER BY e.nombre COLLATE NOCASE ASC, j.orden ASC, j.id ASC`
      )
      .bind(edicion.id)
      .all<FilaPlantilla>();

    const ids = results.map((j) => j.id);
    const [manuales, atributos] = await Promise.all([
      cargasManuales(env.DB, ids),
      atributosPorJugador(env.DB, ids)
    ]);

    return jsonAdmin({
      edicion: { id: edicion.id, anio: edicion.anio, nombre: edicion.nombre, estado: edicion.estado },
      metricas: METRICAS,
      atributos: ATRIBUTOS,
      jugadores: results.map((fila) => ({
        id: fila.id,
        nombre: fila.nombre,
        apellidos: fila.apellidos,
        esSuplente: fila.es_suplente === 1,
        ocultoPublico: fila.oculto_publico === 1,
        equipoId: fila.equipo_id,
        equipoNombre: fila.equipo_nombre,
        estadisticas: manuales.get(fila.id) ?? mapEstadisticas(null),
        atributos: atributos.get(fila.id) ?? {}
      }))
    });
  } catch (err) {
    console.error("Error leyendo estadísticas desde el panel:", err);
    return jsonAdmin({ error: "No se han podido cargar las estadísticas." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const jugadorId = idDeQuery(new URL(request.url), "jugador");
  if (jugadorId === null) return accionNoValida();

  const jugador = await env.DB
    .prepare("SELECT id FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ id: number }>();
  if (!jugador) return jsonAdmin({ error: "Ese jugador ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;

  const estadisticas = validarEstadisticas(body.estadisticas);
  if ("campos" in estadisticas) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: estadisticas.campos }, 400);
  }

  const atributos = validarAtributos(body.atributos);
  if ("campos" in atributos) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: atributos.campos }, 400);
  }

  const sentencias = [
    sentenciaCargaManual(env.DB, jugadorId, estadisticas.estadisticas),
    sentenciaAtributos(env.DB, jugadorId, atributos.atributos)
  ];

  if (body.ocultoPublico !== undefined) {
    sentencias.push(
      env.DB
        .prepare("UPDATE jugadores SET oculto_publico = ?1 WHERE id = ?2")
        .bind(body.ocultoPublico === true ? 1 : 0, jugadorId)
    );
  }

  try {
    await env.DB.batch(sentencias);
  } catch (err) {
    console.error("Error guardando las estadísticas de un jugador:", err);
    return jsonAdmin({ error: "No se han podido guardar las estadísticas." }, 500);
  }

  // Se relee en vez de devolver lo enviado: `ocultoPublico` es opcional y, si no
  // venía, lo que vale es lo que ya había en la fila.
  const [manuales, atributosGuardados, guardado] = await Promise.all([
    cargasManuales(env.DB, [jugadorId]),
    atributosPorJugador(env.DB, [jugadorId]),
    env.DB.prepare("SELECT oculto_publico FROM jugadores WHERE id = ?1").bind(jugadorId).first<{ oculto_publico: number }>()
  ]);

  return jsonAdmin({
    ok: true,
    jugador: {
      id: jugadorId,
      estadisticas: manuales.get(jugadorId) ?? mapEstadisticas(null),
      atributos: atributosGuardados.get(jugadorId) ?? {},
      ocultoPublico: guardado?.oculto_publico === 1
    }
  });
};

/**
 * Solo la fila manual, no la suma. El panel edita esa carga concreta; los
 * totales que se ven en /jugadores/ ya suman también lo que venga de partidos.
 */
async function cargasManuales(db: D1Database, jugadorIds: number[]) {
  const mapa = new Map<number, ReturnType<typeof mapEstadisticas>>();
  if (jugadorIds.length === 0) return mapa;

  const placeholders = jugadorIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT e.jugador_id, ${SUMA_METRICAS}
       FROM estadisticas e
       WHERE e.jugador_id IN (${placeholders}) AND e.partido_id IS NULL
       GROUP BY e.jugador_id`
    )
    .bind(...jugadorIds)
    .all<Record<string, number>>();

  for (const fila of results) mapa.set(fila.jugador_id, mapEstadisticas(fila));
  return mapa;
}
