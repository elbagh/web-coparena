// GET /api/historial?partido=ID — cómo fue un partido, punto a punto.
//
// El tercer endpoint público del torneo, y va en su propio fichero por lo mismo
// que `/api/plantilla`: la política de caché es la contraria a la de
// `/api/directo`. Aquél es `no-cache` con ETag porque lo sondea todo el mundo
// cada pocos segundos; esto se pide una vez, cuando alguien abre un partido ya
// jugado, y entonces no vuelve a cambiar. Mezclarlos en un handler acabaría el
// día en que uno herede la cabecera del otro, y el que no puede fallar es el
// directo.
//
// La caché depende del estado porque el dato depende del estado: un partido
// terminado ya no se mueve, uno en juego sí. Cinco minutos contra diez segundos.
//
// Público y sin sesión: es lo mismo que ya se ve en el directo mientras se juega.

import { historialDePartido } from "../_lib/historial";
import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
}

const CACHE_TERMINADO = "public, max-age=300, stale-while-revalidate=1800";
const CACHE_EN_JUEGO = "public, max-age=10, stale-while-revalidate=60";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const partidoId = new URL(request.url).searchParams.get("partido") || "";
  if (!partidoId) return json({ error: "Falta el partido." }, 400);

  try {
    const historial = await historialDePartido(env.DB, partidoId);
    if (!historial) return json({ error: "Ese partido no existe." }, 404);

    const cache = historial.partido.status === "finished" ? CACHE_TERMINADO : CACHE_EN_JUEGO;
    return json(historial, 200, { "Cache-Control": cache });
  } catch (err) {
    console.error("Error leyendo el historial del partido:", err);
    return json({ error: "No se ha podido cargar el historial." }, 500);
  }
};
