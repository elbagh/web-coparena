import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet as avatar } from "../../functions/api/avatar";
import { onRequestGet as perfil } from "../../functions/api/perfil";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearUsuario, peticion, sembrarFoto } from "../helpers/db";

/*
 * El avatar se siembra solo: la primera vez que alguien abre su ficha, si no
 * tiene avatar propio pero sí foto de inscripción, se copia a `avatares/<id>` y
 * se guarda la clave en `perfiles`. Es una escritura dentro de un GET, que es
 * justo el método que el middleware de «ver como» deja pasar.
 *
 * Así que la siembra tiene que saber cuándo NO tocar nada: mientras un
 * administrador mira el sitio como otra persona, esa persona ve su foto igual,
 * pero no se le crea nada en su perfil. El modo es de solo lectura entero, no
 * "de solo lectura salvo este rincón".
 */

const claveGuardada = async (usuarioId: number) =>
  (
    await env.DB
      .prepare("SELECT avatar_key FROM perfiles WHERE usuario_id = ?1")
      .bind(usuarioId)
      .first<{ avatar_key: string | null }>()
  )?.avatar_key ?? null;

const objetosEnR2 = async () => (await env.FOTOS.list()).objects.map((o) => o.key).sort();

/** Un usuario con foto de inscripción y sin avatar propio todavía. */
async function usuarioConFotoDeInscripcion(email = "capitana@example.com") {
  const user = await crearUsuario({ email });
  const foto = await sembrarFoto("equipos/lote-1/jugador-1.jpg", "bytes");
  await crearEquipo({
    jugadores: [{ nombre: "Ana", apellidos: "Ferro", email, fotoKey: foto }, {}]
  });
  return { user, foto };
}

describe("GET /api/avatar en sesión normal", () => {
  it("siembra el avatar desde la foto de inscripción", async () => {
    const { user, foto } = await usuarioConFotoDeInscripcion();

    const respuesta = await avatar(ctx(await peticion("/api/avatar", { user }), env));

    expect(respuesta.status).toBe(200);
    expect(await claveGuardada(user.id)).toBe(`avatares/${user.id}.jpg`);
    expect(await objetosEnR2()).toContain(`avatares/${user.id}.jpg`);
    expect(await objetosEnR2(), "la foto de origen sigue donde estaba").toContain(foto);
  });

  it("sin foto de ninguna clase responde 404 y no inventa nada", async () => {
    const user = await crearUsuario();

    const respuesta = await avatar(ctx(await peticion("/api/avatar", { user }), env));

    expect(respuesta.status).toBe(404);
    expect(await claveGuardada(user.id)).toBeNull();
    expect(await objetosEnR2()).toHaveLength(0);
  });
});

describe("GET /api/avatar mientras se ve el sitio como otra persona", () => {
  it("sirve la foto sin escribir ni en perfiles ni en R2", async () => {
    const admin = await crearAdmin();
    const { user } = await usuarioConFotoDeInscripcion();
    const antes = await objetosEnR2();

    const respuesta = await avatar(
      ctx(await peticion("/api/avatar", { user: admin, verComo: { admin, objetivo: user } }), env)
    );

    expect(respuesta.status, "la foto se sigue viendo").toBe(200);
    expect(await claveGuardada(user.id), "no debería haberse creado su avatar").toBeNull();
    expect(await objetosEnR2(), "R2 no debería haber cambiado").toEqual(antes);
  });

  it("tampoco la siembra al pintar la ficha en /api/perfil", async () => {
    const admin = await crearAdmin();
    const { user } = await usuarioConFotoDeInscripcion();
    const antes = await objetosEnR2();

    const respuesta = await perfil(
      ctx(await peticion("/api/perfil", { user: admin, verComo: { admin, objetivo: user } }), env)
    );

    expect(respuesta.status).toBe(200);
    // La ficha sigue diciendo la verdad: esa persona tiene foto.
    expect(await respuesta.json()).toMatchObject({ perfil: { tieneAvatar: true } });
    expect(await claveGuardada(user.id)).toBeNull();
    expect(await objetosEnR2()).toEqual(antes);
  });

  it("si ya tenía avatar propio, se sirve igual", async () => {
    const admin = await crearAdmin();
    const user = await crearUsuario();
    const propio = await sembrarFoto(`avatares/${user.id}.png`, "bytes");
    await env.DB
      .prepare("INSERT INTO perfiles (usuario_id, avatar_key) VALUES (?1, ?2)")
      .bind(user.id, propio)
      .run();

    const respuesta = await avatar(
      ctx(await peticion("/api/avatar", { user: admin, verComo: { admin, objetivo: user } }), env)
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("image/png");
    expect(await claveGuardada(user.id)).toBe(propio);
  });
});
