import { env } from "cloudflare:test";
import {
  createSessionCookie,
  createVerComoCookie,
  type UsuarioSesion
} from "../../functions/_lib/auth";
import { capitalizarPropio } from "../../functions/_lib/nombres";
import { ROL_ADMIN } from "../../functions/_lib/permisos";
import { normalizarEmail, normalizarTelefono, normalizarTexto } from "../../functions/_lib/validacion";

// Sembradores para los tests de integración. Todo test que necesite datos pasa
// por aquí: nada de SQL suelto repartido por los ficheros de test.

let contador = 0;
const siguiente = () => ++contador;

export interface OpcionesUsuario {
  email?: string;
  nombre?: string;
  /** Clave de un rol ya sembrado. Sin rol, la cuenta no tiene ningún permiso. */
  rol?: string | null;
  emailVerified?: boolean;
}

/** Id de un rol por su clave. Revienta si no existe: siempre es un error del test. */
export async function rolPorClave(clave: string): Promise<number> {
  const fila = await env.DB.prepare("SELECT id FROM roles WHERE clave = ?1").bind(clave).first<{ id: number }>();
  if (!fila) throw new Error(`No existe el rol "${clave}". ¿Falta sembrarlo en test/integration/setup.ts?`);
  return fila.id;
}

/** Un rol a medida, para probar permisos sueltos sin depender de los de sistema. */
export async function crearRol(clave: string, permisos: readonly string[], nombre?: string): Promise<number> {
  const fila = await env.DB.prepare(
    "INSERT INTO roles (clave, nombre, es_sistema) VALUES (?1, ?2, 0) RETURNING id"
  )
    .bind(clave, nombre ?? clave)
    .first<{ id: number }>();

  if (permisos.length > 0) {
    await env.DB.batch(
      permisos.map((permiso) =>
        env.DB.prepare("INSERT INTO rol_permisos (rol_id, permiso) VALUES (?1, ?2)").bind(fila!.id, permiso)
      )
    );
  }
  return fila!.id;
}

/**
 * Cambia (o quita, con null) el rol de una cuenta ya creada. Es lo que usan los
 * tests que comprueban que conceder o revocar surte efecto con la misma cookie.
 */
export async function asignarRol(usuarioId: number, clave: string | null): Promise<void> {
  const rolId = clave === null ? null : await rolPorClave(clave);
  await env.DB.prepare("UPDATE usuarios SET rol_id = ?1 WHERE id = ?2").bind(rolId, usuarioId).run();
}

export async function crearUsuario(opciones: OpcionesUsuario = {}): Promise<UsuarioSesion> {
  const n = siguiente();
  const email = opciones.email ?? `usuario${n}@example.com`;
  const rolId = opciones.rol ? await rolPorClave(opciones.rol) : null;
  const fila = await env.DB.prepare(
    `INSERT INTO usuarios (google_sub, email, email_verified, nombre, foto_url, rol_id)
     VALUES (?1, ?2, ?3, ?4, NULL, ?5)
     RETURNING id`
  )
    .bind(`sub-${n}`, email, opciones.emailVerified === false ? 0 : 1, opciones.nombre ?? `Usuario ${n}`, rolId)
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

/**
 * Adaptar este helper es lo que mantiene en pie la cuarentena de tests que ya
 * existían: casi todos abren el panel con él, y ninguno necesita saber que por
 * debajo dejó de haber un booleano.
 */
export const crearAdmin = (opciones: OpcionesUsuario = {}) => crearUsuario({ ...opciones, rol: ROL_ADMIN });

/** Una cuenta con exactamente los permisos pedidos, en un rol recién hecho. */
export async function crearUsuarioConPermisos(
  permisos: readonly string[],
  opciones: OpcionesUsuario = {}
): Promise<UsuarioSesion> {
  const clave = `rol-test-${siguiente()}`;
  await crearRol(clave, permisos);
  return crearUsuario({ ...opciones, rol: clave });
}

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

export interface OpcionesFase {
  clave?: string;
  nombre?: string;
  tipo?: "grupos" | "eliminatoria";
  orden?: number;
  reglas?: unknown;
  clasifican?: number;
  edicionId?: number;
}

export interface FaseSembrada {
  id: number;
  clave: string;
  edicionId: number;
}

const edicionActualId = async (): Promise<number> =>
  (await env.DB.prepare("SELECT id FROM ediciones WHERE es_actual = 1").first<{ id: number }>())!.id;

export async function crearFase(opciones: OpcionesFase = {}): Promise<FaseSembrada> {
  const n = siguiente();
  const clave = opciones.clave ?? `fase-${n}`;
  const edicionId = opciones.edicionId ?? (await edicionActualId());
  const fila = await env.DB.prepare(
    `INSERT INTO torneo_fases (edicion_id, clave, nombre, tipo, orden, reglas, clasifican)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`
  )
    .bind(
      edicionId,
      clave,
      opciones.nombre ?? `Fase ${n}`,
      opciones.tipo ?? "grupos",
      opciones.orden ?? 0,
      typeof opciones.reglas === "string" ? opciones.reglas : JSON.stringify(opciones.reglas ?? {}),
      opciones.clasifican ?? 0
    )
    .first<{ id: number }>();
  return { id: fila!.id, clave, edicionId };
}

export async function crearGrupo(
  faseId: number,
  opciones: { nombre?: string; orden?: number; reglas?: unknown } = {}
): Promise<number> {
  const n = siguiente();
  const fila = await env.DB.prepare(
    "INSERT INTO torneo_grupos (fase_id, nombre, orden, reglas) VALUES (?1, ?2, ?3, ?4) RETURNING id"
  )
    .bind(
      faseId,
      opciones.nombre ?? `Grupo ${n}`,
      opciones.orden ?? 0,
      opciones.reglas === undefined
        ? null
        : typeof opciones.reglas === "string"
          ? opciones.reglas
          : JSON.stringify(opciones.reglas)
    )
    .first<{ id: number }>();
  return fila!.id;
}

export async function asignarEquipoAGrupo(grupoId: number, faseId: number, equipoId: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO torneo_grupo_equipos (grupo_id, fase_id, equipo_id) VALUES (?1, ?2, ?3)"
  )
    .bind(grupoId, faseId, equipoId)
    .run();
}

