// /api/admin/estadisticas
//   GET             plantilla de la edición en juego con sus totales, sus
//                   atributos, su nivel de cromo y si está oculta del
//                   directorio público
//   PATCH ?jugador=N guarda atributos, nivel y visibilidad
//
// Es la página donde la organización **valora**: los seis atributos 1–99 y el
// metal del cromo. La identidad de la persona (apodo, dorsal, posición, mano,
// lema) se edita en /admin/jugadores/, que es la página persona a persona.
//
// Las cifras de juego **no se editan aquí**: salen de sumar los partidos del
// jugador y son de sólo lectura. Si llegan en el cuerpo de un PATCH, se
// ignoran (test/integration/estadisticas-admin.test.ts lo comprueba).

import { requirePermiso, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { edicionActual } from "../../_lib/ediciones";
import { mapEstadisticas, METRICAS, totalesPorJugador } from "../../_lib/estadisticas";
import {
  ATRIBUTOS,
  atributosPorJugador,
  mediaAtributos,
  NIVELES,
  NIVEL_POR_DEFECTO,
  sentenciaAtributos,
  validarAtributos,
  validarNivel
} from "../../_lib/perfil";

interface FilaPlantilla {
  id: number;
  nombre: string;
  apellidos: string;
  es_suplente: number;
  oculto_publico: number;
  nivel: string | null;
  equipo_id: number;
  equipo_nombre: string;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "estadisticas.ver");
  if (acceso instanceof Response) return acceso;

  try {
    const edicion = await edicionActual(env.DB);
    if (!edicion) {
      return jsonAdmin({ edicion: null, jugadores: [], metricas: METRICAS, atributos: ATRIBUTOS, niveles: NIVELES });
    }

    const { results } = await env.DB
      .prepare(
        `SELECT j.id, j.nombre, j.apellidos, j.es_suplente, j.oculto_publico, j.nivel,
                e.id AS equipo_id, e.nombre AS equipo_nombre
         FROM jugadores j
         JOIN equipos e ON e.id = j.equipo_id
         WHERE j.edicion_id = ?1
         ORDER BY e.nombre COLLATE NOCASE ASC, j.orden ASC, j.id ASC`
      )
      .bind(edicion.id)
      .all<FilaPlantilla>();

    const ids = results.map((j) => j.id);
    const [totales, atributos] = await Promise.all([
      totalesPorJugador(env.DB, ids),
      atributosPorJugador(env.DB, ids)
    ]);

    return jsonAdmin({
      edicion: { id: edicion.id, anio: edicion.anio, nombre: edicion.nombre, estado: edicion.estado },
      // Las listas las manda el servidor: el cliente no mantiene ninguna copia
      // de las etiquetas ni de los metales.
      metricas: METRICAS,
      atributos: ATRIBUTOS,
      niveles: NIVELES,
      jugadores: results.map((fila) => ({
        id: fila.id,
        nombre: fila.nombre,
        apellidos: fila.apellidos,
        esSuplente: fila.es_suplente === 1,
        ocultoPublico: fila.oculto_publico === 1,
        equipoId: fila.equipo_id,
        equipoNombre: fila.equipo_nombre,
        estadisticas: totales.get(fila.id) ?? mapEstadisticas(null),
        atributos: atributos.get(fila.id) ?? {},
        nivel: fila.nivel ?? NIVEL_POR_DEFECTO,
        media: mediaAtributos(atributos.get(fila.id))
      }))
    });
  } catch (err) {
    console.error("Error leyendo estadísticas desde el panel:", err);
    return jsonAdmin({ error: "No se han podido cargar las estadísticas." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "estadisticas.editar");
  if (acceso instanceof Response) return acceso;

  const jugadorId = idDeQuery(new URL(request.url), "jugador");
  if (jugadorId === null) return accionNoValida();

  const jugador = await env.DB
    .prepare("SELECT id FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ id: number }>();
  if (!jugador) return jsonAdmin({ error: "Ese jugador ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;

  const atributos = validarAtributos(body.atributos);
  if ("campos" in atributos) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: atributos.campos }, 400);
  }

  const sentencias = [sentenciaAtributos(env.DB, jugadorId, atributos.atributos)];

  // El nivel es **opcional**: un PATCH que no lo menciona no debe devolver a
  // nadie a bronce. Mismo trato que `ocultoPublico`.
  if (body.nivel !== undefined) {
    const nivel = validarNivel(body.nivel);
    if ("campos" in nivel) {
      return jsonAdmin({ error: "Revisa los campos marcados.", campos: nivel.campos }, 400);
    }
    sentencias.push(
      env.DB.prepare("UPDATE jugadores SET nivel = ?1 WHERE id = ?2").bind(nivel.nivel, jugadorId)
    );
  }

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
    return jsonAdmin({ error: "No se han podido guardar los cambios." }, 500);
  }

  // Se relee en vez de devolver lo enviado: `ocultoPublico` y `nivel` son
  // opcionales y, si no venían, lo que vale es lo que ya había en la fila.
  const [totales, atributosGuardados, guardado] = await Promise.all([
    totalesPorJugador(env.DB, [jugadorId]),
    atributosPorJugador(env.DB, [jugadorId]),
    env.DB
      .prepare("SELECT oculto_publico, nivel FROM jugadores WHERE id = ?1")
      .bind(jugadorId)
      .first<{ oculto_publico: number; nivel: string | null }>()
  ]);

  return jsonAdmin({
    ok: true,
    jugador: {
      id: jugadorId,
      estadisticas: totales.get(jugadorId) ?? mapEstadisticas(null),
      atributos: atributosGuardados.get(jugadorId) ?? {},
      media: mediaAtributos(atributosGuardados.get(jugadorId)),
      nivel: guardado?.nivel ?? NIVEL_POR_DEFECTO,
      ocultoPublico: guardado?.oculto_publico === 1
    }
  });
};
