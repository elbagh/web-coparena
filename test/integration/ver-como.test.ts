import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVerComoCookie, getAuthContext, hayVerComo, verComoCookieName } from "../../functions/_lib/auth";
import { onRequest as middleware } from "../../functions/_middleware";
import { crearContexto } from "../helpers/ctx";
import {
  asignarRol,
  cookieSesion,
  cookieVerComo,
  crearAdmin,
  crearUsuario,
  crearUsuarioConPermisos
} from "../helpers/db";

const URL_BASE = "https://copa.test/api/mi-equipo";

afterEach(() => {
  vi.useRealTimers();
});

const conCookies = (cookies: string[], url = URL_BASE, method = "GET") =>
  new Request(url, { method, headers: { Cookie: cookies.join("; ") } });

describe("resolución del usuario efectivo", () => {
  it("el admin ve el sitio como el usuario suplantado", async () => {
    const admin = await crearAdmin({ email: "admin@example.com" });
    const objetivo = await crearUsuario({ email: "capitan@example.com" });

    const contexto = await getAuthContext(
      conCookies([await cookieSesion(admin), await cookieVerComo(admin, objetivo)]),
      env
    );

    expect(contexto.user?.id).toBe(objetivo.id);
    expect(contexto.user?.email).toBe("capitan@example.com");
    expect(contexto.realUser?.id).toBe(admin.id);
    expect(contexto.impersonando).toBe(true);
  });

  // Es el motivo de que el rol se relea en cada petición en vez de viajar en la
  // cookie: quitar el permiso corta la suplantación al instante.
  it("quitar el rol corta la suplantación en la siguiente petición", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    expect((await getAuthContext(conCookies(cookies), env)).impersonando).toBe(true);

    await asignarRol(admin.id, null);

    const despues = await getAuthContext(conCookies(cookies), env);
    expect(despues.impersonando).toBe(false);
    expect(despues.user?.id).toBe(admin.id);
  });

  /*
   * Lo que habilita la suplantación es el permiso `usuarios.ver_como`, no ser
   * administrador. Un rol reducido que lo lleve suplanta igual, y uno que no lo
   * lleve no suplanta aunque entre al panel: el corte es el permiso concreto.
   */
  it("un rol sin `usuarios.ver_como` no suplanta, aunque entre al panel", async () => {
    const gestor = await crearUsuarioConPermisos(["panel.entrar", "usuarios.ver"]);
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(gestor), await cookieVerComo(gestor, objetivo)];

    const contexto = await getAuthContext(conCookies(cookies), env);
    expect(contexto.impersonando).toBe(false);
    expect(contexto.user?.id).toBe(gestor.id);
  });

  it("un rol reducido con `usuarios.ver_como` sí suplanta", async () => {
    const gestor = await crearUsuarioConPermisos(["usuarios.ver", "usuarios.ver_como"]);
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(gestor), await cookieVerComo(gestor, objetivo)];

    const contexto = await getAuthContext(conCookies(cookies), env);
    expect(contexto.impersonando).toBe(true);
    expect(contexto.user?.id).toBe(objetivo.id);
  });

  // Copiar la cookie a otro navegador no sirve de nada: tiene que coincidir con
  // la sesión real que la acompaña.
  it("ignora una cookie cuyo adminUid no es el de la sesión real", async () => {
    const admin = await crearAdmin();
    const intruso = await crearUsuario();
    const objetivo = await crearUsuario();

    const contexto = await getAuthContext(
      conCookies([await cookieSesion(intruso), await cookieVerComo(admin, objetivo)]),
      env
    );

    expect(contexto.impersonando).toBe(false);
    expect(contexto.user?.id).toBe(intruso.id);
  });

  it("ignora la cookie si el usuario suplantado ya no existe", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    await env.DB.prepare("DELETE FROM usuarios WHERE id = ?1").bind(objetivo.id).run();

    const contexto = await getAuthContext(conCookies(cookies), env);
    expect(contexto.impersonando).toBe(false);
    expect(contexto.user?.id).toBe(admin.id);
  });

  it("ignora una cookie de suplantación caducada", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();

    // Dura 30 minutos: se emite hace una hora.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() - 60 * 60 * 1000));
    const verComo = await cookieVerComo(admin, objetivo);
    vi.useRealTimers();

    const contexto = await getAuthContext(conCookies([await cookieSesion(admin), verComo]), env);
    expect(contexto.impersonando).toBe(false);
  });

  it("sin sesión real, la cookie de suplantación por sí sola no da acceso", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();

    const contexto = await getAuthContext(conCookies([await cookieVerComo(admin, objetivo)]), env);
    expect(contexto.user).toBeNull();
    expect(contexto.impersonando).toBe(false);
  });
});