export interface OpcionesPartido {
  ronda?: string;
  equipoA?: EquipoSembrado;
  equipoB?: EquipoSembrado;
  /** Por defecto, la edición actual. Se pasa para sembrar histórico. */
  edicionId?: number;
  faseId?: number;
  grupoId?: number;
  rondaOrden?: number;
  posicion?: number;
  reglas?: unknown;
  status?: "scheduled" | "live" | "finished";
  winner?: "A" | "B" | null;
  setsA?: number;
  setsB?: number;
  puntosA?: number;
  puntosB?: number;
  /**
   * Un hueco de cuadro todavía sin equipos: nombres vacíos y los dos lados
   * marcados como `progresion`. Sin esto heredarían el `manual` por defecto de
   * la columna, y `propagarResultado` se negaría a escribir en ellos — que es
   * justo lo que tiene que hacer con un hueco puesto a mano.
   */
  vacio?: boolean;
}

/**
 * Un partido de la edición actual al que colgar estadísticas. Devuelve su id
 * (es TEXT: un UUID). Los equipos son opcionales porque la mayoría de tests
 * sólo necesitan algo de lo que colgar una fila.
 */
export async function crearPartido(opciones: OpcionesPartido = {}): Promise<string> {
  const id = crypto.randomUUID();
  const edicionId =
    opciones.edicionId ??
    (await env.DB.prepare("SELECT id FROM ediciones WHERE es_actual = 1").first<{ id: number }>())?.id ??
    null;

  await env.DB.prepare(
    `INSERT INTO partidos (
       id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre, edicion_id,
       fase_id, grupo_id, ronda_orden, posicion, reglas, status, winner, sets_a, sets_b,
       origen_equipo_a, origen_equipo_b, points_a, points_b
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17, ?18, ?19)`
  )
    .bind(
      id,
      opciones.ronda ?? "Sorteo",
      opciones.equipoA?.id ?? null,
      opciones.equipoB?.id ?? null,
      opciones.equipoA?.nombre ?? (opciones.vacio ? "" : "Equipo A"),
      opciones.equipoB?.nombre ?? (opciones.vacio ? "" : "Equipo B"),
      edicionId,
      opciones.faseId ?? null,
      opciones.grupoId ?? null,
      opciones.rondaOrden ?? null,
      opciones.posicion ?? null,
      opciones.reglas === undefined
        ? "{}"
        : typeof opciones.reglas === "string"
          ? opciones.reglas
          : JSON.stringify(opciones.reglas),
      opciones.status ?? "scheduled",
      opciones.winner ?? null,
      opciones.setsA ?? 0,
      opciones.setsB ?? 0,
      opciones.vacio ? "progresion" : "manual",
      opciones.puntosA ?? 0,
      opciones.puntosB ?? 0
    )
    .run();

  return id;
}

/** Enlaza dos partidos del cuadro: quién gana sube, quién pierde baja. */
export async function enlazarPartidos(
  origenId: string,
  destino: { ganador?: { id: string; slot: "A" | "B" }; perdedor?: { id: string; slot: "A" | "B" } }
): Promise<void> {
  await env.DB.prepare(
    `UPDATE partidos SET
       siguiente_partido_id = ?1, siguiente_slot = ?2,
       perdedor_partido_id = ?3, perdedor_slot = ?4
     WHERE id = ?5`
  )
    .bind(
      destino.ganador?.id ?? null,
      destino.ganador?.slot ?? null,
      destino.perdedor?.id ?? null,
      destino.perdedor?.slot ?? null,
      origenId
    )
    .run();
}

/**
 * Lo que un jugador hizo en un partido. `partidoId` va delante y es obligatorio:
 * desde la migración 0012 una estadística sin partido no existe.
 */
export async function crearEstadistica(
  jugadorId: number,
  partidoId: string,
  valores: Partial<Record<string, number>> = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO estadisticas (
       jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(
      jugadorId,
      partidoId,
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
