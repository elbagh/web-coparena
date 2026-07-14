import type { UsuarioSesion } from "./auth";
import { normalizarEmail, type RegistroValidado } from "./validacion";

export interface EquipoUsuarioRow {
  id: number;
  nombre: string;
  created_at: string;
}

export async function equipoDeUsuario(db: D1Database, user: UsuarioSesion): Promise<EquipoUsuarioRow | null> {
  const emailNormalizado = normalizarEmail(user.email);

  return await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at
       FROM equipos e
       LEFT JOIN jugadores j
         ON j.equipo_id = e.id
        AND j.email_normalizado = ?2
       WHERE e.owner_user_id = ?1
          OR j.id IS NOT NULL
       GROUP BY e.id
       ORDER BY
         CASE WHEN e.owner_user_id = ?1 THEN 0 ELSE 1 END ASC,
         e.created_at ASC,
         e.id ASC
       LIMIT 1`
    )
    .bind(user.id, emailNormalizado)
    .first<EquipoUsuarioRow>();
}

export function registroIncluyeEmailUsuario(registro: RegistroValidado, user: UsuarioSesion): boolean {
  const emailNormalizado = normalizarEmail(user.email);
  return registro.jugadores.some((jugador) => jugador.emailNormalizado === emailNormalizado);
}
