// GET    /api/partidos — listado público de partidos (lo lee la portada).
// POST   /api/partidos — sorteo, horario, inicio, puntos, cierre y alta manual.
// PATCH  /api/partidos — edita un partido a mano (ronda, equipos, marcador…).
// DELETE /api/partidos — borra un partido, o todos con ?todos=1.
//
// Solo el GET es público. Todo lo que escribe pasa por requireAdmin: antes no
// lo hacía, y cualquiera podía lanzar action:"draw", que borra la tabla entera
// y rehace el cuadro.

import { requireAdmin, jsonAdmin, type AdminEnv } from "../_lib/admin";
import { json } from "../_lib/http";
import { limpiar } from "../_lib/validacion";

type Env = AdminEnv;

const ESTADOS: PartidoEstado[] = ["scheduled", "live", "finished"];

type PartidoEstado = "scheduled" | "live" | "finished";
type Lado = "A" | "B";

interface PartidoRow {
  id: string;
  ronda: string;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  scheduled_at: string | null;
  status: PartidoEstado;
  points_a: number;
  points_b: number;
  sets_a: number;
  sets_b: number;
  set_number: number;
  set_history: string;
  started_at: string | null;
  elapsed_ms: number;
  winner: Lado | null;
}

interface EquipoRow {
  id: number;
  nombre: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const partidos = await listarPartidos(env.DB);
    return json({ partidos }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error leyendo partidos:", err);
    return json({ error: "No se ha podido cargar el calendario de partidos." }, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "La peticion debe ser JSON." }, 400);
  }

  const action = String(body.action || "");

  try {
    if (action === "crear") return await crearPartido(env.DB, body);

    if (action === "draw") {
      const partidosConfirmados = extraerPartidos(body.partidos);
      const equipos = extraerEquipos(body.equipos);
      const partidos =
        partidosConfirmados.length > 0
          ? partidosConfirmados
          : equipos.length > 0
            ? crearEmparejamientos(equipos)
            : await sortearDesdeDb(env.DB);
      await reemplazarPartidos(env.DB, partidos);
      return json({ partidos: await listarPartidos(env.DB) }, 201);
    }

    const partido = await obtenerPartido(env.DB, String(body.id || ""));
    if (!partido) return json({ error: "Partido no encontrado." }, 404);

    if (action === "schedule") {
      const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null;
      await env.DB
        .prepare("UPDATE partidos SET scheduled_at = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(scheduledAt, new Date().toISOString(), partido.id)
        .run();
    } else if (action === "start") {
      await env.DB
        .prepare("UPDATE partidos SET status = 'live', started_at = COALESCE(started_at, ?1), updated_at = ?1 WHERE id = ?2")
        .bind(new Date().toISOString(), partido.id)
        .run();
    } else if (action === "point") {
      const lado = body.team === "B" ? "B" : "A";
      const delta = Number(body.delta) < 0 ? -1 : 1;
      await guardarMarcador(env.DB, aplicarPunto(partido, lado, delta));
    } else if (action === "finish") {
      const winner = ganadorActual(partido) ?? (partido.points_a >= partido.points_b ? "A" : "B");
      const elapsedMs = elapsedOnFinish(partido);
      await env.DB
        .prepare("UPDATE partidos SET status = 'finished', winner = ?1, elapsed_ms = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(winner, elapsedMs, new Date().toISOString(), partido.id)
        .run();
    } else {
      return json({ error: "Accion no soportada." }, 400);
    }

    return json({ partidos: await listarPartidos(env.DB) }, 200);
  } catch (err) {
    console.error("Error gestionando partidos:", err);
    return json({ error: "No se ha podido guardar el partido." }, 500);
  }
};

/**
 * Edición manual de un partido. Todos los campos son opcionales: solo se toca
 * lo que llega. Es la vía de escape cuando el marcador en vivo se desincroniza
 * del papel a pie de pista.
 */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const id = new URL(request.url).searchParams.get("id") || "";
  const partido = await obtenerPartido(env.DB, id);
  if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const campos: Record<string, string> = {};
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  const texto = (clave: string, columna: string, maximo: number) => {
    if (body[clave] === undefined) return;
    const valor = limpiar(body[clave]);
    if (valor.length < 1 || valor.length > maximo) {
      campos[clave] = `Escribe entre 1 y ${maximo} caracteres.`;
      return;
    }
    sets.push(`${columna} = ?${binds.length + 1}`);
    binds.push(valor);
  };
  texto("ronda", "ronda", 40);
  texto("equipoANombre", "equipo_a_nombre", 60);
  texto("equipoBNombre", "equipo_b_nombre", 60);

  const numero = (clave: string, columna: string, min: number, max: number) => {
    if (body[clave] === undefined) return;
    const valor = Number(body[clave]);
    if (!Number.isInteger(valor) || valor < min || valor > max) {
      campos[clave] = `Tiene que estar entre ${min} y ${max}.`;
      return;
    }
    sets.push(`${columna} = ?${binds.length + 1}`);
    binds.push(valor);
  };
  numero("pointsA", "points_a", 0, 99);
  numero("pointsB", "points_b", 0, 99);
  numero("setsA", "sets_a", 0, 3);
  numero("setsB", "sets_b", 0, 3);
  numero("setNumber", "set_number", 1, 5);
  numero("sortOrder", "sort_order", 0, 999);

  if (body.scheduledAt !== undefined) {
    const valor = typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null;
    sets.push(`scheduled_at = ?${binds.length + 1}`);
    binds.push(valor);
  }

  if (body.status !== undefined) {
    const estado = String(body.status) as PartidoEstado;
    if (!ESTADOS.includes(estado)) campos.status = "Estado no válido.";
    else {
      sets.push(`status = ?${binds.length + 1}`);
      binds.push(estado);
      // Un partido que vuelve a "scheduled" no puede conservar ganador ni reloj.
      if (estado === "scheduled") sets.push("winner = NULL", "started_at = NULL", "elapsed_ms = 0");
    }
  }

  if (body.winner !== undefined) {
    const ganador = body.winner === null || body.winner === "" ? null : String(body.winner);
    if (ganador !== null && ganador !== "A" && ganador !== "B") campos.winner = "El ganador debe ser A o B.";
    else {
      sets.push(`winner = ?${binds.length + 1}`);
      binds.push(ganador);
    }
  }

  if (Object.keys(campos).length > 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos }, 400);
  }
  if (sets.length === 0) return jsonAdmin({ error: "No hay cambios que guardar." }, 400);

  sets.push(`updated_at = ?${binds.length + 1}`);
  binds.push(new Date().toISOString());
  binds.push(partido.id);

  try {
    await env.DB.prepare(`UPDATE partidos SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
    return jsonAdmin({ ok: true, partidos: await listarPartidos(env.DB) });
  } catch (err) {
    console.error("Error editando un partido:", err);
    return jsonAdmin({ error: "No se ha podido guardar el partido." }, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  try {
    if (url.searchParams.get("todos") === "1") {
      await env.DB.prepare("DELETE FROM partidos").run();
      return jsonAdmin({ ok: true, partidos: [] });
    }

    const id = url.searchParams.get("id") || "";
    const partido = await obtenerPartido(env.DB, id);
    if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);

    await env.DB.prepare("DELETE FROM partidos WHERE id = ?1").bind(partido.id).run();
    return jsonAdmin({ ok: true, partidos: await listarPartidos(env.DB) });
  } catch (err) {
    console.error("Error borrando un partido:", err);
    return jsonAdmin({ error: "No se ha podido borrar el partido." }, 500);
  }
};

/** Alta manual, para cruces que el sorteo no genera (repesca, amistoso…). */
async function crearPartido(db: D1Database, body: Record<string, unknown>): Promise<Response> {
  const campos: Record<string, string> = {};
  const ronda = limpiar(body.ronda) || "Sorteo";
  const equipoA = limpiar(body.equipoANombre);
  const equipoB = limpiar(body.equipoBNombre);

  if (equipoA.length < 1 || equipoA.length > 60) campos.equipoANombre = "Indica el equipo A.";
  if (equipoB.length < 1 || equipoB.length > 60) campos.equipoBNombre = "Indica el equipo B.";
  if (Object.keys(campos).length > 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos }, 400);
  }

  const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null;
  const idA = Number(body.equipoAId);
  const idB = Number(body.equipoBId);

  const orden = await db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS siguiente FROM partidos")
    .first<{ siguiente: number }>();

  await db
    .prepare(
      `INSERT INTO partidos (id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre,
         scheduled_at, status, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'scheduled', ?8)`
    )
    .bind(
      crypto.randomUUID(),
      ronda,
      Number.isInteger(idA) && idA > 0 ? idA : null,
      Number.isInteger(idB) && idB > 0 ? idB : null,
      equipoA,
      equipoB,
      scheduledAt,
      orden?.siguiente ?? 0
    )
    .run();

  return jsonAdmin({ ok: true, partidos: await listarPartidos(db) }, 201);
}

async function listarPartidos(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT * FROM partidos
       ORDER BY COALESCE(scheduled_at, '9999-12-31T23:59'), sort_order ASC, created_at ASC`
    )
    .all<PartidoRow>();
  return results.map(mapearPartido);
}