describe("hayVerComo", () => {
  it("detecta una cookie con firma válida", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    expect(await hayVerComo(conCookies([await cookieVerComo(admin, objetivo)]), env)).toBe(true);
  });

  it("no se deja engañar por una firma inválida ni por la ausencia de cookie", async () => {
    expect(await hayVerComo(conCookies([`${verComoCookieName}=falsa.firma`]), env)).toBe(false);
    expect(await hayVerComo(new Request(URL_BASE), env)).toBe(false);
  });

  it("no se deja engañar por una cookie firmada con otro secreto", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const otroEntorno = { DB: env.DB, SESSION_SECRET: "otro-secreto" };
    const cookie = (await createVerComoCookie(new Request(URL_BASE), otroEntorno, admin.id, objetivo.id)).split(";")[0]!;

    expect(await hayVerComo(conCookies([cookie]), env)).toBe(false);
  });
});

/*
 * El invariante que sostiene todo el modo "ver como": es de solo lectura, y eso
 * se impone en un único sitio. Si estos tests se caen, un administrador puede
 * escribir en nombre de otra persona.
 */
describe("middleware: «ver como» es de solo lectura", () => {
  const llamar = async (method: string, ruta: string, cookies: string[]) => {
    const { contexto, next } = crearContexto(conCookies(cookies, `https://copa.test${ruta}`, method), env);
    const respuesta = await middleware(contexto);
    return { respuesta, next };
  };

  it("deja pasar los métodos de lectura", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const { respuesta, next } = await llamar(method, "/api/mi-equipo", cookies);
      expect(next, `${method} debería pasar`).toHaveBeenCalled();
      expect(respuesta.status).toBe(204);
    }
  });

  it("corta cualquier escritura con 403 y sin llegar al handler", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const { respuesta, next } = await llamar(method, "/api/mi-equipo", cookies);
      expect(respuesta.status, `${method} debería dar 403`).toBe(403);
      expect(next, `${method} no debería llegar al handler`).not.toHaveBeenCalled();
      expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
      expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("otra persona") });
    }
  });

  it("corta las escrituras en cualquier ruta, no solo en una", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    for (const ruta of ["/api/perfil", "/api/equipos", "/api/partidos", "/api/admin/equipos", "/api/camisetas"]) {
      const { respuesta } = await llamar("POST", ruta, cookies);
      expect(respuesta.status, `POST ${ruta}`).toBe(403);
    }
  });

  // Salir del modo tiene que seguir siendo posible: es lo que devuelve el
  // control al administrador.
  it("deja salir del propio modo con DELETE /api/admin/ver-como", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    const { respuesta, next } = await llamar("DELETE", "/api/admin/ver-como", cookies);
    expect(next).toHaveBeenCalled();
    expect(respuesta.status).toBe(204);
  });

  it("la excepción de salida no abre otros métodos en esa misma ruta", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    const { respuesta } = await llamar("POST", "/api/admin/ver-como", cookies);
    expect(respuesta.status).toBe(403);
  });

  /*
   * Entrar y salir del sitio actúan sobre la propia sesión, no sobre los datos
   * de nadie, y por eso pasan. Sin ellas, una cookie de suplantación olvidada
   * dejaba el navegador sin poder desloguearse *ni loguearse* hasta que
   * caducara: el login también es un POST.
   */
  it("deja cerrar sesión y volver a entrar con la cookie puesta", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    for (const ruta of ["/api/auth/logout", "/api/auth/google"]) {
      const { respuesta, next } = await llamar("POST", ruta, cookies);
      expect(next, `POST ${ruta} debería pasar`).toHaveBeenCalled();
      expect(respuesta.status).toBe(204);
    }
  });

  it("esas excepciones son de ruta y método exactos", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    // Otro método en una ruta con excepción, y otra ruta de auth sin ella.
    for (const [method, ruta] of [
      ["DELETE", "/api/auth/logout"],
      ["PATCH", "/api/auth/google"],
      ["POST", "/api/auth/config"]
    ]) {
      const { respuesta } = await llamar(method!, ruta!, cookies);
      expect(respuesta.status, `${method} ${ruta}`).toBe(403);
    }
  });

  it("sin cookie de suplantación las escrituras pasan con normalidad", async () => {
    const user = await crearUsuario();
    const { respuesta, next } = await llamar("POST", "/api/mi-equipo", [await cookieSesion(user)]);

    expect(next).toHaveBeenCalled();
    expect(respuesta.status).toBe(204);
  });
});
