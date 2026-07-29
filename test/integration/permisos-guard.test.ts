import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { requireAlgunPermiso, requirePermiso, type Acceso } from "../../functions/_lib/admin";
import { CLAVES_PERMISO } from "../../functions/_lib/permisos";
import {
  asignarRol,
  cookieSesion,
  cookieVerComo,
  crearAdmin,
  crearUsuario,
  crearUsuarioConPermisos
} from "../helpers/db";

/*
 * La puerta del panel. Antes era «¿eres admin?»; ahora es «¿tienes este
 * permiso?», que es lo que permite dar acceso parcial sin regalar el resto.
 */

const URL_BASE = "https://copa.test/api/admin/equipos";

const conCookies = (cookies: string[]) => new Request(URL_BASE, { headers: { Cookie: cookies.join("; ") } });
const acceso = (resultado: Acceso | Response) => resultado as Acceso;

describe("requirePermiso", () => {
  it("responde 401 sin sesión", async () => {
    const resultado = await requirePermiso(new Request(URL_BASE), env, "equipos.ver");
    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(401);
  });

  it("responde 403 a una cuenta con sesión pero sin rol", async () => {
    const user = await crearUsuario();
    const resultado = await requirePermiso(conCookies([await cookieSesion(user)]), env, "equipos.ver");

    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(403);
    expect(await (resultado as Response).json()).toMatchObject({ error: expect.stringContaining("permiso") });
  });

  it("deja pasar a quien tiene exactamente ese permiso", async () => {
    const user = await crearUsuarioConPermisos(["equipos.ver"], { email: "org@example.com" });
    const resultado = await requirePermiso(conCookies([await cookieSesion(user)]), env, "equipos.ver");

    expect(resultado).not.toBeInstanceOf(Response);
    expect(acceso(resultado).user.email).toBe("org@example.com");
    expect(acceso(resultado).permisos.esAdmin).toBe(false);
  });

  // Lo que distingue el RBAC de un booleano: tener un permiso no da los demás.
  it("responde 403 a quien tiene otro permiso distinto", async () => {
    const user = await crearUsuarioConPermisos(["equipos.ver"]);
    const resultado = await requirePermiso(conCookies([await cookieSesion(user)]), env, "usuarios.editar");

    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(403);
  });

  it("el rol admin abre cualquier permiso del catálogo sin tener filas propias", async () => {
    const admin = await crearAdmin();
    const cookies = [await cookieSesion(admin)];

    for (const permiso of CLAVES_PERMISO) {
      expect(await requirePermiso(conCookies(cookies), env, permiso)).not.toBeInstanceOf(Response);
    }

    const filas = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM rol_permisos rp JOIN roles r ON r.id = rp.rol_id WHERE r.clave = 'admin'")
      .first<{ n: number }>();
    expect(filas!.n).toBe(0);
  });

  // El rol no viaja en la cookie: se relee en cada petición, así que quitarlo
  // deja fuera del panel sin esperar a que caduque la sesión.
  it("quitar el rol cierra el panel con la misma cookie", async () => {
    const admin = await crearAdmin();
    const cookies = [await cookieSesion(admin)];

    expect(await requirePermiso(conCookies(cookies), env, "equipos.editar")).not.toBeInstanceOf(Response);

    await asignarRol(admin.id, null);

    const despues = await requirePermiso(conCookies(cookies), env, "equipos.editar");
    expect(despues).toBeInstanceOf(Response);
    expect((despues as Response).status).toBe(403);
  });

  it("conceder un rol abre el panel sin volver a iniciar sesión", async () => {
    const user = await crearUsuario();
    const cookies = [await cookieSesion(user)];

    expect(await requirePermiso(conCookies(cookies), env, "equipos.editar")).toBeInstanceOf(Response);

    await asignarRol(user.id, "organizacion");
    expect(await requirePermiso(conCookies(cookies), env, "equipos.editar")).not.toBeInstanceOf(Response);
    // ...pero solo lo que ese rol trae: organización no toca cuentas.
    expect(await requirePermiso(conCookies(cookies), env, "usuarios.editar")).toBeInstanceOf(Response);
  });

  // Mientras se suplanta, el usuario efectivo es el suplantado: ni siquiera las
  // lecturas del panel se resuelven como el administrador real.
  it("durante «ver como» el usuario efectivo no hereda los permisos del admin", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    const resultado = await requirePermiso(conCookies(cookies), env, "equipos.editar");
    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(403);
  });
});

describe("requireAlgunPermiso", () => {
  it("basta con tener uno de los pedidos", async () => {
    const user = await crearUsuarioConPermisos(["camisetas.ver"]);
    const cookies = [await cookieSesion(user)];

    expect(
      await requireAlgunPermiso(conCookies(cookies), env, ["equipos.ver", "camisetas.ver"])
    ).not.toBeInstanceOf(Response);
    expect(await requireAlgunPermiso(conCookies(cookies), env, ["equipos.ver", "usuarios.ver"])).toBeInstanceOf(
      Response
    );
  });
});

describe("permisos guardados que ya no existen en el catálogo", () => {
  /*
   * Un permiso retirado en una versión posterior deja filas antiguas en
   * rol_permisos. Se ignoran en vez de romper: la fila sobra, no miente. Lo que
   * no puede pasar es que abran nada.
   */
  it("no conceden nada y no estorban a los que sí existen", async () => {
    const user = await crearUsuarioConPermisos(["equipos.ver", "recurso-que-ya-no-existe.editar"]);
    const cookies = [await cookieSesion(user)];

    expect(await requirePermiso(conCookies(cookies), env, "equipos.ver")).not.toBeInstanceOf(Response);
    expect(await requirePermiso(conCookies(cookies), env, "recurso-que-ya-no-existe.editar")).toBeInstanceOf(Response);
  });
});
