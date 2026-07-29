import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  onRequestDelete,
  onRequestGet,
  onRequestPatch,
  onRequestPost
} from "../../functions/api/partidos";
import { ctx } from "../helpers/ctx";
import {
  cookieSesion,
  crearAdmin,
  crearEdicion,
  crearEquipo,
  crearEstadistica,
  crearPartido as sembrarPartido,
  crearUsuario,
  peticion
} from "../helpers/db";
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

/*
 * El cuadro es de la edición que se está jugando. Antes no lo era: el listado,
 * el sorteo y los dos borrados iban a por la tabla entera, así que rehacer el
 * cuadro de un año borraba los partidos de todos los anteriores y, por el
 * ON DELETE CASCADE de estadisticas.partido_id, se llevaba por delante el
 * histórico estadístico de quien ya había jugado.
 */
describe("el cuadro está acotado a la edición actual", () => {
  /**
   * Una edición pasada completa: dos equipos, su partido y las estadísticas
   * colgando de él. Son **dos** equipos a propósito: con uno solo, un sorteo sin
   * filtrar vería tres equipos y descartaría uno al azar, así que el test pasaría
   * o fallaría según la moneda. Con dos, sin filtrar salen dos cruces y con
   * filtro sale exactamente uno.
   */
  async function sembrarHistorico() {
    const edicion = await crearEdicion({ anio: 2025 });
    const equipos = [
      await crearEquipo({ nombre: "Veteranos 2025", edicionId: edicion.id }),
      await crearEquipo({ nombre: "Nostálgicos 2025", edicionId: edicion.id })
    ];
    const partidoId = await sembrarPartido({ ronda: "Final 2025", edicionId: edicion.id });
    await crearEstadistica(equipos[0]!.jugadores[0]!.id, partidoId, { puntos: 12, aces: 3 });
    return { edicion, equipos, partidoId };
  }

  const cuantosPartidos = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM partidos").first<{ n: number }>())!.n;
  const cuantasEstadisticas = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM estadisticas").first<{ n: number }>())!.n;

  it("el listado público no mezcla ediciones", async () => {
    await sembrarHistorico();
    const admin = await crearAdmin();
    await crearPartido(admin);

    const partidos = await listar();
    expect(partidos).toHaveLength(1);
    expect(partidos[0]!.teams.A.name).toBe("Delfines");
  });

  it("vaciar el cuadro no toca los partidos de otra edición ni sus estadísticas", async () => {
    const { partidoId } = await sembrarHistorico();
    const admin = await crearAdmin();
    await crearPartido(admin);
    expect(await cuantosPartidos()).toBe(2);

    const request = await peticion("/api/partidos?todos=1", { method: "DELETE", user: admin });
    expect((await onRequestDelete(ctx(request, env))).status).toBe(200);

    expect(await listar()).toHaveLength(0);
    expect(await cuantosPartidos()).toBe(1);
    expect(await cuantasEstadisticas()).toBe(1);
    const superviviente = await env.DB
      .prepare("SELECT id FROM partidos")
      .first<{ id: string }>();
    expect(superviviente!.id).toBe(partidoId);
  });

  it("el sorteo no arrasa con las ediciones anteriores", async () => {
    const { partidoId } = await sembrarHistorico();
    const admin = await crearAdmin();
    await crearEquipo({ nombre: "Delfines" });
    await crearEquipo({ nombre: "Gaviotas" });

    const request = await peticion("/api/partidos", {
      method: "POST",
      user: admin,
      json: { action: "draw" }
    });
    expect((await onRequestPost(ctx(request, env))).status).toBe(201);

    expect(await cuantasEstadisticas()).toBe(1);
    const ids = await env.DB.prepare("SELECT id FROM partidos").all<{ id: string }>();
    expect(ids.results.map((fila) => fila.id)).toContain(partidoId);
  });

  it("el sorteo desde la base solo empareja equipos de la edición actual", async () => {
    // El histórico aporta un equipo más: si el sorteo lo cogiera, saldrían dos
    // cruces en vez de uno, y uno de ellos con gente que ya no juega.
    await sembrarHistorico();
    const admin = await crearAdmin();
    await crearEquipo({ nombre: "Delfines" });
    await crearEquipo({ nombre: "Gaviotas" });

    const request = await peticion("/api/partidos", {
      method: "POST",
      user: admin,
      json: { action: "draw" }
    });
    await onRequestPost(ctx(request, env));

    const partidos = await listar();
    expect(partidos).toHaveLength(1);
    const nombres = [partidos[0]!.teams.A.name, partidos[0]!.teams.B.name].sort();
    expect(nombres).toEqual(["Delfines", "Gaviotas"]);
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
