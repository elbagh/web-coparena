import type { UsuarioSesion } from "./auth";
import { normalizarEmail, type RegistroValidado } from "./validacion";

export interface EquipoUsuarioRow {
  id: number;
  nombre: string;
  created_at: string;
  edicion_id: number | null;
}

// Encuentra el equipo del usuario (por propiedad o por email entre los jugadores).
// Si se pasa `edicionId`, se limita a esa edicion: asi un usuario con equipo en un
// ano anterior puede volver a inscribirse/editar solo en la edicion viva.
export async function equipoDeUsuario(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<EquipoUsuarioRow | null> {
  const emailNormalizado = normalizarEmail(user.email);
  const filtroEdicion = edicionId != null ? "AND e.edicion_id = ?3" : "";

  const stmt = db.prepare(
    `SELECT e.id, e.nombre, e.created_at, e.edicion_id
     FROM equipos e
     LEFT JOIN jugadores j
       ON j.equipo_id = e.id
      AND j.email_normalizado = ?2
     WHERE (e.owner_user_id = ?1 OR j.id IS NOT NULL)
       ${filtroEdicion}
     GROUP BY e.id
     ORDER BY
       CASE WHEN e.owner_user_id = ?1 THEN 0 ELSE 1 END ASC,
       e.created_at ASC,
       e.id ASC
     LIMIT 1`
  );

  return await (edicionId != null
    ? stmt.bind(user.id, emailNormalizado, edicionId)
    : stmt.bind(user.id, emailNormalizado)
  ).first<EquipoUsuarioRow>();
}

export function registroIncluyeEmailUsuario(registro: RegistroValidado, user: UsuarioSesion): boolean {
  const emailNormalizado = normalizarEmail(user.email);
  return registro.jugadores.some((jugador) => jugador.emailNormalizado === emailNormalizado);
}
