import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { requireAdmin } from "../../functions/_lib/admin";
import { cookieSesion, cookieVerComo, crearAdmin, crearUsuario } from "../helpers/db";

const URL_BASE = "https://copa.test/api/admin/equipos";

const conCookies = (cookies: string[]) => new Request(URL_BASE, { headers: { Cookie: cookies.join("; ") } });

describe("requireAdmin", () => {
  it("responde 401 sin sesión", async () => {
    const resultado = await requireAdmin(new Request(URL_BASE), env);
    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(401);
  });

  it("responde 403 a un usuario con sesión pero sin permiso", async () => {
    const user = await crearUsuario();
    const resultado = await requireAdmin(conCookies([await cookieSesion(user)]), env);

    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(403);
    expect(await (resultado as Response).json()).toMatchObject({ error: expect.stringContaining("permiso") });
  });

  it("devuelve el usuario cuando es administrador", async () => {
    const admin = await crearAdmin({ email: "admin@example.com" });
    const resultado = await requireAdmin(conCookies([await cookieSesion(admin)]), env);

    expect(resultado).not.toBeInstanceOf(Response);
    expect((resultado as { email: string }).email).toBe("admin@example.com");
  });

  // El flag no viaja en la cookie: se relee en cada petición, así que revocarlo
  // deja fuera del panel sin esperar a que caduque la sesión.
  it("revocar is_admin cierra el panel con la misma cookie", async () => {
    const admin = await crearAdmin();
    const cookies = [await cookieSesion(admin)];

    expect(await requireAdmin(conCookies(cookies), env)).not.toBeInstanceOf(Response);

    await env.DB.prepare("UPDATE usuarios SET is_admin = 0 WHERE id = ?1").bind(admin.id).run();

    const despues = await requireAdmin(conCookies(cookies), env);
    expect(despues).toBeInstanceOf(Response);
    expect((despues as Response).status).toBe(403);
  });

  it("conceder is_admin abre el panel sin volver a iniciar sesión", async () => {
    const user = await crearUsuario();
    const cookies = [await cookieSesion(user)];

    expect(await requireAdmin(conCookies(cookies), env)).toBeInstanceOf(Response);

    await env.DB.prepare("UPDATE usuarios SET is_admin = 1 WHERE id = ?1").bind(user.id).run();
    expect(await requireAdmin(conCookies(cookies), env)).not.toBeInstanceOf(Response);
  });

  // Mientras se suplanta, el usuario efectivo es el suplantado, que no es admin:
  // ni siquiera las lecturas del panel se resuelven como el administrador real.
  it("durante «ver como» el usuario efectivo no hereda el permiso del admin", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const cookies = [await cookieSesion(admin), await cookieVerComo(admin, objetivo)];

    const resultado = await requireAdmin(conCookies(cookies), env);
    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(403);
  });
});
