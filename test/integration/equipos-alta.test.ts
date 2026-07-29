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
      capitan: 0,
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
  // El capitán se identifica por índice, no por buscar el correo de la sesión
  // en la plantilla: el alta tiene que nombrar capitán al jugador correcto sea
  // cual sea su posición, siempre que su correo sea el de la sesión.
  it("nombra capitán al jugador del índice indicado aunque no sea el primero", async () => {
    const user = await crearUsuario({ email: "ana@example.com" });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        equipo: "Equipo Capitana Segunda",
        consentimiento: true,
        capitan: 1,
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

  // El móvil vacío no puede tratarse como un valor más a buscar en la base:
  // dos jugadores sin móvil (uno ya sembrado, otro en el alta) no son "el
  // mismo móvil repetido". Antes de esta prueba, ninguna de las dos guardas
  // de buscarDuplicados (el filtrado de la lista para el IN, y el `&&` al
  // marcar el campo) tenía cobertura: si ambas se caían a la vez, nada lo
  // avisaba. La que de verdad decide el resultado aquí es la del marcado —
  // el filtrado del IN es solo para no traerse de la base filas irrelevantes.
  it("no rechaza a un jugador sin móvil por el hueco vacío de otro equipo", async () => {
    await crearEquipo({ jugadores: [{ telefono: "" }, {}] });

    const user = await crearUsuario({ email: "capi2@example.com" });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        equipo: "Equipo Sin Móvil",
        consentimiento: true,
        capitan: 0,
        jugadores: [
          { nombre: "Marta", apellidos: "Novo", telefono: "600222333", email: user.email },
          { nombre: "Sara", apellidos: "Bao", telefono: "", email: "" }
        ]
      })
    );

    const respuesta = await onRequestPost(
      ctx(await peticion("/api/equipos", { method: "POST", user, body: form }), env)
    );

    expect(respuesta.status).toBe(201);
  });

  it("guarda al capitán indicado en el alta", async () => {
    const user = await crearUsuario({ email: "capi@example.com" });
    const payload = {
      equipo: "Los Rompeolas",
      consentimiento: true,
      capitan: 1,
      jugadores: [
        { nombre: "Ana", apellidos: "Pérez", telefono: "", email: "" },
        { nombre: "Luis", apellidos: "Gómez", telefono: "600111222", email: user.email }
      ]
    };
    const datos = new FormData();
    datos.append("payload", JSON.stringify(payload));

    const respuesta = await onRequestPost(
      ctx(await peticion("/api/equipos", { method: "POST", user, body: datos }), env)
    );
    expect(respuesta.status).toBe(201);

    const fila = await env.DB
      .prepare(
        `SELECT c.email FROM equipos e JOIN jugadores c ON c.id = e.capitan_jugador_id
         WHERE e.nombre = ?1`
      )
      .bind("Los Rompeolas")
      .first<{ email: string }>();
    expect(fila?.email).toBe(user.email);
  });
});
