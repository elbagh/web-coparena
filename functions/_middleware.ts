/*
 * Cumplimiento del modo "ver como" en un único punto.
 *
 * Mientras la suplantación está activa, la petición se resuelve como el usuario
 * suplantado (ver getAuthContext en _lib/auth.ts). Eso vale para mirar, pero
 * jamás para escribir: nadie debe poder guardar nada en nombre de otra persona,
 * ni siquiera el administrador. En vez de repartir esa comprobación por los
 * veintitantos endpoints —donde tarde o temprano se olvidaría en uno— se
 * bloquea aquí cualquier método que no sea de lectura.
 *
 * Las únicas excepciones son las tres operaciones que actúan sobre la propia
 * sesión, no sobre los datos de nadie: salir del modo, cerrar sesión y volver a
 * entrar. Sin ellas, una cookie de suplantación olvidada dejaría el navegador
 * bloqueado —sin poder ni desloguearse ni loguearse— hasta que caducara. Salir
 * se valida contra el administrador **real**, y el login contra la credencial
 * de Google: en ninguna de las dos manda el usuario efectivo.
 */

import { hayVerComo, type AuthEnv } from "./_lib/auth";
import { json } from "./_lib/http";

const METODOS_DE_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);
const EXCEPCIONES = new Map([
  ["/api/admin/ver-como", "DELETE"],
  ["/api/auth/logout", "POST"],
  ["/api/auth/google", "POST"]
]);

export const onRequest: PagesFunction<AuthEnv> = async (context) => {
  const { request, env, next } = context;

  if (METODOS_DE_LECTURA.has(request.method)) return next();

  const url = new URL(request.url);
  // Cada excepción abre un único método en su ruta, nunca la ruta entera.
  if (EXCEPCIONES.get(url.pathname) === request.method) return next();

  if (await hayVerComo(request, env)) {
    return json(
      {
        error:
          "Estás viendo el sitio como otra persona. Vuelve a tu cuenta para poder guardar cambios."
      },
      403,
      { "Cache-Control": "no-store" }
    );
  }

  return next();
};
