// GET /api/directo — el marcador de lo que se está jugando ahora mismo.
//
// Público y minúsculo a propósito: es el único endpoint que sondea todo el
// mundo a la vez. Lo pesado (cuadro, calendario, clasificaciones) vive en
// /api/torneo, que se cachea y no se sondea.
//
// La versión se calcula ANTES que el cuerpo, con una sola fila agregada. Si el
// navegador ya la tiene, se responde 304 sin leer los partidos.

import { coincideEtag, estadoDirecto, leerAjustes, respuestaDirecto, versionDirecto } from "../_lib/directo";
import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const version = await versionDirecto(env.DB);
    if (coincideEtag(request, version)) return respuestaDirecto(request, version, null);

    const ajustes = await leerAjustes(env.DB);
    return respuestaDirecto(request, version, await estadoDirecto(env.DB, ajustes));
  } catch (err) {
    console.error("Error leyendo el directo:", err);
    return json({ error: "No se ha podido cargar el marcador." }, 500);
  }
};
