// Avatar del perfil: foto de la ficha de Mi zona. Vive como objeto R2 propio
// (avatares/<usuario_id>.<ext>), desacoplado de la foto por-jugador de la
// inscripcion (que el editor de equipo borra al guardar). La primera vez se
// siembra copiando la foto que el usuario subio al inscribirse, si la hay.

import type { UsuarioSesion } from "./auth";
import { contentTypePorClave } from "./fotos";
import { normalizarEmail } from "./validacion";

// Se reexporta para no romper a quien ya lo importaba desde aquí; la
// implementación vive en _lib/fotos.ts junto al resto de helpers de R2.
export { contentTypePorClave };

export async function upsertAvatarKey(db: D1Database, usuarioId: number, key: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO perfiles (usuario_id, avatar_key, updated_at)
       VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(usuario_id) DO UPDATE SET avatar_key = ?2, updated_at = datetime('now')`
    )
    .bind(usuarioId, key)
    .run();
}

// Devuelve la clave R2 del avatar del usuario, sembrandola desde la foto de
// inscripcion la primera vez si hace falta. null si el usuario no tiene ninguna.
export async function claveAvatar(
  db: D1Database,
  fotos: R2Bucket | undefined,
  user: UsuarioSesion
): Promise<string | null> {
  const perfil = await db
    .prepare("SELECT avatar_key FROM perfiles WHERE usuario_id = ?1")
    .bind(user.id)
    .first<{ avatar_key: string | null }>();
  if (perfil?.avatar_key) return perfil.avatar_key;

  if (!fotos) return null;

  const emailNormalizado = normalizarEmail(user.email);
  const jugador = await db
    .prepare(
      `SELECT foto_key FROM jugadores
       WHERE email_normalizado = ?1 AND foto_key IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .bind(emailNormalizado)
    .first<{ foto_key: string }>();
  if (!jugador?.foto_key) return null;

  const ext = jugador.foto_key.split(".").pop()?.toLowerCase() ?? "jpg";
  const nuevaClave = `avatares/${user.id}.${ext}`;
  try {
    const origen = await fotos.get(jugador.foto_key);
    if (!origen) return null;
    const buffer = await origen.arrayBuffer();
    await fotos.put(nuevaClave, buffer, { httpMetadata: { contentType: contentTypePorClave(nuevaClave) } });
  } catch {
    return null;
  }

  await upsertAvatarKey(db, user.id, nuevaClave);
  return nuevaClave;
}
