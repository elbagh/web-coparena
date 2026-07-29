// GET /api/admin/fotos?jugador=N — sirve la foto de cualquier jugador.
//
// Las fotos de jugador son privadas: solo salen por aquí, detrás del permiso
// `jugadores.ver`, y nunca se cachean. Quien puede ver la ficha con su teléfono
// y su correo puede ver también su foto; no hace falta un permiso aparte. Al
// resto del mundo la API solo le dice si un jugador tiene foto o no
// (`tieneFoto`), jamás su clave de R2.

import { requirePermiso, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { fotoNoEncontrada, servirFoto } from "../../_lib/fotos";

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "jugadores.ver");
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const jugadorId = idDeQuery(url, "jugador");
  if (jugadorId === null) return accionNoValida();

  const jugador = await env.DB
    .prepare("SELECT foto_key FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ foto_key: string | null }>();
  if (!jugador?.foto_key) return fotoNoEncontrada();

  return servirFoto(env.FOTOS, jugador.foto_key);
};
