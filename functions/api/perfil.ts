// GET   /api/perfil — paquete completo de la ficha del usuario logueado:
//   datos de cuenta, atributos manuales + avatar, edicion actual, historial de
//   equipos por edicion, palmares agregado y camisetas reservadas.
// PATCH /api/perfil — actualiza los atributos manuales (apodo, dorsal, posicion,
//   mano, lema, autovaloracion). El avatar se gestiona aparte en /api/avatar.

import { publicUser, requireUser } from "../_lib/auth";
import { claveAvatar } from "../_lib/avatar";
import { edicionActual } from "../_lib/ediciones";
import { json } from "../_lib/http";
import { primerApellido } from "../_lib/nombres";
import { normalizarEmail } from "../_lib/validacion";

interface Env {
  DB: D1Database;
  FOTOS?: R2Bucket;
  SESSION_SECRET: string;
}

// Conjuntos cerrados. Deben coincidir con los del cliente (perfil.js).
const POSICIONES = ["Bloqueo", "Defensa", "Todoterreno"];
const MANOS = ["Diestro", "Zurdo", "Ambidiestro"];
const ATRIBUTOS = ["saque", "remate", "bloqueo", "defensa", "recepcion", "colocacion"];

interface PerfilRow {
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
  atributos: string | null;
}

interface MembresiaRow {
  equipo_id: number;
  equipo_nombre: string;
  posicion_final: number | null;
  edicion_id: number | null;
  anio: number | null;
  edicion_nombre: string | null;
  estado: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const emailNormalizado = normalizarEmail(user.email);
    const edicion = await edicionActual(env.DB);

    const [perfilRow, tieneAvatar, membresias, camisetas] = await Promise.all([
      env.DB
        .prepare("SELECT apodo, dorsal, posicion, mano, lema, atributos FROM perfiles WHERE usuario_id = ?1")
        .bind(user.id)
        .first<PerfilRow>(),
      claveAvatar(env.DB, env.FOTOS, user).then((k) => k != null),
      cargarMembresias(env.DB, emailNormalizado),
      cargarCamisetas(env.DB, user.id)
    ]);

    const historial = await construirHistorial(env.DB, membresias, emailNormalizado, edicion?.id ?? null);

