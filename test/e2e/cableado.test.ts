import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cookieSesion, cookieVerComo, crearAdmin, crearUsuario } from "../helpers/db";

/*
 * El único test que corre contra el worker construido (.worker/index.js), y por
 * eso el único que necesita `npm run build` antes.
 *
 * Aquí no se prueba lógica: eso ya lo hace test/integration llamando a los
 * handlers directamente. Lo que se prueba es el CABLEADO — que
 * functions/_middleware.ts se ejecuta de verdad delante de todas las rutas.
 * Llamando a los handlers uno a uno eso es indemostrable: el middleware podría
 * estar perfecto y no estar enganchado a nada.
 */

const BASE = "https://copa.test";

async function cookiesDeSuplantacion() {
  const admin = await crearAdmin({ email: "admin@example.com" });
  const objetivo = await crearUsuario({ email: "capitan@example.com" });
  return [await cookieSesion(admin), await cookieVerComo(admin, objetivo)].join("; ");
}

const pedir = (ruta: string, method: string, cookie: string) =>
  SELF.fetch(`${BASE}${ruta}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: ["GET", "HEAD"].includes(method) ? undefined : "{}"
  });

describe("el middleware de «ver como» está enganchado a todas las rutas", () => {
  it("bloquea las escrituras en cada endpoint que escribe", async () => {
    const cookie = await cookiesDeSuplantacion();

    const rutas: [string, string][] = [
      ["/api/mi-equipo", "PATCH"],
      ["/api/perfil", "PATCH"],
      ["/api/equipos", "POST"],
      ["/api/camisetas", "POST"],
      ["/api/partidos", "POST"],
      ["/api/admin/equipos", "PATCH"],
      ["/api/admin/jugadores", "POST"],
      ["/api/admin/usuarios", "PATCH"],
      ["/api/admin/ediciones", "POST"],
      ["/api/admin/roles", "POST"],
      ["/api/admin/roles", "PATCH"],
      ["/api/admin/roles", "DELETE"],
      ["/api/avatar", "POST"]
    ];

    for (const [ruta, method] of rutas) {
      const respuesta = await pedir(ruta, method, cookie);
      expect(respuesta.status, `${method} ${ruta} debería estar bloqueado`).toBe(403);
      expect((await respuesta.json() as { error: string }).error).toContain("otra persona");
    }
  });

  it("deja pasar las lecturas", async () => {
    const cookie = await cookiesDeSuplantacion();

    for (const ruta of ["/api/equipos", "/api/partidos", "/api/me"]) {
      const respuesta = await pedir(ruta, "GET", cookie);
      expect(respuesta.status, `GET ${ruta}`).toBe(200);
    }
  });

  // La única excepción del middleware: salir del modo tiene que seguir siendo
  // posible, y se valida contra el admin real, no contra el usuario efectivo.
  it("permite salir del modo con DELETE /api/admin/ver-como", async () => {
    const cookie = await cookiesDeSuplantacion();
    const respuesta = await pedir("/api/admin/ver-como", "DELETE", cookie);

    expect(respuesta.status).not.toBe(403);
    expect(respuesta.headers.get("Set-Cookie")).toContain("copa_ver_como=");
  });

  it("esa excepción no abre otros métodos de la misma ruta", async () => {
    const cookie = await cookiesDeSuplantacion();
    expect((await pedir("/api/admin/ver-como", "POST", cookie)).status).toBe(403);
  });

  // Con la cookie puesta hay que poder salir del sitio: si el logout se bloquea,
  // el navegador se queda sin forma de volver a un estado limpio.
  it("permite cerrar sesión, y el logout se lleva las dos cookies", async () => {
    const cookie = await cookiesDeSuplantacion();
    const respuesta = await pedir("/api/auth/logout", "POST", cookie);

    expect(respuesta.status).toBe(200);
    const cookies = respuesta.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("copa_session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("copa_ver_como=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("sin la cookie de suplantación las rutas responden con normalidad", async () => {
    const user = await crearUsuario();
    const cookie = await cookieSesion(user);

    // Ya no es 403 del middleware: cada endpoint aplica sus propias reglas.
    const respuesta = await pedir("/api/admin/usuarios", "PATCH", cookie);
    expect(respuesta.status).toBe(403);
    expect((await respuesta.json() as { error: string }).error).toContain("permiso");
  });
});

describe("las rutas públicas siguen siendo públicas", () => {
  it("GET /api/equipos y GET /api/partidos responden sin ninguna sesión", async () => {
    for (const ruta of ["/api/equipos", "/api/partidos"]) {
      const respuesta = await SELF.fetch(`${BASE}${ruta}`);
      expect(respuesta.status, `GET ${ruta}`).toBe(200);
    }
  });

  // Era la única escritura sin sesión de toda la API: cualquiera podía meter
  // filas en `inscripciones`, la tabla de la primera versión del sitio. Hoy no
  // queda ni la puerta de entrada ni la tabla.
  it("el alta anónima de /api/inscripciones ya no existe", async () => {
    const respuesta = await SELF.fetch(`${BASE}/api/inscripciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team: "Los Colados", email: "colado@example.com" })
    });

    expect(respuesta.status).toBe(404);
    const filas = await SELF.fetch(`${BASE}/api/inscripciones`);
    expect(filas.status).toBe(404);
  });

  it("las escrituras de /api/partidos siguen cerradas a los anónimos", async () => {
    const respuesta = await SELF.fetch(`${BASE}/api/partidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "draw" })
    });
    expect(respuesta.status).toBe(401);
  });
});

describe("lo heredado ya no está cableado", () => {
  // Con cookie de admin a propósito: así un 404 significa que la ruta no
  // existe, y no que la petición se haya quedado en el 401 de requireAdmin.
  it("GET /api/admin/heredado responde 404 incluso para un admin", async () => {
    const admin = await crearAdmin({ email: "admin@example.com" });
    const respuesta = await pedir("/api/admin/heredado", "GET", await cookieSesion(admin));

    expect(respuesta.status).toBe(404);
  });
});
