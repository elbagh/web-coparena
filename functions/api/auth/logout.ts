import { clearSessionCookie } from "../../_lib/auth";
import { json } from "../../_lib/http";

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  return json({ ok: true }, 200, {
    "Set-Cookie": clearSessionCookie(request),
    "Cache-Control": "no-store"
  });
};
