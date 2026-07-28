import type { UsuarioSesion } from "./auth";
import { normalizarEmail, type RegistroValidado } from "./validacion";

export interface EquipoUsuarioRow {
  id: number;
  nombre: string;
  created_at: string;
  edicion_id: number | null;
  capitan_jugador_id: number | null;
}

/**
 * Equipo en el que el usuario figura: como capitán, o como jugador con su
 * correo en la plantilla. Vale para **mirar**. El capitán tiene preferencia
 * cuando hay más de uno.
 */
export async function equipoDeUsuario(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<EquipoUsuarioRow | null> {
  const emailNormalizado = normalizarEmail(user.email);
  const filtroEdicion = edicionId != null ? "AND e.edicion_id = ?2" : "";

  const stmt = db.prepare(
    `SELECT e.id, e.nombre, e.created_at, e.edicion_id, e.capitan_jugador_id
     FROM equipos e
     LEFT JOIN jugadores j
       ON j.equipo_id = e.id AND j.email_normalizado = ?1
     LEFT JOIN jugadores c
       ON c.id = e.capitan_jugador_id AND c.email_normalizado = ?1
     WHERE (j.id IS NOT NULL OR c.id IS NOT NULL)
       ${filtroEdicion}
     GROUP BY e.id
     ORDER BY
       CASE WHEN c.id IS NOT NULL THEN 0 ELSE 1 END ASC,
       e.created_at ASC,
       e.id ASC
     LIMIT 1`
  );

  return await (edicionId != null
    ? stmt.bind(emailNormalizado, edicionId)
    : stmt.bind(emailNormalizado)
  ).first<EquipoUsuarioRow>();
}

/**
 * Equipo del que el usuario es **capitán**, y solo eso. Es lo que autoriza a
 * escribir.
 *
 * La otra vía de equipoDeUsuario —figurar en la plantilla con tu correo— vale
 * para mirar, pero no para modificar: ese correo lo teclea quien inscribe el
 * equipo, sin que su dueño confirme nada. La fila del capitán es distinta: o la
 * verificó Google al inscribir, o la designó el capitán anterior a propósito.
 */
export async function equipoDelCapitan(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<EquipoUsuarioRow | null> {
  const emailNormalizado = normalizarEmail(user.email);
  const filtroEdicion = edicionId != null ? "AND e.edicion_id = ?2" : "";

  const stmt = db.prepare(
    `SELECT e.id, e.nombre, e.created_at, e.edicion_id, e.capitan_jugador_id
     FROM equipos e
     JOIN jugadores c ON c.id = e.capitan_jugador_id
     WHERE c.email_normalizado = ?1
       ${filtroEdicion}
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT 1`
  );

  return await (edicionId != null
    ? stmt.bind(emailNormalizado, edicionId)
    : stmt.bind(emailNormalizado)
  ).first<EquipoUsuarioRow>();
}

/**
 * Duplicados al **editar** un equipo. La unicidad de jugador es por edición
 * (migración 0010), así que solo se mira dentro de la edición de ese equipo: si
 * alguien jugó en 2026 no puede bloquear una inscripción de 2027.
 *
 * El nombre de equipo sí sigue siendo único global.
 */
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

  const equipo = await db
    .prepare("SELECT edicion_id FROM equipos WHERE id = ?1")
    .bind(equipoId)
    .first<{ edicion_id: number | null }>();
  const edicionId = equipo?.edicion_id ?? null;

  const nombres = registro.jugadores.map((j) => j.nombreCompletoNormalizado);
  const telefonos = registro.jugadores.map((j) => j.telefonoNormalizado);
  const emails = registro.jugadores.flatMap((j) => (j.emailNormalizado ? [j.emailNormalizado] : []));

  const clausulas = [
    `nombre_completo_normalizado IN (${nombres.map(() => "?").join(",")})`,
    `telefono_normalizado IN (${telefonos.map(() => "?").join(",")})`
  ];
  const binds: (string | number | null)[] = [...nombres, ...telefonos];
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }
  binds.push(equipoId, edicionId);

  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (${clausulas.join(" OR ")}) AND equipo_id <> ? AND edicion_id IS ?`
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
