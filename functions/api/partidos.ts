// GET  /api/partidos - listado publico de partidos.
// POST /api/partidos - sorteo, horario, inicio, puntos y cierre.

import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
}

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
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "La peticion debe ser JSON." }, 400);
  }

  const action = String(body.action || "");

  try {
    if (action === "draw") {
      const equipos = extraerEquipos(body.equipos);
      const partidos = equipos.length > 0 ? crearEmparejamientos(equipos) : await sortearDesdeDb(env.DB);
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
             id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre, sort_order, created_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
        )
        .bind(
          partido.id,
          partido.ronda,
          partido.teamA.id,
          partido.teamB.id,
          partido.teamA.name,
          partido.teamB.name,
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
    partidos.push({ id: crypto.randomUUID(), ronda: "Sorteo", teamA: mezclados[i], teamB: mezclados[i + 1] });
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
