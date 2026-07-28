import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  onRequestDelete,
  onRequestGet,
  onRequestPatch
} from "../../functions/api/mi-equipo";
import { ctx } from "../helpers/ctx";
import { crearEquipo, crearUsuario, peticion, type EquipoSembrado } from "../helpers/db";

/*
 * Quién puede tocar un equipo desde /mi-equipo/.
 *
 * La pertenencia se resuelve por dos vías: ser el propietario, o figurar como
 * jugador con tu correo. La segunda la teclea quien inscribe el equipo, sin que
 * el dueño de ese correo confirme nada, así que sirve para mirar y nada más.
 * Cuando también autorizaba a escribir, cualquiera podía inscribir un equipo
 * con el correo de un tercero y darle el mando sobre la plantilla entera —o
 * quedarse él con el mando sobre la de otro. Estos tests son esa frontera.
 */

const RUTA = "/api/mi-equipo";

/** El cuerpo que manda el editor: la plantilla tal cual, con los ids. */
const payloadDe = (equipo: EquipoSembrado, nombre = equipo.nombre) => ({
  equipo: nombre,
  jugadores: equipo.jugadores.map((j) => ({
    id: j.id,
    nombre: j.nombre,
    apellidos: j.apellidos,
    telefono: j.telefono,
    email: j.email
  }))
});

const nombreDe = async (equipoId: number) =>
  (await env.DB.prepare("SELECT nombre FROM equipos WHERE id = ?1").bind(equipoId).first<{ nombre: string }>())?.nombre;

const existe = async (equipoId: number) =>
  (await env.DB.prepare("SELECT 1 AS x FROM equipos WHERE id = ?1").bind(equipoId).first()) !== null;

/**
 * Un equipo con su propietario y un segundo jugador que solo figura en él.
 * Los nombres van explícitos: los que genera el sembrador llevan dígitos y
 * validarRegistro solo admite letras, así que el PATCH no llegaría a guardar.
 */
async function equipoConMiembro() {
  const dueño = await crearUsuario({ email: "duena@example.com" });
  const miembro = await crearUsuario({ email: "miembro@example.com" });
  const equipo = await crearEquipo({
    jugadores: [
      { nombre: "Ana", apellidos: "Ferro", email: "duena@example.com" },
      { nombre: "Bea", apellidos: "Louro", email: "miembro@example.com" }
    ]
  });
  return { dueño, miembro, equipo };
}

describe("PATCH /api/mi-equipo", () => {
  it("el propietario guarda los cambios de su equipo", async () => {
    const { dueño, equipo } = await equipoConMiembro();

    const respuesta = await onRequestPatch(
      ctx(await peticion(RUTA, { method: "PATCH", user: dueño, json: payloadDe(equipo, "Nombre Nuevo") }), env)
    );

    expect(respuesta.status).toBe(200);
    expect(await nombreDe(equipo.id)).toBe("Nombre Nuevo");
  });

  it("quien solo figura como jugador no puede guardar", async () => {
    const { miembro, equipo } = await equipoConMiembro();

    const respuesta = await onRequestPatch(
      ctx(await peticion(RUTA, { method: "PATCH", user: miembro, json: payloadDe(equipo, "Secuestrado") }), env)
    );

    expect(respuesta.status).toBe(403);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("capitán") });
    expect(await nombreDe(equipo.id), "el equipo no debería haber cambiado").toBe(equipo.nombre);
  });

  // El 403 sale antes de mirar el cuerpo: a quien no puede guardar no se le
  // devuelve el detalle campo a campo de un equipo que no es suyo.
  it("a quien no es propietario no se le validan los campos", async () => {
    const { miembro } = await equipoConMiembro();

    const respuesta = await onRequestPatch(
      ctx(await peticion(RUTA, { method: "PATCH", user: miembro, json: { equipo: "", jugadores: [] } }), env)
    );

    expect(respuesta.status).toBe(403);
    expect(await respuesta.json()).not.toHaveProperty("campos");
  });

  it("sin equipo en la edición actual responde 404", async () => {
    const suelto = await crearUsuario();

    const respuesta = await onRequestPatch(
      ctx(await peticion(RUTA, { method: "PATCH", user: suelto, json: { equipo: "X", jugadores: [] } }), env)
    );

    expect(respuesta.status).toBe(404);
  });
});

describe("DELETE /api/mi-equipo", () => {
  it("el propietario borra su equipo", async () => {
    const { dueño, equipo } = await equipoConMiembro();

    const respuesta = await onRequestDelete(ctx(await peticion(RUTA, { method: "DELETE", user: dueño }), env));

    expect(respuesta.status).toBe(200);
    expect(await existe(equipo.id)).toBe(false);
  });

  it("quien solo figura como jugador no puede borrarlo", async () => {
    const { miembro, equipo } = await equipoConMiembro();

    const respuesta = await onRequestDelete(ctx(await peticion(RUTA, { method: "DELETE", user: miembro }), env));

    expect(respuesta.status).toBe(403);
    expect(await existe(equipo.id), "el equipo debería seguir ahí").toBe(true);
    const jugadores = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM jugadores WHERE equipo_id = ?1")
      .bind(equipo.id)
      .first<{ n: number }>();
    expect(jugadores?.n).toBe(2);
  });

  it("sin equipo ninguno, borrar no es un error", async () => {
    const suelto = await crearUsuario();
    const respuesta = await onRequestDelete(ctx(await peticion(RUTA, { method: "DELETE", user: suelto }), env));

    expect(respuesta.status).toBe(200);
  });
});

describe("GET /api/mi-equipo", () => {
  it("el propietario recibe puedeEditar: true", async () => {
    const { dueño } = await equipoConMiembro();
    const respuesta = await onRequestGet(ctx(await peticion(RUTA, { user: dueño }), env));

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ team: { puedeEditar: true } });
  });

  // Ve la plantilla —es su equipo— pero el editor se le pinta en modo lectura.
  it("el jugador que no lo inscribió lo ve con puedeEditar: false", async () => {
    const { miembro, equipo } = await equipoConMiembro();
    const respuesta = await onRequestGet(ctx(await peticion(RUTA, { user: miembro }), env));

    const cuerpo = (await respuesta.json()) as { team: { id: number; puedeEditar: boolean; jugadores: unknown[] } };
    expect(cuerpo.team.id).toBe(equipo.id);
    expect(cuerpo.team.puedeEditar).toBe(false);
    expect(cuerpo.team.jugadores).toHaveLength(2);
  });
});
