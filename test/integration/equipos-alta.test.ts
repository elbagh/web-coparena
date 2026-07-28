import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost } from "../../functions/api/equipos";
import { ctx } from "../helpers/ctx";
import { crearEquipo, crearUsuario, peticion } from "../helpers/db";

/*
 * Ya estar en un equipo cierra la inscripción, pero por dos motivos distintos:
 * haberlo inscrito tú (y entonces se edita desde Mi zona) o aparecer listado en
 * el de otra persona (y entonces no se puede editar nada, así que mandar ahí a
 * alguien es mandarlo a un 403).
 */

const alta = async (user: Awaited<ReturnType<typeof crearUsuario>>) => {
  const form = new FormData();
  form.set(
    "payload",
    JSON.stringify({
      equipo: "Equipo Nuevo",
      consentimiento: true,
      jugadores: [
        { nombre: "Ana", apellidos: "Ferro", telefono: "600111222", email: user.email },
        { nombre: "Bea", apellidos: "Louro", telefono: "600111333", email: "otra@example.com" }
      ]
    })
  );

  return await onRequestPost(
    ctx(await peticion("/api/equipos", { method: "POST", user, body: form }), env)
  );
};

describe("POST /api/equipos cuando ya figuras en un equipo", () => {
  it("a quien lo inscribió le manda a editarlo en Mi zona", async () => {
    const dueño = await crearUsuario({ email: "duena@example.com" });
    await crearEquipo({
      jugadores: [{ nombre: "Ana", apellidos: "Ferro", email: "duena@example.com" }, {}]
    });

    const respuesta = await alta(dueño);

    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("Mi zona") });
  });

  it("a quien solo aparece listado le dice dónde está y a quién escribir", async () => {
    const dueño = await crearUsuario({ email: "duena@example.com" });
    const miembro = await crearUsuario({ email: "miembro@example.com" });
    await crearEquipo({
      nombre: "Los Delfines",
      jugadores: [
        { nombre: "Ana", apellidos: "Ferro", email: "duena@example.com" },
        { nombre: "Bea", apellidos: "Louro", email: "miembro@example.com" }
      ]
    });

    const respuesta = await alta(miembro);
    const cuerpo = (await respuesta.json()) as { error: string };

    expect(respuesta.status).toBe(409);
    expect(cuerpo.error).toContain("Los Delfines");
    expect(cuerpo.error).not.toContain("Mi zona");
  });
});

describe("POST /api/equipos: capitán", () => {
  // La validación solo exige que el correo de la sesión aparezca *en algún*
  // jugador, no en el primero: el alta tiene que nombrar capitán al jugador
  // correcto sea cual sea su posición en la plantilla.
  it("nombra capitán al jugador que lleva el correo de la sesión aunque no sea el primero", async () => {
    const user = await crearUsuario({ email: "ana@example.com" });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        equipo: "Equipo Capitana Segunda",
        consentimiento: true,
        jugadores: [
          { nombre: "Bea", apellidos: "Louro", telefono: "600111333", email: "otra@example.com" },
          { nombre: "Ana", apellidos: "Ferro", telefono: "600111222", email: user.email }
        ]
      })
    );

    const respuesta = await onRequestPost(
      ctx(await peticion("/api/equipos", { method: "POST", user, body: form }), env)
    );
    expect(respuesta.status).toBe(201);
    const { equipoId } = (await respuesta.json()) as { equipoId: number };

    const capitan = await env.DB
      .prepare(
        `SELECT j.email FROM equipos e JOIN jugadores j ON j.id = e.capitan_jugador_id WHERE e.id = ?1`
      )
      .bind(equipoId)
      .first<{ email: string }>();

    expect(capitan?.email).toBe(user.email);
  });
});
