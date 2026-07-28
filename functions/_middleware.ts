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
 * Única excepción: terminar la propia suplantación. Ese endpoint se valida
 * contra el administrador real, no contra el usuario efectivo.
 */

import { hayVerComo, type AuthEnv } from "./_lib/auth";
import { json } from "./_lib/http";

const METODOS_DE_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);
const SALIDA = "/api/admin/ver-como";

export const onRequest: PagesFunction<AuthEnv> = async (context) => {
  const { request, env, next } = context;

  if (METODOS_DE_LECTURA.has(request.method)) return next();

  const url = new URL(request.url);
  // Salir del modo "ver como" tiene que seguir siendo posible: es justo lo que
  // devuelve el control al administrador.
  if (url.pathname === SALIDA && request.method === "DELETE") return next();

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
