import { createSessionCookie, mapUser, publicUser } from "../../_lib/auth";
import { verifyGoogleCredential, type GoogleEnv } from "../../_lib/google";
import { json } from "../../_lib/http";

interface Env extends GoogleEnv {
  DB: D1Database;
  SESSION_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { credential?: unknown };
  try {
    body = (await request.json()) as { credential?: unknown };
  } catch {
    return json({ error: "La petición de login no es válida." }, 400);
  }

  if (typeof body.credential !== "string" || !body.credential) {
    return json({ error: "Falta la credencial de Google." }, 400);
  }

  let profile;
  try {
    profile = await verifyGoogleCredential(body.credential, env);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "No se ha podido iniciar sesión con Google." }, 401);
  }

  try {
    await env.DB
      .prepare(
        `INSERT INTO usuarios (google_sub, email, email_verified, nombre, foto_url, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(google_sub) DO UPDATE SET
           email = excluded.email,
           email_verified = excluded.email_verified,
           nombre = excluded.nombre,
           foto_url = excluded.foto_url,
           updated_at = datetime('now')`
      )
      .bind(profile.googleSub, profile.email, profile.emailVerified ? 1 : 0, profile.name, profile.picture)
      .run();

    const userRow = await env.DB
      .prepare(
        `SELECT id, google_sub, email, email_verified, nombre, foto_url
         FROM usuarios
         WHERE google_sub = ?1`
      )
      .bind(profile.googleSub)
      .first<{
        id: number;
        google_sub: string;
        email: string;
        email_verified: number;
        nombre: string | null;
        foto_url: string | null;
      }>();

    if (!userRow) {
      return json({ error: "No se ha podido crear la sesión." }, 500);
    }

    const cookie = await createSessionCookie(request, env, userRow.id);
    return json({ user: publicUser(mapUser(userRow)) }, 200, {
      "Set-Cookie": cookie,
      "Cache-Control": "no-store"
    });
  } catch (err) {
    console.error("Error guardando usuario de Google:", err);
    return json({ error: "No se ha podido iniciar sesión. Inténtalo de nuevo." }, 500);
  }
};