async function obtenerPartido(db: D1Database, id: string) {
  if (!id) return null;
  return await db.prepare("SELECT * FROM partidos WHERE id = ?1").bind(id).first<PartidoRow>();
}

async function sortearDesdeDb(db: D1Database) {
  const { results } = await db
    .prepare("SELECT id, nombre FROM equipos ORDER BY created_at ASC, id ASC")
    .all<EquipoRow>();
  return crearEmparejamientos(results.map((equipo) => ({ id: equipo.id, name: equipo.nombre })));
}

async function reemplazarPartidos(db: D1Database, partidos: ReturnType<typeof crearEmparejamientos>) {
  const now = new Date().toISOString();
  const statements = [
    db.prepare("DELETE FROM partidos"),
    ...partidos.map((partido, index) =>
      db
        .prepare(
          `INSERT INTO partidos (
             id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre, scheduled_at, sort_order, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`
        )
        .bind(
          partido.id,
          partido.ronda,
          partido.teamA.id,
          partido.teamB.id,
          partido.teamA.name,
          partido.teamB.name,
          partido.scheduledAt ?? null,
          index,
          now
        )
    )
  ];
  await db.batch(statements);
}

function crearEmparejamientos(equipos: Array<{ id: number | null; name: string }>) {
  const mezclados = [...equipos].sort(() => crypto.getRandomValues(new Uint32Array(1))[0] - 2147483648);
  const partidos = [];
  for (let i = 0; i + 1 < mezclados.length; i += 2) {
    partidos.push({
      id: crypto.randomUUID(),
      ronda: "Sorteo",
      scheduledAt: null,
      teamA: mezclados[i],
      teamB: mezclados[i + 1]
    });
  }
  return partidos;
}

