import { env } from "cloudflare:test";
import {
  createSessionCookie,
  createVerComoCookie,
  type UsuarioSesion
} from "../../functions/_lib/auth";
import { capitalizarPropio } from "../../functions/_lib/nombres";
import { normalizarEmail, normalizarTelefono, normalizarTexto } from "../../functions/_lib/validacion";

// Sembradores para los tests de integración. Todo test que necesite datos pasa
// por aquí: nada de SQL suelto repartido por los ficheros de test.

let contador = 0;
const siguiente = () => ++contador;

export interface OpcionesUsuario {
  email?: string;
  nombre?: string;
  admin?: boolean;
  emailVerified?: boolean;
}

export async function crearUsuario(opciones: OpcionesUsuario = {}): Promise<UsuarioSesion> {
  const n = siguiente();
  const email = opciones.email ?? `usuario${n}@example.com`;
  const fila = await env.DB.prepare(
    `INSERT INTO usuarios (google_sub, email, email_verified, nombre, foto_url, is_admin)
     VALUES (?1, ?2, ?3, ?4, NULL, ?5)
     RETURNING id`
  )
    .bind(
      `sub-${n}`,
      email,
      opciones.emailVerified === false ? 0 : 1,
      opciones.nombre ?? `Usuario ${n}`,
      opciones.admin ? 1 : 0
    )
    .first<{ id: number }>();

  return {
    id: fila!.id,
    googleSub: `sub-${n}`,
    email,
    emailVerified: opciones.emailVerified !== false,
    nombre: opciones.nombre ?? `Usuario ${n}`,
    fotoUrl: null
  };
}

export const crearAdmin = (opciones: OpcionesUsuario = {}) => crearUsuario({ ...opciones, admin: true });

export interface JugadorSemilla {
  nombre?: string;
  apellidos?: string;
  /** `""` siembra un jugador sin móvil. */
  telefono?: string;
  email?: string | null;
  redSocial?: string | null;
  fotoKey?: string | null;
}

export interface EquipoSembrado {
  id: number;
  nombre: string;
  edicionId: number | null;
  capitanId: number | null;
  jugadores: { id: number; nombre: string; apellidos: string; telefono: string; email: string | null }[];
}

export interface OpcionesEquipo {
  nombre?: string;
  jugadores?: JugadorSemilla[];
  /** Índice del jugador que es capitán. Por defecto, el primero. */
  capitan?: number;
  fotoKey?: string | null;
  /** Por defecto, la edición actual. Se pasa para sembrar historial. */
  edicionId?: number;
  posicionFinal?: number | null;
}

export interface OpcionesEdicion {
  anio?: number;
  nombre?: string;
  estado?: "proxima" | "en_juego" | "finalizada";
}

/**
 * Crea una edición **no** actual: el índice UNIQUE parcial solo admite una con
 * es_actual = 1, y esa la siembra el setup.
 */
export async function crearEdicion(opciones: OpcionesEdicion = {}): Promise<{ id: number; anio: number }> {
  const anio = opciones.anio ?? 2000 + siguiente();
  const fila = await env.DB.prepare(
    `INSERT INTO ediciones (anio, nombre, estado, es_actual) VALUES (?1, ?2, ?3, 0) RETURNING id`
  )
    .bind(anio, opciones.nombre ?? `Copa Arena ${anio}`, opciones.estado ?? "finalizada")
    .first<{ id: number }>();
  return { id: fila!.id, anio };
}

/**
 * Crea un equipo con sus jugadores en la edición actual. Los datos por defecto
 * son únicos entre llamadas, para no chocar con los índices UNIQUE globales.
 */
