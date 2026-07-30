// GET /api/plantilla?partido=ID — quiénes juegan ese partido.
//
// El compañero pesado de /api/directo, y por eso va en su propio fichero: son
// dos políticas de caché opuestas. El directo es `no-cache` con ETag porque lo
// sondea todo el mundo cada pocos segundos; esto son nombres, dorsales y metales
// que no cambian durante el partido, así que se cachea de verdad y se pide una
// sola vez por partido. Mezclarlos en un handler acabaría el día en que uno de
// los dos herede la cabecera del otro: o el marcador se congela cinco minutos en
// el edge, o la plantilla deja de cachearse.
//
// Público y sin sesión: es lo mismo que ya enseña el álbum de /jugadores/.

import { plantillaPublica } from "../_lib/directo";
import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
}

/** Cinco minutos, y media hora de gracia sirviendo lo viejo mientras revalida. */
const CACHE = "public, max-age=300, stale-while-revalidate=1800";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const partidoId = new URL(request.url).searchParams.get("partido") || "";
  if (!partidoId) return json({ error: "Falta el partido." }, 400);

  try {
    const plantilla = await plantillaPublica(env.DB, partidoId);
    if (!plantilla) return json({ error: "Ese partido no existe." }, 404);
    return json(plantilla, 200, { "Cache-Control": CACHE });
  } catch (err) {
    console.error("Error leyendo la plantilla del partido:", err);
    return json({ error: "No se ha podido cargar la plantilla." }, 500);
  }
};
