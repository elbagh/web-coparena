import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet as fotoDeJugador } from "../../functions/api/admin/fotos";
import { onRequestGet as equiposGet } from "../../functions/api/equipos";
import { onRequestGet as adminResumenGet } from "../../functions/api/admin/index";
import { onRequestGet as adminJugadoresGet } from "../../functions/api/admin/jugadores";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearUsuario, peticion, sembrarFoto } from "../helpers/db";

/*
 * Dos tipos de foto con dos visibilidades opuestas, y es fácil confundirlas:
 *
 *   - foto de JUGADOR  → privada. Solo sale por /api/admin/fotos, tras
 *                        requireAdmin, y nunca se cachea.
 *   - foto de EQUIPO   → pública. Sale por /api/equipos?foto=N con caché.
 *
 * En los dos casos la API dice `tieneFoto`, jamás la clave de R2.
 */

const KEY_JUGADOR = "equipos/lote/jugador-1.jpg";
const KEY_EQUIPO = "equipos/lote/grupo.jpg";

/** Lee el cuerpo como bytes: con Content-Type de imagen, .text() avisa por consola. */
const cuerpoComoTexto = async (respuesta: Response) =>
  new TextDecoder().decode(await respuesta.arrayBuffer());

describe("la foto de jugador es privada", () => {
  it("sin sesión responde 401 y no devuelve la imagen", async () => {
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: await sembrarFoto(KEY_JUGADOR) }, {}] });
    const request = await peticion(`/api/admin/fotos?jugador=${equipo.jugadores[0]!.id}`);

    const respuesta = await fotoDeJugador(ctx(request, env));
    expect(respuesta.status).toBe(401);
    expect(respuesta.headers.get("Content-Type")).not.toContain("image/");
  });

  it("con sesión sin permiso responde 403", async () => {
    const user = await crearUsuario();
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: await sembrarFoto(KEY_JUGADOR) }, {}] });
    const request = await peticion(`/api/admin/fotos?jugador=${equipo.jugadores[0]!.id}`, { user });

    expect((await fotoDeJugador(ctx(request, env))).status).toBe(403);
  });

  it("un administrador sí la recibe, sin caché", async () => {
    const admin = await crearAdmin();
    await sembrarFoto(KEY_JUGADOR, "bytes-de-la-foto");
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: KEY_JUGADOR }, {}] });
    const request = await peticion(`/api/admin/fotos?jugador=${equipo.jugadores[0]!.id}`, { user: admin });

    const respuesta = await fotoDeJugador(ctx(request, env));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    expect(respuesta.headers.get("Content-Type")).toBe("image/jpeg");
    expect(await cuerpoComoTexto(respuesta)).toBe("bytes-de-la-foto");
  });

  it("responde 404 si el jugador no tiene foto", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const request = await peticion(`/api/admin/fotos?jugador=${equipo.jugadores[0]!.id}`, { user: admin });

    expect((await fotoDeJugador(ctx(request, env))).status).toBe(404);
  });

  it("responde 404 si la fila apunta a un objeto que ya no está en R2", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: "equipos/lote/desaparecida.jpg" }, {}] });
    const request = await peticion(`/api/admin/fotos?jugador=${equipo.jugadores[0]!.id}`, { user: admin });

    expect((await fotoDeJugador(ctx(request, env))).status).toBe(404);
  });

  it("rechaza un identificador de jugador que no es válido", async () => {
    const admin = await crearAdmin();
    const request = await peticion("/api/admin/fotos?jugador=abc", { user: admin });

    expect((await fotoDeJugador(ctx(request, env))).status).toBe(400);
  });
});

describe("la foto de equipo es pública", () => {
  it("cualquiera la recibe, con caché", async () => {
    await sembrarFoto(KEY_EQUIPO, "foto-de-grupo");
    const equipo = await crearEquipo({ fotoKey: KEY_EQUIPO });

    const respuesta = await equiposGet(ctx(await peticion(`/api/equipos?foto=${equipo.id}`), env));

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Cache-Control")).toContain("max-age");
    expect(await cuerpoComoTexto(respuesta)).toBe("foto-de-grupo");
  });

  it("responde 404 si el equipo no tiene foto", async () => {
    const equipo = await crearEquipo();
    const respuesta = await equiposGet(ctx(await peticion(`/api/equipos?foto=${equipo.id}`), env));
    expect(respuesta.status).toBe(404);
  });
});

describe("la clave de R2 nunca sale al cliente", () => {
  it("el listado público solo dice si hay foto", async () => {
    await sembrarFoto(KEY_EQUIPO);
    await crearEquipo({ nombre: "Los Delfines", fotoKey: KEY_EQUIPO });

    const respuesta = await equiposGet(ctx(await peticion("/api/equipos"), env));
    const texto = await respuesta.text();

    expect(texto).not.toContain(KEY_EQUIPO);
    expect(texto).not.toContain("foto_key");
    expect(JSON.parse(texto).equipos[0].tieneFoto).toBe(true);
  });

  it("el resumen del panel tampoco expone las claves de las fotos de jugador", async () => {
    const admin = await crearAdmin();
    await sembrarFoto(KEY_JUGADOR);
    await crearEquipo({ jugadores: [{ fotoKey: KEY_JUGADOR }, {}] });

    const respuesta = await adminResumenGet(ctx(await peticion("/api/admin", { user: admin }), env));
    const texto = await respuesta.text();

    expect(respuesta.status).toBe(200);
    expect(texto).not.toContain(KEY_JUGADOR);
    expect(texto).not.toContain("foto_key");
    expect(texto).toContain("tieneFoto");
  });

  it("la ficha de un jugador tampoco la expone", async () => {
    const admin = await crearAdmin();
    await sembrarFoto(KEY_JUGADOR);
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: KEY_JUGADOR }, {}] });

    const respuesta = await adminJugadoresGet(
      ctx(await peticion(`/api/admin/jugadores?equipo=${equipo.id}`, { user: admin }), env)
    );
    const texto = await respuesta.text();

    expect(respuesta.status).toBe(200);
    expect(texto).not.toContain(KEY_JUGADOR);
    expect(texto).not.toContain("foto_key");
  });
});
