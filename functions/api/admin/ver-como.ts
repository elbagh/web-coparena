// /api/admin/ver-como
//   POST   { usuarioId }   empieza a ver el sitio como esa persona
//   DELETE                 vuelve a la cuenta del administrador
//
// La sesión real nunca se toca: solo se pone o se quita una segunda cookie
// firmada. Mientras está activa, functions/_middleware.ts bloquea cualquier
// escritura, así que es un modo estrictamente de consulta.

import { requireAdmin, jsonAdmin, type AdminEnv } from "../../_lib/admin";
import { clearVerComoCookie, createVerComoCookie, getAuthContext } from "../../_lib/auth";

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const usuarioId = Number(body?.usuarioId);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return jsonAdmin({ error: "Indica a qué usuario quieres ver." }, 400);
  }
  if (usuarioId === admin.id) {
    return jsonAdmin({ error: "Ya estás viendo el sitio con tu propia cuenta." }, 400);
  }

  const objetivo = await env.DB
    .prepare("SELECT id, email, nombre FROM usuarios WHERE id = ?1")
    .bind(usuarioId)
    .first<{ id: number; email: string; nombre: string | null }>();
  if (!objetivo) return jsonAdmin({ error: "Esa cuenta ya no existe." }, 404);

  const cookie = await createVerComoCookie(request, env, admin.id, objetivo.id);
  return conCookie(
    { ok: true, verComo: { usuarioId: objetivo.id, usuarioNombre: objetivo.nombre || objetivo.email } },
    cookie
  );
};

/**
 * Se valida contra el administrador **real**, no contra el usuario efectivo:
 * durante la suplantación el efectivo no es admin, así que requireAdmin
 * rechazaría la salida y dejaría al administrador atrapado.
 */
export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const { realUser } = await getAuthContext(request, env);
  if (!realUser) {
    return jsonAdmin({ error: "Inicia sesión con Google para continuar." }, 401);
  }

  return conCookie({ ok: true }, clearVerComoCookie(request));
};

const conCookie = (datos: unknown, cookie: string): Response =>
  new Response(JSON.stringify(datos), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": cookie
    }
  });
