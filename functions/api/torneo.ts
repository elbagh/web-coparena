// GET /api/torneo — el cuadro, el calendario y las clasificaciones, en público.
//
// Es la lectura pesada del sitio, así que **no se sondea**: se cachea 30 s y la
// página solo vuelve a pedirla cuando /api/directo avisa de que un partido ha
// cerrado. El que sí se sondea es /api/directo, que es minúsculo.
//
// Sale de la misma función que usa el panel (`cargarTorneo`), de modo que la
// clasificación que ve el público y la que ve la organización no pueden
// divergir. Aquí no hay nada privado que filtrar: nombres de equipo y
// resultados ya son públicos en /api/equipos y en el cuadro de la portada.

import { json } from "../_lib/http";
import { cargarTorneo } from "../_lib/torneo-vista";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const edicion = await env.DB
      .prepare("SELECT id, anio, nombre, estado FROM ediciones WHERE es_actual = 1")
      .first<{ id: number; anio: number; nombre: string; estado: string }>();

    if (!edicion) {
      return json({ edicion: null, fases: [], sueltos: [] }, 200, { "Cache-Control": "no-store" });
    }

    const { fases, sueltos } = await cargarTorneo(env.DB, edicion.id);

    return json({ edicion, fases, sueltos }, 200, {
      // Treinta segundos de caché y cinco minutos sirviendo lo viejo mientras se
      // revalida: si esto se cae, la página sigue enseñando el último cuadro
      // bueno en vez de un hueco.
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300"
    });
  } catch (err) {
    console.error("Error leyendo el torneo público:", err);
    return json({ error: "No se ha podido cargar el torneo." }, 500);
  }
};
