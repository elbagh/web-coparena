import { requireUser, type AuthEnv, type UsuarioSesion } from "./auth";
import { json } from "./http";

export interface AdminEnv extends AuthEnv {
  DB: D1Database;
}

export async function requireAdmin(request: Request, env: AdminEnv): Promise<UsuarioSesion | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const row = await env.DB
    .prepare("SELECT is_admin FROM usuarios WHERE id = ?1")
    .bind(user.id)
    .first<{ is_admin: number | null }>();

  if (row?.is_admin === 1) return user;
  return json({ error: "No tienes permiso para entrar en el panel de administración." }, 403);
}
