export interface GoogleEnv {
  GOOGLE_CLIENT_ID: string;
}

export interface GoogleProfile {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

interface GoogleJwtHeader {
  kid?: string;
  alg?: string;
}

interface GoogleJwtPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  exp?: number;
}

interface JwkSet {
  keys: GoogleJwk[];
}

interface GoogleJwk extends JsonWebKey {
  kid?: string;
}

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export async function verifyGoogleCredential(credential: string, env: GoogleEnv): Promise<GoogleProfile> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID no está configurado.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = credential.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("La credencial de Google no es válida.");
  }

  const header = decodeJson<GoogleJwtHeader>(encodedHeader);
  const payload = decodeJson<GoogleJwtPayload>(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("La credencial de Google no usa una firma válida.");
  }

  const key = await getGoogleKey(header.kid);
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signature = toArrayBuffer(base64urlDecode(encodedSignature));
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  if (!validSignature) {
    throw new Error("No se ha podido verificar la firma de Google.");
  }

  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error("El emisor de Google no es válido.");
  }
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error("La credencial de Google no pertenece a esta web.");
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("La sesión de Google ha caducado.");
  }
  if (!payload.sub || !payload.email) {
    throw new Error("Google no ha devuelto los datos necesarios.");
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  if (!emailVerified) {
    throw new Error("Tu correo de Google debe estar verificado.");
  }

  return {
    googleSub: payload.sub,
    email: payload.email,
    emailVerified,
    name: payload.name ?? null,
    picture: payload.picture ?? null
  };
}

async function getGoogleKey(kid: string): Promise<GoogleJwk> {
  const response = await fetch(GOOGLE_CERTS_URL, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!response.ok) {
    throw new Error("No se han podido cargar las claves públicas de Google.");
  }
  const certs = (await response.json()) as JwkSet;
  const key = certs.keys.find((item) => item.kid === kid);
  if (!key) {
    throw new Error("Google ha devuelto una clave desconocida.");
  }
  return key;
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64urlDecode(value))) as T;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
