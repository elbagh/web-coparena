// Verificación server-side de Cloudflare Turnstile.
// Un fallo de red contra siteverify se trata como verificación fallida.

export async function verificarTurnstile(
  secret: string | undefined,
  token: string,
  ip?: string | null
): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const body = new FormData();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
