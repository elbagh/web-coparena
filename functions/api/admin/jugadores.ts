// /api/admin/jugadores
//   POST ?accion=normalizar-nombres   recapitaliza nombre y apellidos de todos
//
// El CRUD por jugador (alta suelta, edición, cambio de equipo y borrado) entra
// en la Fase 2; de momento aquí solo vive la acción masiva que ya existía.

import { requireAdmin, jsonAdmin, accionNoValida, type AdminEnv } from "../../_lib/admin";
import { capitalizarPropio } from "../../_lib/nombres";

interface JugadorNombreRow {
  id: number;
  nombre: string;
  apellidos: string;
}

/** Devuelve solo los jugadores cuyo nombre o apellidos cambian al capitalizar. */
export function calcularNombresNormalizados(jugadores: JugadorNombreRow[]): JugadorNombreRow[] {
  return jugadores.reduce<JugadorNombreRow[]>((cambios, jugador) => {
    const nombre = capitalizarPropio(jugador.nombre);
    const apellidos = capitalizarPropio(jugador.apellidos);
    if (nombre !== jugador.nombre || apellidos !== jugador.apellidos) {
      cambios.push({ id: jugador.id, nombre, apellidos });
    }
    return cambios;
  }, []);
}

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  if (new URL(request.url).searchParams.get("accion") !== "normalizar-nombres") {
    return accionNoValida();
  }

  try {
    const { results } = await env.DB
      .prepare("SELECT id, nombre, apellidos FROM jugadores")
      .all<JugadorNombreRow>();

    const cambios = calcularNombresNormalizados(results);
    if (cambios.length > 0) {
      await env.DB.batch(
        cambios.map((c) =>
          env.DB
            .prepare("UPDATE jugadores SET nombre = ?1, apellidos = ?2 WHERE id = ?3")
            .bind(c.nombre, c.apellidos, c.id)
        )
      );
    }

    return jsonAdmin({ ok: true, actualizados: cambios.length });
  } catch (err) {
    console.error("Error normalizando nombres desde el panel:", err);
    return jsonAdmin({ error: "No se han podido normalizar los nombres." }, 500);
  }
};
