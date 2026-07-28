export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });

/**
 * Igual que json(), pero con varias cabeceras `Set-Cookie`. Un objeto plano solo
 * admite una: entrar y salir tocan a la vez la sesión y la cookie de «ver como»,
 * y las dos tienen que viajar en la misma respuesta.
 */
export const jsonConCookies = (
  data: unknown,
  cookies: string[],
  status = 200,
  extra: Record<string, string> = {}
): Response => {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", ...extra });
  cookies.forEach((cookie) => headers.append("Set-Cookie", cookie));
  return new Response(JSON.stringify(data), { status, headers });
};