function aplicarPunto(partido: PartidoRow, lado: Lado, delta: number): PartidoRow {
  const next = { ...partido };
  if (next.status === "finished") return next;
  if (lado === "A") next.points_a = Math.max(0, next.points_a + delta);
  if (lado === "B") next.points_b = Math.max(0, next.points_b + delta);

  if (delta > 0) {
    const ganadorSet = ganadorDelSet(next.points_a, next.points_b, next.set_number);
    if (ganadorSet) {
      const history = parseHistory(next.set_history);
      history.push({ a: next.points_a, b: next.points_b });
      next.set_history = JSON.stringify(history);
      if (ganadorSet === "A") next.sets_a += 1;
      if (ganadorSet === "B") next.sets_b += 1;
      next.points_a = 0;
      next.points_b = 0;
      next.set_number += 1;
      const ganadorPartido = ganadorActual(next);
      if (ganadorPartido) {
        next.elapsed_ms = elapsedOnFinish(next);
        next.status = "finished";
        next.winner = ganadorPartido;
      }
    }
  }
  return next;
}

async function guardarMarcador(db: D1Database, partido: PartidoRow) {
  await db
    .prepare(
      `UPDATE partidos SET
       status = ?1, points_a = ?2, points_b = ?3, sets_a = ?4, sets_b = ?5,
       set_number = ?6, set_history = ?7, winner = ?8, updated_at = ?9
       WHERE id = ?10`
    )
    .bind(
      partido.status,
      partido.points_a,
      partido.points_b,
      partido.sets_a,
      partido.sets_b,
      partido.set_number,
      partido.set_history,
      partido.winner,
      new Date().toISOString(),
      partido.id
    )
    .run();
}

