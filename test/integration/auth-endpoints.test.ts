import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost as logout } from "../../functions/api/auth/logout";
import { sessionCookieName, verComoCookieName } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearUsuario, peticion } from "../helpers/db";

/*
 * Cerrar sesión tiene que llevarse por delante las dos cookies. Si solo cayera
 * la de sesión, la de «ver como» seguiría viva hasta media hora y el middleware
 * bloquearía toda escritura en ese navegador —incluido el propio login, que es
 * un POST—: quien viniera después se quedaba sin poder entrar.
 */

const cookiesDe = (respuesta: Response) => respuesta.headers.getSetCookie();

describe("POST /api/auth/logout", () => {
  it("caduca la cookie de sesión y la de «ver como», cada una en su cabecera", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();

    const respuesta = await logout(
      ctx(
        await peticion("/api/auth/logout", {
          method: "POST",
          user: admin,
          verComo: { admin, objetivo }
        }),
        env
      )
    );

    const cookies = cookiesDe(respuesta);
    expect(respuesta.status).toBe(200);
    expect(cookies, "las dos cookies van en cabeceras Set-Cookie separadas").toHaveLength(2);

    const sesion = cookies.find((c) => c.startsWith(`${sessionCookieName}=`));
    const verComo = cookies.find((c) => c.startsWith(`${verComoCookieName}=`));
    expect(sesion).toContain("Max-Age=0");
    expect(verComo).toContain("Max-Age=0");
  });

  it("no se cae si no había ninguna sesión", async () => {
    const respuesta = await logout(ctx(await peticion("/api/auth/logout", { method: "POST" }), env));

    expect(respuesta.status).toBe(200);
    expect(cookiesDe(respuesta)).toHaveLength(2);
  });
});