export async function crearEquipo(opciones: OpcionesEquipo = {}): Promise<EquipoSembrado> {
  const n = siguiente();
  const nombre = opciones.nombre ?? `Equipo ${n}`;
  const edicionId =
    opciones.edicionId ??
    (await env.DB.prepare("SELECT id FROM ediciones WHERE es_actual = 1").first<{ id: number }>())?.id ??
    null;

  const equipo = await env.DB.prepare(
    `INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at, edicion_id, foto_key, posicion_final)
     VALUES (?1, ?2, datetime('now'), ?3, ?4, ?5)
     RETURNING id, edicion_id`
  )
    .bind(
      nombre,
      normalizarTexto(nombre),
      edicionId,
      opciones.fotoKey ?? null,
      opciones.posicionFinal ?? null
    )
    .first<{ id: number; edicion_id: number | null }>();

  const semillas: JugadorSemilla[] = opciones.jugadores ?? [{}, {}];
  const jugadores: EquipoSembrado["jugadores"] = [];

  for (const [i, semilla] of semillas.entries()) {
    const m = siguiente();
    const nombreJ = capitalizarPropio(semilla.nombre ?? `Jugador${m}`);
    const apellidosJ = capitalizarPropio(semilla.apellidos ?? `Apellido${m}`);
    const telefono = semilla.telefono ?? `6${String(10000000 + m).slice(0, 8)}`;
    const email = semilla.email === null ? null : (semilla.email ?? `jugador${m}@example.com`);

    const fila = await env.DB.prepare(
      `INSERT INTO jugadores (
         equipo_id, nombre, apellidos, nombre_completo_normalizado,
         telefono, telefono_normalizado, email, email_normalizado,
         red_social, foto_key, es_suplente, orden, edicion_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       RETURNING id`
    )
      .bind(
        equipo!.id,
        nombreJ,
        apellidosJ,
        normalizarTexto(`${nombreJ} ${apellidosJ}`),
        telefono,
        normalizarTelefono(telefono),
        email,
        email ? normalizarEmail(email) : null,
        semilla.redSocial ?? null,
        semilla.fotoKey ?? null,
        i >= 2 ? 1 : 0,
        i + 1,
        equipo!.edicion_id
      )
      .first<{ id: number }>();

    jugadores.push({ id: fila!.id, nombre: nombreJ, apellidos: apellidosJ, telefono, email });
  }

  // El capitán se fija al final: hasta aquí no existen los ids de jugador.
  const capitan = jugadores[opciones.capitan ?? 0];
  if (capitan) {
    await env.DB.prepare("UPDATE equipos SET capitan_jugador_id = ?1 WHERE id = ?2")
      .bind(capitan.id, equipo!.id)
      .run();
  }

  return { id: equipo!.id, nombre, edicionId: equipo!.edicion_id, capitanId: capitan?.id ?? null, jugadores };
}

/**
 * Carga de estadísticas de un jugador. Sin `partidoId` es la carga manual de la
 * edición; con él, la que registraría un partido. Las dos suman.
 */
export async function crearEstadistica(
  jugadorId: number,
  valores: Partial<Record<string, number>> = {},
  partidoId: string | null = null
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO estadisticas (
       jugador_id, partido_id, partidos_jugados, puntos, remates, bloqueos, aces, defensas, errores
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  )
    .bind(
      jugadorId,
      partidoId,
      valores.partidosJugados ?? 0,
      valores.puntos ?? 0,
      valores.remates ?? 0,
      valores.bloqueos ?? 0,
      valores.aces ?? 0,
      valores.defensas ?? 0,
      valores.errores ?? 0
    )
    .run();
}

/** Atributos 1–5 de un jugador, los que pone la organización. */
export async function crearAtributos(jugadorId: number, atributos: Record<string, number>): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO jugador_atributos (jugador_id, atributos) VALUES (?1, ?2)
     ON CONFLICT(jugador_id) DO UPDATE SET atributos = ?2`
  )
    .bind(jugadorId, JSON.stringify(atributos))
    .run();
}

export async function ocultarJugador(jugadorId: number): Promise<void> {
  await env.DB.prepare("UPDATE jugadores SET oculto_publico = 1 WHERE id = ?1").bind(jugadorId).run();
}

/** Sube un objeto a R2 y devuelve su key, para los tests de fotos. */
export async function sembrarFoto(key: string, contenido = "foto"): Promise<string> {
  await env.FOTOS.put(key, contenido);
  return key;
}

// ---------------------------------------------------------------------------
// Cookies: firmadas de verdad con el mismo SESSION_SECRET del binding.
// ---------------------------------------------------------------------------

const soloCookie = (setCookie: string) => setCookie.split(";")[0]!;
const base = "https://copa.test";

export async function cookieSesion(user: UsuarioSesion, url = base): Promise<string> {
  return soloCookie(await createSessionCookie(new Request(url), env, user.id));
}

export async function cookieVerComo(admin: UsuarioSesion, objetivo: UsuarioSesion, url = base): Promise<string> {
  return soloCookie(await createVerComoCookie(new Request(url), env, admin.id, objetivo.id));
}

export interface OpcionesPeticion {
  method?: string;
  /** Sesión real. */
  user?: UsuarioSesion;
  /** Si se pasa, se añade también la cookie de suplantación. */
  verComo?: { admin: UsuarioSesion; objetivo: UsuarioSesion };
  body?: BodyInit | null;
  headers?: Record<string, string>;
  json?: unknown;
}

/** Construye una Request con las cookies ya firmadas. */
export async function peticion(ruta: string, opciones: OpcionesPeticion = {}): Promise<Request> {
  const url = ruta.startsWith("http") ? ruta : `${base}${ruta}`;
  const cookies: string[] = [];
  if (opciones.user) cookies.push(await cookieSesion(opciones.user, url));
  if (opciones.verComo) {
    cookies.push(await cookieVerComo(opciones.verComo.admin, opciones.verComo.objetivo, url));
  }

  const headers: Record<string, string> = { ...opciones.headers };
  if (cookies.length > 0) headers.Cookie = cookies.join("; ");

  let body = opciones.body ?? null;
  if (opciones.json !== undefined) {
    body = JSON.stringify(opciones.json);
    headers["Content-Type"] = "application/json";
  }

  return new Request(url, { method: opciones.method ?? "GET", headers, body });
}