function ganadorDelSet(a: number, b: number, setNumber: number): Lado | null {
  const objetivo = setNumber >= 3 ? 15 : 21;
  if (a >= objetivo && a - b >= 2) return "A";
  if (b >= objetivo && b - a >= 2) return "B";
  return null;
}

function ganadorActual(partido: Pick<PartidoRow, "sets_a" | "sets_b">): Lado | null {
  if (partido.sets_a >= 2) return "A";
  if (partido.sets_b >= 2) return "B";
  return null;
}

function elapsedOnFinish(partido: Pick<PartidoRow, "elapsed_ms" | "started_at" | "status">) {
  const base = Number(partido.elapsed_ms) || 0;
  if (partido.status !== "live" || !partido.started_at) return base;
  return base + Math.max(0, Date.now() - new Date(partido.started_at).getTime());
}

function parseHistory(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapearPartido(partido: PartidoRow) {
  return {
    id: partido.id,
    ronda: partido.ronda,
    scheduledAt: partido.scheduled_at,
    status: partido.status,
    setNumber: partido.set_number,
    points: { A: partido.points_a, B: partido.points_b },
    sets: { A: partido.sets_a, B: partido.sets_b },
    history: parseHistory(partido.set_history),
    startedAt: partido.started_at,
    elapsedMs: partido.elapsed_ms,
    winner: partido.winner,
    teams: {
      A: { id: partido.equipo_a_id, name: partido.equipo_a_nombre },
      B: { id: partido.equipo_b_id, name: partido.equipo_b_nombre }
    }
  };
}

function extraerEquipos(value: unknown): Array<{ id: number | null; name: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((equipo) => {
      if (!equipo || typeof equipo !== "object") return null;
      const raw = equipo as Record<string, unknown>;
      const name = String(raw.name || raw.nombre || "").trim();
      if (!name) return null;
      return { id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : null, name };
    })
    .filter((equipo): equipo is { id: number | null; name: string } => Boolean(equipo));
}

function extraerPartidos(value: unknown): ReturnType<typeof crearEmparejamientos> {
  if (!Array.isArray(value)) return [];
  return value
    .map((partido) => {
      if (!partido || typeof partido !== "object") return null;
      const raw = partido as Record<string, unknown>;
      const teams = raw.teams && typeof raw.teams === "object" ? (raw.teams as Record<string, unknown>) : {};
      const teamA = extraerEquipoDePartido(teams.A);
      const teamB = extraerEquipoDePartido(teams.B);
      if (!teamA || !teamB) return null;
      return {
        id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
        ronda: typeof raw.ronda === "string" && raw.ronda ? raw.ronda : "Sorteo",
        scheduledAt: typeof raw.scheduledAt === "string" && raw.scheduledAt ? raw.scheduledAt : null,
        teamA,
        teamB
      };
    })
    .filter((partido): partido is ReturnType<typeof crearEmparejamientos>[number] => Boolean(partido));
}

function extraerEquipoDePartido(value: unknown): { id: number | null; name: string } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  return { id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : null, name };
}
