import { json } from "./http";

export interface AuthEnv {
  DB: D1Database;
  SESSION_SECRET: string;
}

export interface UsuarioSesion {
  id: number;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  nombre: string | null;
  fotoUrl: string | null;
}

interface SessionPayload {
  uid: number;
  exp: number;
}

/** Carga útil de la cookie de suplantación: quién mira y a quién. */
interface VerComoPayload {
  adminUid: number;
  targetUid: number;
  exp: number;
}

const COOKIE_NAME = "copa_session";
const VER_COMO_COOKIE = "copa_ver_como";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const VER_COMO_SECONDS = 60 * 30;

export const sessionCookieName = COOKIE_NAME;
export const verComoCookieName = VER_COMO_COOKIE;

export interface ContextoAuth {
  /** Usuario efectivo: el suplantado si "ver como" está activo. */
  user: UsuarioSesion | null;
  /** Quien inició sesión de verdad. Solo difiere al suplantar. */
  realUser: UsuarioSesion | null;
  impersonando: boolean;
}

/**
 * Resuelve quién está pidiendo. Si hay cookie de suplantación válida, el
 * usuario efectivo pasa a ser el suplantado, pero solo tras comprobar en la
 * base que el usuario real sigue siendo administrador: la cookie por sí sola
 * no basta, así que revocar `is_admin` corta la suplantación al instante y
 * copiar la cookie a otro navegador no sirve de nada.
 */
export async function getAuthContext(request: Request, env: AuthEnv): Promise<ContextoAuth> {
  const payload = await readSession(request, env);
  if (!payload) return { user: null, realUser: null, impersonando: false };

  const realUser = await cargarUsuario(env.DB, payload.uid);
  if (!realUser) return { user: null, realUser: null, impersonando: false };

  const verComo = await readVerComo(request, env);
  if (!verComo || verComo.adminUid !== realUser.id) {
    return { user: realUser, realUser, impersonando: false };
  }

  const esAdmin = await env.DB
    .prepare("SELECT is_admin FROM usuarios WHERE id = ?1")
    .bind(realUser.id)
    .first<{ is_admin: number | null }>();
  if (esAdmin?.is_admin !== 1) return { user: realUser, realUser, impersonando: false };

  const target = await cargarUsuario(env.DB, verComo.targetUid);
  if (!target) return { user: realUser, realUser, impersonando: false };

  return { user: target, realUser, impersonando: true };
}

export async function getCurrentUser(request: Request, env: AuthEnv): Promise<UsuarioSesion | null> {
  const { user } = await getAuthContext(request, env);
  return user;
}

export async function requireUser(request: Request, env: AuthEnv): Promise<UsuarioSesion | Response> {
  const user = await getCurrentUser(request, env);
  return user ?? json({ error: "Inicia sesión con Google para continuar." }, 401);
}

/**
 * Como requireUser, pero devolviendo además si la sesión está suplantando. Lo
 * necesitan los pocos GET que, además de leer, siembran algo: mientras se mira
 * el sitio como otra persona no se le escribe nada en su nombre, ni siquiera un
 * dato derivado.
 */
export async function requireUserContext(
  request: Request,
  env: AuthEnv
): Promise<{ user: UsuarioSesion; impersonando: boolean } | Response> {
  const { user, impersonando } = await getAuthContext(request, env);
  return user ? { user, impersonando } : json({ error: "Inicia sesión con Google para continuar." }, 401);
}

async function cargarUsuario(db: D1Database, id: number): Promise<UsuarioSesion | null> {
  const row = await db
    .prepare(
      `SELECT id, google_sub, email, email_verified, nombre, foto_url
       FROM usuarios
       WHERE id = ?1`
    )
    .bind(id)
    .first<{
      id: number;
      google_sub: string;
      email: string;
      email_verified: number;
      nombre: string | null;
      foto_url: string | null;
    }>();

  return row ? mapUser(row) : null;
}

export async function createSessionCookie(request: Request, env: AuthEnv, userId: number): Promise<string> {
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET no está configurado.");
  }
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
  const payloadPart = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(payloadPart, env.SESSION_SECRET);
  return serializeCookie(request, `${payloadPart}.${signature}`, SESSION_SECONDS);
}

export function clearSessionCookie(request: Request): string {
  return serializeCookie(request, "", 0);
}

/**
 * Cookie de suplantación. Va aparte de la de sesión a propósito: la sesión real
 * no se toca, así que salir del modo "ver como" es solo borrar esta, sin riesgo
 * de dejar al administrador desconectado. Vida corta (30 min) porque es un modo
 * de consulta puntual, no un estado en el que quedarse.
 */
export async function createVerComoCookie(
  request: Request,
  env: AuthEnv,
  adminUid: number,
  targetUid: number
): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET no está configurado.");

  const payload: VerComoPayload = {
    adminUid,
    targetUid,
    exp: Math.floor(Date.now() / 1000) + VER_COMO_SECONDS
  };
  const payloadPart = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(payloadPart, env.SESSION_SECRET);
  return serializeCookie(request, `${payloadPart}.${signature}`, VER_COMO_SECONDS, VER_COMO_COOKIE);
}

export function clearVerComoCookie(request: Request): string {
  return serializeCookie(request, "", 0, VER_COMO_COOKIE);
}

async function readVerComo(request: Request, env: AuthEnv): Promise<VerComoPayload | null> {
  if (!env.SESSION_SECRET) return null;

  const cookie = parseCookies(request.headers.get("Cookie")).get(VER_COMO_COOKIE);
  if (!cookie) return null;

  const [payloadPart, signature] = cookie.split(".");
  if (!payloadPart || !signature) return null;

  const expected = await sign(payloadPart, env.SESSION_SECRET);
  if (!constantTimeEqual(signature, expected)) return null;

  let payload: VerComoPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  } catch {
    return null;
  }

  if (!payload.adminUid || !payload.targetUid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

/** true si la petición trae una cookie de suplantación con firma válida. */
export async function hayVerComo(request: Request, env: AuthEnv): Promise<boolean> {
  return (await readVerComo(request, env)) !== null;
}

export function publicUser(user: UsuarioSesion) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    nombre: user.nombre,
    fotoUrl: user.fotoUrl
  };
}

export function mapUser(row: {
  id: number;
  google_sub: string;
  email: string;
  email_verified: number;
  nombre: string | null;
  foto_url: string | null;
}): UsuarioSesion {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    emailVerified: row.email_verified === 1,
    nombre: row.nombre,
    fotoUrl: row.foto_url
  };
}

async function readSession(request: Request, env: AuthEnv): Promise<SessionPayload | null> {
  if (!env.SESSION_SECRET) return null;

  const cookie = parseCookies(request.headers.get("Cookie")).get(COOKIE_NAME);
  if (!cookie) return null;

  const [payloadPart, signature] = cookie.split(".");
  if (!payloadPart || !signature) return null;

  const expected = await sign(payloadPart, env.SESSION_SECRET);
  if (!constantTimeEqual(signature, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  } catch {
    return null;
  }

  if (!payload.uid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  header.split(";").forEach((part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) return;
    cookies.set(rawName, rawValue.join("="));
  });
  return cookies;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64urlEncode(new Uint8Array(signature));
}

function serializeCookie(request: Request, value: string, maxAge: number, nombre = COOKIE_NAME): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${nombre}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
