import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  createSessionCookie,
  getAuthContext,
  getCurrentUser,
  requireUser,
  sessionCookieName
} from "../../functions/_lib/auth";
import { cookieSesion, crearUsuario } from "../helpers/db";

const URL_BASE = "https://copa.test/api/me";

const conCookie = (cookie: string, url = URL_BASE) => new Request(url, { headers: { Cookie: cookie } });

afterEach(() => {
  vi.useRealTimers();
});

describe("sesión firmada", () => {
  it("resuelve al usuario de la cookie", async () => {
    const user = await crearUsuario({ email: "ana@example.com", nombre: "Ana" });
    const contexto = await getAuthContext(conCookie(await cookieSesion(user)), env);

    expect(contexto.user?.id).toBe(user.id);
    expect(contexto.user?.email).toBe("ana@example.com");
    expect(contexto.realUser?.id).toBe(user.id);
    expect(contexto.impersonando).toBe(false);
  });

  it("sin cookie no hay usuario", async () => {
    expect(await getCurrentUser(new Request(URL_BASE), env)).toBeNull();
  });

  it("rechaza una firma manipulada", async () => {
    const user = await crearUsuario();
    const cookie = await cookieSesion(user);
    const [nombreValor, firma] = cookie.split(".");
    const manipulada = `${nombreValor}.${"A".repeat(firma!.length)}`;

    expect(await getCurrentUser(conCookie(manipulada), env)).toBeNull();
  });

  it("rechaza un payload alterado aunque conserve la firma original", async () => {
    const user = await crearUsuario();
    const otro = await crearUsuario();
    const cookie = await cookieSesion(user);
    const [, firma] = cookie.split(".");

    // Se reescribe el payload apuntando a otro uid, manteniendo la firma vieja.
    const payloadFalso = btoa(JSON.stringify({ uid: otro.id, exp: Math.floor(Date.now() / 1000) + 60 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(await getCurrentUser(conCookie(`${sessionCookieName}=${payloadFalso}.${firma}`), env)).toBeNull();
  });

  it("rechaza una cookie sin punto separador", async () => {
    expect(await getCurrentUser(conCookie(`${sessionCookieName}=soloruido`), env)).toBeNull();
  });

  it("rechaza una cookie firmada con otro secreto", async () => {
    const user = await crearUsuario();
    const otroEntorno = { DB: env.DB, SESSION_SECRET: "otro-secreto-distinto" };
    const cookie = (await createSessionCookie(new Request(URL_BASE), otroEntorno, user.id)).split(";")[0]!;

    expect(await getCurrentUser(conCookie(cookie), env)).toBeNull();
  });

  it("rechaza una sesión caducada", async () => {
    const user = await crearUsuario();

    // La sesión dura 30 días: se emite en el pasado y se lee ahora.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    const cookie = await cookieSesion(user);
    vi.useRealTimers();

    expect(await getCurrentUser(conCookie(cookie), env)).toBeNull();
  });

  it("deja de resolver si el usuario desaparece de la base", async () => {
    const user = await crearUsuario();
    const cookie = await cookieSesion(user);
    expect(await getCurrentUser(conCookie(cookie), env)).not.toBeNull();

    await env.DB.prepare("DELETE FROM usuarios WHERE id = ?1").bind(user.id).run();
    expect(await getCurrentUser(conCookie(cookie), env)).toBeNull();
  });
});

describe("atributos de la cookie", () => {
  it("va marcada HttpOnly, Path=/ y SameSite=Lax", async () => {
    const user = await crearUsuario();
    const cabecera = await createSessionCookie(new Request(URL_BASE), env, user.id);

    expect(cabecera).toContain("HttpOnly");
    expect(cabecera).toContain("Path=/");
    expect(cabecera).toContain("SameSite=Lax");
  });

  it("añade Secure solo cuando la petición va por https", async () => {
    const user = await crearUsuario();

    expect(await createSessionCookie(new Request("https://copa.test/x"), env, user.id)).toContain("; Secure");
    expect(await createSessionCookie(new Request("http://127.0.0.1:8788/x"), env, user.id)).not.toContain("; Secure");
  });

  it("clearSessionCookie caduca la cookie de inmediato", () => {
    const cabecera = clearSessionCookie(new Request(URL_BASE));
    expect(cabecera).toContain("Max-Age=0");
    expect(cabecera.startsWith(`${sessionCookieName}=;`)).toBe(true);
  });
});

describe("requireUser", () => {
  it("devuelve 401 en JSON sin sesión", async () => {
    const respuesta = await requireUser(new Request(URL_BASE), env);
    expect(respuesta).toBeInstanceOf(Response);
    expect((respuesta as Response).status).toBe(401);
  });

  it("devuelve el usuario cuando hay sesión", async () => {
    const user = await crearUsuario();
    const resultado = await requireUser(conCookie(await cookieSesion(user)), env);
    expect(resultado).not.toBeInstanceOf(Response);
    expect((resultado as { id: number }).id).toBe(user.id);
  });
});