    return json(
      {
        user: publicUser(user),
        edicionActual: edicion ? { anio: edicion.anio, nombre: edicion.nombre, estado: edicion.estado } : null,
        perfil: {
          apodo: perfilRow?.apodo ?? null,
          dorsal: perfilRow?.dorsal ?? null,
          posicion: perfilRow?.posicion ?? null,
          mano: perfilRow?.mano ?? null,
          lema: perfilRow?.lema ?? null,
          atributos: parseAtributos(perfilRow?.atributos ?? null),
          tieneAvatar
        },
        historial,
        palmares: calcularPalmares(historial),
        camisetas
      },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (err) {
    console.error("Error leyendo el perfil:", err);
    return json({ error: "No se ha podido cargar tu ficha." }, 500);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Los datos de la ficha no son válidos." }, 400);
  }

  const resultado = validarPerfil(body);
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  const p = resultado.perfil;
  try {
    await env.DB
      .prepare(
        `INSERT INTO perfiles (usuario_id, apodo, dorsal, posicion, mano, lema, atributos, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
         ON CONFLICT(usuario_id) DO UPDATE SET
           apodo = ?2, dorsal = ?3, posicion = ?4, mano = ?5, lema = ?6, atributos = ?7,
           updated_at = datetime('now')`
      )
      .bind(user.id, p.apodo, p.dorsal, p.posicion, p.mano, p.lema, JSON.stringify(p.atributos))
      .run();

    return json(
      {
        ok: true,
        perfil: { apodo: p.apodo, dorsal: p.dorsal, posicion: p.posicion, mano: p.mano, lema: p.lema, atributos: p.atributos }
      },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (err) {
    console.error("Error guardando el perfil:", err);
    return json({ error: "No se ha podido guardar tu ficha." }, 500);
  }
};

async function cargarMembresias(db: D1Database, emailNormalizado: string): Promise<MembresiaRow[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id AS equipo_id, e.nombre AS equipo_nombre, e.posicion_final AS posicion_final,
              ed.id AS edicion_id, ed.anio AS anio, ed.nombre AS edicion_nombre, ed.estado AS estado
       FROM jugadores j
       JOIN equipos e ON e.id = j.equipo_id
       LEFT JOIN ediciones ed ON ed.id = e.edicion_id
       WHERE j.email_normalizado = ?1
       ORDER BY ed.anio DESC, e.id DESC`
    )
    .bind(emailNormalizado)
    .all<MembresiaRow>();
  return results;
}

async function construirHistorial(
  db: D1Database,
  membresias: MembresiaRow[],
  emailNormalizado: string,
  edicionActualId: number | null
) {
  const companerosPorEquipo = await cargarCompaneros(
    db,
    membresias.map((m) => m.equipo_id),
    emailNormalizado
  );

  return membresias.map((m) => ({
    edicionId: m.edicion_id,
    anio: m.anio,
    nombreEdicion: m.edicion_nombre,
    estado: m.estado,
    equipoNombre: m.equipo_nombre,
    posicionFinal: m.posicion_final,
    esActual: edicionActualId != null && m.edicion_id === edicionActualId,
    companeros: companerosPorEquipo.get(m.equipo_id) ?? []
  }));
}

async function cargarCompaneros(
  db: D1Database,
  equipoIds: number[],
  emailNormalizado: string
): Promise<Map<number, { nombre: string; apellido: string }[]>> {
  const mapa = new Map<number, { nombre: string; apellido: string }[]>();
  if (equipoIds.length === 0) return mapa;

  const placeholders = equipoIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT equipo_id, nombre, apellidos, email_normalizado, orden
       FROM jugadores
       WHERE equipo_id IN (${placeholders})
       ORDER BY orden ASC, id ASC`
    )
    .bind(...equipoIds)
    .all<{ equipo_id: number; nombre: string; apellidos: string; email_normalizado: string | null; orden: number }>();

  for (const fila of results) {
    if (fila.email_normalizado === emailNormalizado) continue; // no incluir al propio usuario
    const lista = mapa.get(fila.equipo_id) ?? [];
    lista.push({ nombre: fila.nombre, apellido: primerApellido(fila.apellidos ?? "") });
    mapa.set(fila.equipo_id, lista);
  }
  return mapa;
}

async function cargarCamisetas(db: D1Database, userId: number) {
  const { results } = await db
    .prepare(
      `SELECT cr.id, cr.talla, cr.cantidad, cr.notas, cr.created_at, ed.anio
       FROM camisetas_reservas cr
       LEFT JOIN ediciones ed ON ed.id = cr.edicion_id
       WHERE cr.owner_user_id = ?1
       ORDER BY cr.created_at DESC, cr.id DESC`
    )
    .bind(userId)
    .all<{ id: number; talla: string; cantidad: number; notas: string | null; created_at: string; anio: number | null }>();

  return results.map((r) => ({
    id: r.id,
    talla: r.talla,
    cantidad: r.cantidad,
    notas: r.notas,
    anio: r.anio,
    createdAt: r.created_at
  }));
}

type HistorialEntrada = Awaited<ReturnType<typeof construirHistorial>>[number];

function calcularPalmares(historial: HistorialEntrada[]) {
  const ediciones = new Set<number>();
  const companeros = new Set<string>();
  const podios = { oro: 0, plata: 0, bronce: 0 };
  let mejorPuesto: number | null = null;

  for (const h of historial) {
    if (h.edicionId != null) ediciones.add(h.edicionId);
    if (h.posicionFinal === 1) podios.oro += 1;
    else if (h.posicionFinal === 2) podios.plata += 1;
    else if (h.posicionFinal === 3) podios.bronce += 1;
    if (h.posicionFinal != null && (mejorPuesto == null || h.posicionFinal < mejorPuesto)) {
      mejorPuesto = h.posicionFinal;
    }
    for (const c of h.companeros) {
      companeros.add(`${c.nombre}|${c.apellido}`.toLowerCase());
    }
  }

  return {
    edicionesJugadas: ediciones.size,
    podios,
    mejorPuesto,
    totalEquipos: historial.length,
    totalCompaneros: companeros.size
  };
}

function parseAtributos(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const limpio: Record<string, number> = {};
    for (const key of ATRIBUTOS) {
      const valor = obj[key];
      if (typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= 5) {
        limpio[key] = valor;
      }
    }
    return limpio;
  } catch {
    return {};
  }
}

interface PerfilValidado {
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
  atributos: Record<string, number>;
}

function validarPerfil(raw: unknown): { perfil: PerfilValidado } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const apodo = texto(body.apodo);
  if (apodo && apodo.length > 40) campos.apodo = "El apodo no puede pasar de 40 caracteres.";

  const lema = texto(body.lema);
  if (lema && lema.length > 80) campos.lema = "El lema no puede pasar de 80 caracteres.";

  let dorsal: number | null = null;
  if (body.dorsal !== undefined && body.dorsal !== null && body.dorsal !== "") {
    const n = Number(body.dorsal);
    if (!Number.isInteger(n) || n < 0 || n > 99) campos.dorsal = "El dorsal debe estar entre 0 y 99.";
    else dorsal = n;
  }

  let posicion: string | null = null;
  if (body.posicion !== undefined && body.posicion !== null && body.posicion !== "") {
    if (!POSICIONES.includes(String(body.posicion))) campos.posicion = "Elige una posición válida.";
    else posicion = String(body.posicion);
  }

  let mano: string | null = null;
  if (body.mano !== undefined && body.mano !== null && body.mano !== "") {
    if (!MANOS.includes(String(body.mano))) campos.mano = "Elige una opción válida.";
    else mano = String(body.mano);
  }

  const atributos: Record<string, number> = {};
  if (body.atributos !== undefined && body.atributos !== null) {
    if (typeof body.atributos !== "object") {
      campos.atributos = "Los atributos no son válidos.";
    } else {
      const src = body.atributos as Record<string, unknown>;
      for (const key of ATRIBUTOS) {
        const valor = src[key];
        if (valor === undefined || valor === null || valor === "") continue;
        const n = Number(valor);
        if (!Number.isInteger(n) || n < 1 || n > 5) campos[`atributos.${key}`] = "Puntúa del 1 al 5.";
        else atributos[key] = n;
      }
    }
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { perfil: { apodo: apodo || null, dorsal, posicion, mano, lema: lema || null, atributos } };
}

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
