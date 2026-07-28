import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  onRequestDelete,
  onRequestGet,
  onRequestPatch,
  onRequestPost
} from "../../functions/api/partidos";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearAdmin, crearUsuario, peticion } from "../helpers/db";
import type { UsuarioSesion } from "../../functions/_lib/auth";

/*
 * /api/partidos es el único endpoint fuera de functions/api/admin/: la portada
 * lee el cuadro sin sesión. Solo el GET es público; antes tampoco lo estaba el
 * POST y cualquiera podía lanzar action:"draw", que borra la tabla entera.
 */

interface Partido {
  id: string;
  ronda: string;
  status: string;
  points: { A: number; B: number };
  sets: { A: number; B: number };
  teams: { A: { name: string }; B: { name: string } };
}

const listar = async (): Promise<Partido[]> => {
  const respuesta = await onRequestGet(ctx(await peticion("/api/partidos"), env));
  return ((await respuesta.json()) as { partidos: Partido[] }).partidos;
};

/** Crea un partido como administrador y devuelve el listado resultante. */
async function crearPartido(admin: UsuarioSesion, extra: Record<string, unknown> = {}) {
  const request = await peticion("/api/partidos", {
    method: "POST",
    user: admin,
    json: { action: "crear", equipoANombre: "Delfines", equipoBNombre: "Gaviotas", ...extra }
  });
  return onRequestPost(ctx(request, env));
}

describe("GET /api/partidos es público", () => {
  it("responde 200 sin ninguna sesión", async () => {
    const respuesta = await onRequestGet(ctx(await peticion("/api/partidos"), env));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ partidos: [] });
  });

  it("no se cachea", async () => {
    const respuesta = await onRequestGet(ctx(await peticion("/api/partidos"), env));
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("las escrituras exigen administrador", () => {
  const cuerpo = { action: "crear", equipoANombre: "A", equipoBNombre: "B" };

  it("POST sin sesión responde 401", async () => {
    const respuesta = await onRequestPost(ctx(await peticion("/api/partidos", { method: "POST", json: cuerpo }), env));
    expect(respuesta.status).toBe(401);
  });

  it("POST con sesión sin permiso responde 403", async () => {
    const user = await crearUsuario();
    const respuesta = await onRequestPost(
      ctx(await peticion("/api/partidos", { method: "POST", user, json: cuerpo }), env)
    );
    expect(respuesta.status).toBe(403);
  });

  it("PATCH y DELETE también quedan cerrados a quien no es admin", async () => {
    const user = await crearUsuario();

    const patch = await onRequestPatch(
      ctx(await peticion("/api/partidos?id=x", { method: "PATCH", user, json: {} }), env)
    );
    expect(patch.status).toBe(403);

    const del = await onRequestDelete(ctx(await peticion("/api/partidos?id=x", { method: "DELETE", user }), env));
    expect(del.status).toBe(403);
  });

  // El sorteo borra y rehace la tabla entera: es lo más destructivo del endpoint.
  it("un anónimo no puede lanzar el sorteo", async () => {
    const respuesta = await onRequestPost(
      ctx(await peticion("/api/partidos", { method: "POST", json: { action: "draw" } }), env)
    );
    expect(respuesta.status).toBe(401);
    expect(await listar()).toHaveLength(0);
  });
});

describe("alta y borrado de partidos como admin", () => {
  it("crea un partido y aparece en el listado público", async () => {
    const admin = await crearAdmin();
    const respuesta = await crearPartido(admin);

    expect(respuesta.status).toBe(201);
    const partidos = await listar();
    expect(partidos).toHaveLength(1);
    expect(partidos[0]!.teams.A.name).toBe("Delfines");
    expect(partidos[0]!.teams.B.name).toBe("Gaviotas");
    expect(partidos[0]!.status).toBe("scheduled");
  });

  it("rechaza un alta sin nombres de equipo con 400 y errores por campo", async () => {
    const admin = await crearAdmin();
    const request = await peticion("/api/partidos", {
      method: "POST",
      user: admin,
      json: { action: "crear", equipoANombre: "", equipoBNombre: "" }
    });

    const respuesta = await onRequestPost(ctx(request, env));
    expect(respuesta.status).toBe(400);
    const cuerpo = (await respuesta.json()) as { campos: Record<string, string> };
    expect(cuerpo.campos.equipoANombre).toBeTruthy();
    expect(cuerpo.campos.equipoBNombre).toBeTruthy();
  });

  it("rechaza un cuerpo que no es JSON", async () => {
    const admin = await crearAdmin();
    const request = new Request("https://copa.test/api/partidos", {
      method: "POST",
      headers: { Cookie: await cookieSesion(admin), "Content-Type": "application/json" },
      body: "esto no es json"
    });

    expect((await onRequestPost(ctx(request, env))).status).toBe(400);
  });

  it("rechaza una acción no soportada", async () => {
    const admin = await crearAdmin();
    await crearPartido(admin);
    const [partido] = await listar();

    const request = await peticion("/api/partidos", {
      method: "POST",
      user: admin,
      json: { action: "teletransportar", id: partido!.id }
    });
    expect((await onRequestPost(ctx(request, env))).status).toBe(400);
  });

  it("responde 404 a una acción sobre un partido inexistente", async () => {
    const admin = await crearAdmin();
    const request = await peticion("/api/partidos", {
      method: "POST",
      user: admin,
      json: { action: "start", id: "no-existe" }
    });
    expect((await onRequestPost(ctx(request, env))).status).toBe(404);
  });

  it("borra un partido concreto", async () => {
    const admin = await crearAdmin();
    await crearPartido(admin);
    const [partido] = await listar();

    const request = await peticion(`/api/partidos?id=${partido!.id}`, { method: "DELETE", user: admin });
    expect((await onRequestDelete(ctx(request, env))).status).toBe(200);
    expect(await listar()).toHaveLength(0);
  });
});

describe("marcador en vivo", () => {
  it("start pone el partido en juego y point suma al marcador", async () => {
    const admin = await crearAdmin();
    await crearPartido(admin);
    const [creado] = await listar();

    const accion = async (json: Record<string, unknown>) =>
      onRequestPost(ctx(await peticion("/api/partidos", { method: "POST", user: admin, json }), env));

    await accion({ action: "start", id: creado!.id });
    expect((await listar())[0]!.status).toBe("live");

    await accion({ action: "point", id: creado!.id, team: "A", delta: 1 });
    await accion({ action: "point", id: creado!.id, team: "B", delta: 1 });
    await accion({ action: "point", id: creado!.id, team: "A", delta: 1 });

    const enJuego = (await listar())[0]!;
    expect(enJuego.points).toEqual({ A: 2, B: 1 });
  });

  it("finish cierra el partido y le asigna ganador", async () => {
    const admin = await crearAdmin();
    await crearPartido(admin);
    const [creado] = await listar();

    const accion = async (json: Record<string, unknown>) =>
      onRequestPost(ctx(await peticion("/api/partidos", { method: "POST", user: admin, json }), env));

    await accion({ action: "start", id: creado!.id });
    await accion({ action: "point", id: creado!.id, team: "A", delta: 1 });
    await accion({ action: "finish", id: creado!.id });

    const terminado = (await listar())[0]!;
    expect(terminado.status).toBe("finished");
  });
});
