import { clearSessionCookie, clearVerComoCookie } from "../../_lib/auth";
import { jsonConCookies } from "../../_lib/http";

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

/**
 * Cerrar sesión caduca **las dos** cookies. Si solo se borrara la de sesión, la
 * de «ver como» seguiría viva hasta media hora, y como el middleware corta toda
 * escritura mientras esté presente, el navegador se quedaría sin poder ni
 * volver a entrar (el login también es un POST).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  return jsonConCookies({ ok: true }, [clearSessionCookie(request), clearVerComoCookie(request)], 200, {
    "Cache-Control": "no-store"
  });
};
