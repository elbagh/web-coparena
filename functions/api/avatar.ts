// GET    /api/avatar — sirve el avatar del usuario logueado (solo el suyo).
// PUT    /api/avatar — sube/reemplaza el avatar (multipart, campo `foto`).
// DELETE /api/avatar — elimina el avatar.

import { requireUser, requireUserContext } from "../_lib/auth";
import { claveAvatar, contentTypePorClave, upsertAvatarKey } from "../_lib/avatar";
import { json } from "../_lib/http";
import { validarFoto } from "../_lib/validacion";

interface Env {
  DB: D1Database;
  FOTOS: R2Bucket;
  SESSION_SECRET: string;
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const sesion = await requireUserContext(request, env);
  if (sesion instanceof Response) return sesion;
  const { user, impersonando } = sesion;

  try {
    // Un GET no siembra el avatar de nadie mientras se le suplanta.
    const key = await claveAvatar(env.DB, env.FOTOS, user, { sembrar: !impersonando });
    if (!key) return json({ error: "No hay foto." }, 404);

    const objeto = await env.FOTOS.get(key);
    if (!objeto) return json({ error: "No hay foto." }, 404);

    return new Response(objeto.body, {
      headers: {
        "Content-Type": contentTypePorClave(key),
        "Cache-Control": "private, no-store"
      }
    });
  } catch (err) {
    console.error("Error sirviendo avatar:", err);
    return json({ error: "No se ha podido cargar la foto." }, 500);
  }
};

export const onRequestPut: PagesFunction<Env> = subirAvatar;
export const onRequestPost: PagesFunction<Env> = subirAvatar;

async function subirAvatar({ request, env }: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_AVATAR_BYTES) {
    return json({ error: "La foto puede ocupar como máximo 4 MB." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "La foto debe enviarse como multipart/form-data." }, 400);
  }

  const entrada = formData.get("foto");
  if (!(entrada instanceof File) || entrada.size === 0) {
    return json({ error: "Elige una imagen (JPG, PNG o WebP)." }, 400);
  }

  const buffer = await entrada.arrayBuffer();
  const foto = validarFoto(buffer, entrada.type, entrada.size);
  if ("error" in foto) {
    return json({ error: foto.error }, 400);
  }

  try {
    const claveAnterior = (
      await env.DB.prepare("SELECT avatar_key FROM perfiles WHERE usuario_id = ?1").bind(user.id).first<{ avatar_key: string | null }>()
    )?.avatar_key ?? null;

    const nuevaClave = `avatares/${user.id}.${foto.ext}`;
    await env.FOTOS.put(nuevaClave, buffer, { httpMetadata: { contentType: contentTypePorClave(nuevaClave) } });
    await upsertAvatarKey(env.DB, user.id, nuevaClave);

    if (claveAnterior && claveAnterior !== nuevaClave) {
      try {
        await env.FOTOS.delete(claveAnterior);
      } catch {
        // Borrado best-effort del objeto antiguo.
      }
    }

    return json({ ok: true, tieneAvatar: true }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error subiendo avatar:", err);
    return json({ error: "No se ha podido guardar la foto." }, 500);
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const clave = (
      await env.DB.prepare("SELECT avatar_key FROM perfiles WHERE usuario_id = ?1").bind(user.id).first<{ avatar_key: string | null }>()
    )?.avatar_key ?? null;

    if (clave) {
      await upsertAvatarKey(env.DB, user.id, null);
      try {
        await env.FOTOS.delete(clave);
      } catch {
        // Borrado best-effort.
      }
    }

    return json({ ok: true, tieneAvatar: false }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error borrando avatar:", err);
    return json({ error: "No se ha podido borrar la foto." }, 500);
  }
};
