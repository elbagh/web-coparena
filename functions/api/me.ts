import { getCurrentUser, publicUser } from "../_lib/auth";
import { equipoDeUsuario } from "../_lib/equipos";
import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await getCurrentUser(request, env);
    if (!user) {
      return json({ user: null, team: null }, 200, { "Cache-Control": "no-store" });
    }

    const userTeam = await equipoDeUsuario(env.DB, user);
    const team = userTeam
      ? await env.DB
          .prepare(
            `SELECT e.id, e.nombre, COUNT(j.id) AS jugadores
             FROM equipos e
             LEFT JOIN jugadores j ON j.equipo_id = e.id
             WHERE e.id = ?1
             GROUP BY e.id`
          )
          .bind(userTeam.id)
          .first<{ id: number; nombre: string; jugadores: number }>()
      : null;

    return json(
      {
        user: publicUser(user),
        team: team ? { id: team.id, nombre: team.nombre, jugadores: team.jugadores } : null
      },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (err) {
    console.error("Error leyendo sesión:", err);
    return json({ error: "No se ha podido cargar tu sesión." }, 500);
  }
};
