// Helpers de R2 compartidos por todo lo que guarda imágenes: fotos de jugador
// (equipos/<lote>/jugador-<n>.<ext>), foto de equipo y avatares de perfil
// (avatares/<usuario_id>.<ext>). Centraliza el mapa de tipos MIME, que antes
// estaba duplicado entre el endpoint de admin y _lib/avatar.ts.

import { json } from "./http";

export type ExtensionFoto = "jpg" | "png" | "webp";

const CONTENT_TYPE_POR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export function contentTypePorExtension(ext: string): string {
  return CONTENT_TYPE_POR_EXT[ext] ?? "application/octet-stream";
}

export function contentTypePorClave(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return contentTypePorExtension(ext);
}

/** Sube un objeto fijando su Content-Type a partir de la extensión de la clave. */
export async function subirFoto(
  bucket: R2Bucket,
  key: string,
  buffer: ArrayBuffer,
  ext: ExtensionFoto
): Promise<void> {
  await bucket.put(key, buffer, { httpMetadata: { contentType: contentTypePorExtension(ext) } });
}

/**
 * Borrado best-effort: se usa tanto para limpiar huérfanos tras un guardado
 * correcto como para revertir subidas cuando el batch de D1 falla. Si alguna
 * clave no se puede borrar queda un objeto huérfano inofensivo, nunca un error
 * que tumbe la petición.
 */
export async function limpiarFotos(bucket: R2Bucket | undefined, claves: string[]): Promise<void> {
  if (!bucket) return;
  for (const key of claves) {
    try {
      await bucket.delete(key);
    } catch {
      // Intencionadamente silencioso: ver comentario de arriba.
    }
  }
}

export const fotoNoEncontrada = (): Response =>
  json({ error: "Foto no encontrada." }, 404, { "Cache-Control": "no-store" });

/**
 * Sirve un objeto de R2 como imagen. `cacheControl` se deja explícito porque
 * las fotos privadas (jugador, avatar) no se pueden cachear y la foto pública
 * de equipo sí.
 */
export async function servirFoto(
  bucket: R2Bucket | undefined,
  key: string | null | undefined,
  cacheControl = "no-store"
): Promise<Response> {
  if (!bucket || !key) return fotoNoEncontrada();

  const objeto = await bucket.get(key);
  if (!objeto) return fotoNoEncontrada();

  return new Response(objeto.body, {
    status: 200,
    headers: {
      "Content-Type": objeto.httpMetadata?.contentType || contentTypePorClave(key),
      "Cache-Control": cacheControl
    }
  });
}
