// Envío de correo desde copa.arena.2000@gmail.com vía Gmail API con OAuth2.
// El mensaje es texto plano (sin HTML) para eliminar cualquier superficie de
// escape con datos del formulario. Los errores se lanzan: el caller decide
// (en el registro, un fallo de email NO revierte la inscripción).

export interface GmailEnv {
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
}

const REMITENTE = "La Copa Arena <copa.arena.2000@gmail.com>";

// btoa solo acepta latin1: pasar por TextEncoder para UTF-8 correcto.
function base64Utf8(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

const base64Url = (b64: string): string =>
  b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function obtenerAccessToken(env: GmailEnv): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) {
    throw new Error(`OAuth de Gmail falló (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("OAuth de Gmail no devolvió access_token");
  }
  return data.access_token;
}

export async function enviarEmail(
  env: GmailEnv,
  opts: { para: string[]; asunto: string; texto: string }
): Promise<void> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Credenciales de Gmail sin configurar");
  }
  const accessToken = await obtenerAccessToken(env);

  const mime = [
    `From: ${REMITENTE}`,
    `To: ${opts.para.join(", ")}`,
    `Subject: =?UTF-8?B?${base64Utf8(opts.asunto)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(opts.texto)
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: base64Url(base64Utf8(mime)) })
  });
  if (!res.ok) {
    throw new Error(`Gmail send falló (${res.status}): ${await res.text()}`);
  }
}

export function construirEmailConfirmacion(
  equipo: string,
  jugadores: { nombre: string; apellidos: string; esSuplente: boolean }[]
): { asunto: string; texto: string } {
  const lista = jugadores
    .map((j) => `- ${j.nombre} ${j.apellidos}${j.esSuplente ? " (suplente)" : ""}`)
    .join("\n");

  const texto = `¡Hola!

El equipo «${equipo}» ya está inscrito en La Copa Arena.

Jugadores inscritos:
${lista}

Lo importante:
- Fechas: fase de grupos del 31 de julio al 2 de agosto y fase final del 7 al 9 de agosto, en la Playa O Pozo (Porto do Son).
- Inscripción: 30 € por equipo. Se pagan en el primer partido, en mano.
- El calendario y los horarios se publicarán en nuestro Instagram:
  https://www.instagram.com/la_copa_arena/

Si hay algún error en los datos o necesitáis cambiar algo, escribidnos a
copa.arena.2000@gmail.com y lo arreglamos.

Nos vemos en la arena.
La Copa Arena`;

  return {
    asunto: `La Copa Arena — Inscripción confirmada: ${equipo}`,
    texto
  };
}
