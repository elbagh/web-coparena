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

const COOKIE_NAME = "copa_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export const sessionCookieName = COOKIE_NAME;

export async function getCurrentUser(request: Request, env: AuthEnv): Promise<UsuarioSesion | null> {
  const payload = await readSession(request, env);
  if (!payload) return null;

  const row = await env.DB
    .prepare(
      `SELECT id, google_sub, email, email_verified, nombre, foto_url
       FROM usuarios
       WHERE id = ?1`
    )
    .bind(payload.uid)
    .first<{
      id: number;
      google_sub: string;
      email: string;
      email_verified: number;
      nombre: string | null;
      foto_url: string | null;
    }>();

  if (!row) return null;
  return mapUser(row);
}

export async function requireUser(request: Request, env: AuthEnv): Promise<UsuarioSesion | Response> {
  const user = await getCurrentUser(request, env);
  return user ?? json({ error: "Inicia sesión con Google para continuar." }, 401);
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

function serializeCookie(request: Request, value: string, maxAge: number): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
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
