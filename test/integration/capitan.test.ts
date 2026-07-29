import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPatch as equiposAdminPatch } from "../../functions/api/admin/equipos";
import {
  onRequestDelete as jugadoresAdminDelete,
  onRequestPatch as jugadoresAdminPatch,
  onRequestPost as jugadoresAdminPost
} from "../../functions/api/admin/jugadores";
import { MENSAJE_CAPITAN_CONTACTO } from "../../functions/_lib/validacion";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEdicion, crearEquipo, peticion } from "../helpers/db";

/*
 * No es solo esquema: además de comprobar la migración 0011 (mueve el mando de
 * equipos.owner_user_id a equipos.capitan_jugador_id y hace opcional el móvil)
 * contra la base real, cubre el único escritor de capitán que tiene reglas
 * propias — PATCH /api/admin/equipos?accion=ficha — porque antes de esta ronda
 * de arreglos no tenía ningún test.
 */
describe("esquema del capitán", () => {
  it("el equipo sembrado guarda a su capitán", async () => {
    const equipo = await crearEquipo({ jugadores: [{ email: "capi@example.com" }, {}] });

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();

    expect(fila?.capitan_jugador_id).toBe(equipo.jugadores[0]!.id);
  });

  it("admite dos jugadores sin móvil en equipos distintos", async () => {
    await crearEquipo({ jugadores: [{ telefono: "" }, {}] });
    await expect(crearEquipo({ jugadores: [{ telefono: "" }, {}] })).resolves.toBeTruthy();
  });

  it("ya no existe la columna owner_user_id", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(equipos)").all<{ name: string }>();
    expect(results.map((c) => c.name)).not.toContain("owner_user_id");
    expect(results.map((c) => c.name)).toContain("capitan_jugador_id");
  });

  it("borrar al capitán deja el equipo sin capitán en vez de fallar", async () => {
    const equipo = await crearEquipo();
    await env.DB.prepare("DELETE FROM jugadores WHERE id = ?1").bind(equipo.capitanId).run();

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();

    expect(fila?.capitan_jugador_id).toBeNull();
  });

  it("una cuenta puede ser capitana de un equipo aunque otro la tuviera antes", async () => {
    // El mismo correo capitanea un equipo en una edición anterior y luego otro
    // en la actual: antes era imposible (el índice UNIQUE de owner_user_id era
    // global, para siempre), y con capitan_jugador_id no hay ese candado.
    const email = "doble@example.com";
    const edicionAnterior = await crearEdicion();
    await crearEquipo({ jugadores: [{ email }, {}], edicionId: edicionAnterior.id });

    await expect(crearEquipo({ jugadores: [{ email }, {}] })).resolves.toBeTruthy();
  });
});

describe("PATCH /api/admin/equipos?accion=ficha: capitanJugadorId", () => {
  const ficha = async (
    admin: Awaited<ReturnType<typeof crearAdmin>>,
    equipoId: number,
    body: Record<string, unknown>
  ) =>
    equiposAdminPatch(
      ctx(
        await peticion(`/api/admin/equipos?id=${equipoId}&accion=ficha`, {
          method: "PATCH",
          user: admin,
          json: body
        }),
        env
      )
    );

  const capitanDe = async (equipoId: number) =>
    (
      await env.DB
        .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
        .bind(equipoId)
        .first<{ capitan_jugador_id: number | null }>()
    )?.capitan_jugador_id ?? null;

  it("nombra capitán a un jugador de la plantilla", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ jugadores: [{}, {}] });

    const respuesta = await ficha(admin, equipo.id, { capitanJugadorId: equipo.jugadores[1]!.id });

    expect(respuesta.status).toBe(200);
    expect(await capitanDe(equipo.id)).toBe(equipo.jugadores[1]!.id);
  });

  it("rechaza con 400 un jugador que no pertenece al equipo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const otro = await crearEquipo();
    const capitanOriginal = await capitanDe(equipo.id);

    const respuesta = await ficha(admin, equipo.id, { capitanJugadorId: otro.jugadores[0]!.id });

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({ campos: { capitanJugadorId: expect.any(String) } });
    expect(await capitanDe(equipo.id)).toBe(capitanOriginal);
  });

  it("rechaza con 400 un jugador sin móvil", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ jugadores: [{ telefono: "" }, {}] });
    const capitanOriginal = await capitanDe(equipo.id);

    const respuesta = await ficha(admin, equipo.id, { capitanJugadorId: equipo.jugadores[0]!.id });

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("móvil y correo") });
    expect(await capitanDe(equipo.id)).toBe(capitanOriginal);
  });

  it("rechaza con 400 un jugador sin correo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ jugadores: [{ email: null }, {}] });
    const capitanOriginal = await capitanDe(equipo.id);

    const respuesta = await ficha(admin, equipo.id, { capitanJugadorId: equipo.jugadores[0]!.id });

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("móvil y correo") });
    expect(await capitanDe(equipo.id)).toBe(capitanOriginal);
  });
});

