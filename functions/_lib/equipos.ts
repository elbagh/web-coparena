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

/**
 * Equipo del que el usuario es **propietario**, y solo eso. Es lo que autoriza
 * a escribir.
 *
 * La otra vía de equipoDeUsuario —aparecer como jugador con tu correo— vale
 * para mirar, pero no para modificar: ese correo lo teclea quien inscribe el
 * equipo, sin que su dueño confirme nada. Autorizar escrituras con él dejaba
 * que cualquiera diera de alta un equipo con el correo de un tercero y le
 * pasara el mando (renombrar, editar los datos personales de la plantilla o
 * borrarla entera), además de bloquearle su propia inscripción.
 */
export async function equipoPropioDeUsuario(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<EquipoUsuarioRow | null> {
  const filtroEdicion = edicionId != null ? "AND e.edicion_id = ?2" : "";

  const stmt = db.prepare(
    `SELECT e.id, e.nombre, e.created_at, e.edicion_id
     FROM equipos e
     WHERE e.owner_user_id = ?1
       ${filtroEdicion}
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT 1`
  );

  return await (edicionId != null ? stmt.bind(user.id, edicionId) : stmt.bind(user.id)).first<EquipoUsuarioRow>();
}

export function registroIncluyeEmailUsuario(registro: RegistroValidado, user: UsuarioSesion): boolean {
  const emailNormalizado = normalizarEmail(user.email);
  return registro.jugadores.some((jugador) => jugador.emailNormalizado === emailNormalizado);
}

export async function buscarDuplicadosEdicion(
  db: D1Database,
  registro: RegistroValidado,
  equipoId: number
): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};

  const equipoExistente = await db
    .prepare("SELECT 1 FROM equipos WHERE nombre_normalizado = ?1 AND id <> ?2")
    .bind(registro.equipoNormalizado, equipoId)
    .first();
  if (equipoExistente) {
    campos.equipo = "Ya hay un equipo inscrito con ese nombre.";
  }

  const nombres = registro.jugadores.map((j) => j.nombreCompletoNormalizado);
  const telefonos = registro.jugadores.map((j) => j.telefonoNormalizado);
  const emails = registro.jugadores.flatMap((j) => (j.emailNormalizado ? [j.emailNormalizado] : []));

  const clausulas = [
    `nombre_completo_normalizado IN (${nombres.map(() => "?").join(",")})`,
    `telefono_normalizado IN (${telefonos.map(() => "?").join(",")})`
  ];
  const binds: (string | number)[] = [...nombres, ...telefonos];
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }
  binds.push(equipoId);

  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (${clausulas.join(" OR ")}) AND equipo_id <> ?`
    )
    .bind(...binds)
    .all<{ nombre_completo_normalizado: string; telefono_normalizado: string; email_normalizado: string | null }>();

  const nombresOcupados = new Set(results.map((r) => r.nombre_completo_normalizado));
  const telefonosOcupados = new Set(results.map((r) => r.telefono_normalizado));
  const emailsOcupados = new Set(results.flatMap((r) => (r.email_normalizado ? [r.email_normalizado] : [])));

  registro.jugadores.forEach((j, i) => {
    if (nombresOcupados.has(j.nombreCompletoNormalizado)) {
      campos[`jugadores.${i}.nombre`] = "Esta persona ya está inscrita en otro equipo.";
    }
    if (telefonosOcupados.has(j.telefonoNormalizado)) {
      campos[`jugadores.${i}.telefono`] = "Este móvil ya está registrado en otra inscripción.";
    }
    if (j.emailNormalizado && emailsOcupados.has(j.emailNormalizado)) {
      campos[`jugadores.${i}.email`] = "Este correo ya está registrado en otra inscripción.";
    }
  });

  return campos;
}

export function mapearConflictoUnicoEdicion(err: unknown): Record<string, string> | null {
  const mensaje = err instanceof Error ? err.message : String(err);
  if (!mensaje.includes("UNIQUE constraint failed")) return null;
  if (mensaje.includes("equipos.nombre_normalizado")) {
    return { equipo: "Ya hay un equipo inscrito con ese nombre." };
  }
  if (mensaje.includes("jugadores.nombre_completo_normalizado")) {
    return { jugadores: "Alguna de las personas ya está inscrita en otro equipo." };
  }
  if (mensaje.includes("jugadores.telefono_normalizado")) {
    return { jugadores: "Alguno de los móviles ya está registrado en otra inscripción." };
  }
  if (mensaje.includes("jugadores.email_normalizado")) {
    return { jugadores: "Alguno de los correos ya está registrado en otra inscripción." };
  }
  return { jugadores: "Hay datos que ya están registrados en otra inscripción." };
}
