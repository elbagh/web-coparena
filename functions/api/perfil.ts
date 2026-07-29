// GET   /api/perfil — paquete completo de la ficha del usuario logueado:
//   datos de cuenta, ficha + avatar, edicion actual, historial de equipos por
//   edicion, palmares agregado, estadisticas y camisetas reservadas.
// PATCH /api/perfil — actualiza los campos propios de la ficha (apodo, dorsal,
//   posicion, mano, lema). El avatar se gestiona aparte en /api/avatar.
//
// La ficha es del **jugador de una edicion** (columnas de `jugadores` desde la
// 0023), no de la cuenta de Google. Dos consecuencias que se ven aqui:
//
//   - se escribe solo sobre la fila vigente, nunca sobre las de años pasados:
//     cambiar de apodo hoy no debe reescribir el cromo de 2025;
//   - quien no esta en ninguna plantilla no tiene donde escribir, y eso se
//     responde con 409 (ver mas abajo).
//
// Los atributos 1-99 y el nivel del cromo son de solo lectura aqui: los pone la
// organizacion desde el panel, no su dueño.

import { publicUser, requireUser, requireUserContext } from "../_lib/auth";
import { claveAvatar } from "../_lib/avatar";
import { edicionActual } from "../_lib/ediciones";
import { mapEstadisticas, sumarTotales, totalesPorJugador } from "../_lib/estadisticas";
import { json } from "../_lib/http";
import { atributosPorJugador, mediaAtributos, sentenciaFichaJugador, validarPerfil } from "../_lib/perfil";
import { normalizarEmail } from "../_lib/validacion";

interface Env {
  DB: D1Database;
  FOTOS?: R2Bucket;
  SESSION_SECRET: string;
}

interface MembresiaRow {
  jugador_id: number;
  equipo_id: number;
  equipo_nombre: string;
  posicion_final: number | null;
  edicion_id: number | null;
  anio: number | null;
  edicion_nombre: string | null;
  estado: string | null;
  jugador_nombre: string;
  jugador_apellidos: string;
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
  nivel: string | null;
}

/**
 * La inscripcion sobre la que se lee y se escribe la ficha: la de la edicion en
 * juego y, si no juega esta, la mas reciente. Es la misma regla para leer y para
 * escribir, para que nadie edite una ficha distinta de la que esta viendo.
 */
function membresiaVigente(membresias: MembresiaRow[], edicionId: number | null): MembresiaRow | undefined {
  return membresias.find((m) => m.edicion_id === edicionId) ?? membresias[0];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const sesion = await requireUserContext(request, env);
  if (sesion instanceof Response) return sesion;
  const { user, impersonando } = sesion;

  try {
    const emailNormalizado = normalizarEmail(user.email);
    const edicion = await edicionActual(env.DB);

    const [tieneAvatar, membresias, camisetas] = await Promise.all([
      // Solo se quiere saber si hay foto: en modo «ver como» no se siembra.
      claveAvatar(env.DB, env.FOTOS, user, { sembrar: !impersonando }).then((k) => k != null),
      cargarMembresias(env.DB, emailNormalizado),
      cargarCamisetas(env.DB, user.id)
    ]);

    const historial = await construirHistorial(env.DB, membresias, emailNormalizado, edicion?.id ?? null);
    const propio = membresias[0];
    const jugador = propio ? { id: propio.jugador_id, nombre: propio.jugador_nombre, apellidos: propio.jugador_apellidos } : null;

    // Ficha y atributos son los del jugador de la edición en juego; si no juega
    // esta edición, los de su inscripción más reciente.
    const jugadorVigente = membresiaVigente(membresias, edicion?.id ?? null);
    const atributos = jugadorVigente
      ? (await atributosPorJugador(env.DB, [jugadorVigente.jugador_id])).get(jugadorVigente.jugador_id) ?? {}
      : {};

    return json(
      {
        user: publicUser(user),
        jugador,
        edicionActual: edicion ? { anio: edicion.anio, nombre: edicion.nombre, estado: edicion.estado } : null,
        perfil: {
          apodo: jugadorVigente?.apodo ?? null,
          dorsal: jugadorVigente?.dorsal ?? null,
          posicion: jugadorVigente?.posicion ?? null,
          mano: jugadorVigente?.mano ?? null,
          lema: jugadorVigente?.lema ?? null,
          // El nivel se enseña, no se edita: lo pone la organización.
          nivel: jugadorVigente?.nivel ?? null,
          atributos,
          media: mediaAtributos(atributos),
          tieneAvatar
        },
        historial,
        palmares: calcularPalmares(historial),
        carrera: sumarTotales(historial.map((h) => h.estadisticas)),
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
    const edicion = await edicionActual(env.DB);
    const membresias = await cargarMembresias(env.DB, normalizarEmail(user.email));
    const vigente = membresiaVigente(membresias, edicion?.id ?? null);

    /*
     * Sin inscripción no hay dónde escribir. Antes siempre la había, porque la
     * ficha colgaba de la cuenta; ahora es una propiedad del jugador de una
     * edición y una cuenta puede no tener ninguna.
     *
     * 409 y no otra cosa: la sesión es válida (no es 401/403), el cuerpo está
     * bien formado (400 mandaría a revisar campos correctos) y la cuenta existe
     * (404 mentiría). Es un conflicto de estado. Aun así debería ser el
     * respaldo y no el camino normal: el GET ya devuelve `jugador: null` y
     * «Mi zona» deshabilita el formulario con eso.
     */
    if (!vigente) {
      return json(
        {
          error:
            "Todavía no estás en ninguna plantilla. Cuando tu correo aparezca en una inscripción podrás personalizar tu cromo."
        },
        409,
        { "Cache-Control": "no-store" }
      );
    }

    await sentenciaFichaJugador(env.DB, vigente.jugador_id, p).run();

    return json(
      {
        ok: true,
        perfil: { apodo: p.apodo, dorsal: p.dorsal, posicion: p.posicion, mano: p.mano, lema: p.lema }
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
      `SELECT j.id AS jugador_id, e.id AS equipo_id, e.nombre AS equipo_nombre, e.posicion_final AS posicion_final,
              ed.id AS edicion_id, ed.anio AS anio, ed.nombre AS edicion_nombre, ed.estado AS estado,
              j.nombre AS jugador_nombre, j.apellidos AS jugador_apellidos,
              j.apodo, j.dorsal, j.posicion, j.mano, j.lema, j.nivel
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
  const [companerosPorEquipo, estadisticas] = await Promise.all([
    cargarCompaneros(
      db,
      membresias.map((m) => m.equipo_id),
      emailNormalizado
    ),
    totalesPorJugador(db, membresias.map((m) => m.jugador_id))
  ]);

  return membresias.map((m) => ({
    jugadorId: m.jugador_id,
    edicionId: m.edicion_id,
    anio: m.anio,
    nombreEdicion: m.edicion_nombre,
    estado: m.estado,
    equipoNombre: m.equipo_nombre,
    posicionFinal: m.posicion_final,
    esActual: edicionActualId != null && m.edicion_id === edicionActualId,
    estadisticas: estadisticas.get(m.jugador_id) ?? mapEstadisticas(null),
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
    lista.push({ nombre: fila.nombre, apellido: fila.apellidos ?? "" });
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