describe("el capitán en /api/admin/jugadores", () => {
  it("no deja borrar al capitán de un equipo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const respuesta = await jugadoresAdminDelete(
      ctx(await peticion(`/api/admin/jugadores?id=${equipo.capitanId}`, { method: "DELETE", user: admin }), env)
    );

    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: string };
    expect(cuerpo.error).toContain("capitán");
  });

  it("no deja mover al capitán a otro equipo", async () => {
    const admin = await crearAdmin();
    // Nombres explícitos: los que genera crearEquipo() por defecto llevan
    // dígitos (Jugador7, Apellido7) y NOMBRE_PATTERN no los admite, así que
    // reenviarlos tal cual fallaría por un 400 de nombre ajeno a este test.
    const origen = await crearEquipo({
      jugadores: [
        { nombre: "Capi", apellidos: "Trasladado", telefono: "611222333", email: "capi.trasladado@example.com" },
        {}
      ]
    });
    const destino = await crearEquipo();

    const datos = new FormData();
    datos.append("equipoId", String(destino.id));
    datos.append("nombre", origen.jugadores[0]!.nombre);
    datos.append("apellidos", origen.jugadores[0]!.apellidos);
    datos.append("telefono", origen.jugadores[0]!.telefono);
    datos.append("email", origen.jugadores[0]!.email ?? "");

    const respuesta = await jugadoresAdminPatch(
      ctx(
        await peticion(`/api/admin/jugadores?id=${origen.capitanId}`, {
          method: "PATCH",
          user: admin,
          body: datos
        }),
        env
      )
    );

    expect(respuesta.status).toBe(409);
  });

  it("admite crear un jugador sin móvil ni correo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const datos = new FormData();
    datos.append("equipoId", String(equipo.id));
    datos.append("nombre", "Sinsa");
    datos.append("apellidos", "Contacto");
    datos.append("telefono", "");
    datos.append("email", "");

    const respuesta = await jugadoresAdminPost(
      ctx(await peticion("/api/admin/jugadores", { method: "POST", user: admin, body: datos }), env)
    );

    expect(respuesta.status).toBe(201);
  });

  it("sigue exigiendo contacto al jugador que es capitán", async () => {
    const admin = await crearAdmin();
    // Nombres explícitos por la misma razón que en el test anterior: los que
    // genera crearEquipo() por defecto llevan dígitos y NOMBRE_PATTERN los
    // rechaza, lo que daría 400 por el nombre en vez de por el contacto.
    const equipo = await crearEquipo({
      jugadores: [{ nombre: "Capi", apellidos: "Contacto", telefono: "622333444", email: "capi.contacto@example.com" }, {}]
    });

    const datos = new FormData();
    datos.append("equipoId", String(equipo.id));
    datos.append("nombre", equipo.jugadores[0]!.nombre);
    datos.append("apellidos", equipo.jugadores[0]!.apellidos);
    datos.append("telefono", "");
    datos.append("email", "");

    const respuesta = await jugadoresAdminPatch(
      ctx(
        await peticion(`/api/admin/jugadores?id=${equipo.capitanId}`, {
          method: "PATCH",
          user: admin,
          body: datos
        }),
        env
      )
    );

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({
      campos: { telefono: MENSAJE_CAPITAN_CONTACTO, email: MENSAJE_CAPITAN_CONTACTO }
    });
  });

  it("dos jugadores sin móvil en el mismo equipo no chocan entre sí como duplicados", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({
      jugadores: [
        { nombre: "Capi", apellidos: "Duplicado", telefono: "633444555", email: "capi.duplicado@example.com" },
        { nombre: "Suplente", apellidos: "Sinmovil", telefono: "" }
      ]
    });

    const datos = new FormData();
    datos.append("equipoId", String(equipo.id));
    datos.append("nombre", "Otro");
    datos.append("apellidos", "Sinmovil");
    datos.append("telefono", "");
    datos.append("email", "");

    const respuesta = await jugadoresAdminPost(
      ctx(await peticion("/api/admin/jugadores", { method: "POST", user: admin, body: datos }), env)
    );

    expect(respuesta.status).toBe(201);
  });
});
