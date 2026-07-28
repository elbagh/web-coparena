/*
 * Guardado incremental de un equipo, compartido por el editor del panel
 * (PATCH /api/admin/equipos) y por el del capitán (PATCH /api/mi-equipo).
 *
 * La clave está en diferenciar por `id` de jugador en vez de borrar e insertar:
 * los que llegan con id se actualizan en su sitio y **conservan su foto_key**,
 * los que faltan se borran (con su foto), y los nuevos se insertan. Antes,
 * /api/mi-equipo hacía DELETE + INSERT con foto_key NULL y luego borraba los
 * objetos de R2, así que al capitán le desaparecían todas las fotos del equipo
 * cada vez que cambiaba una coma.
 *
 * Orden de operaciones, pensado para no dejar nunca la base apuntando a un
 * objeto que no existe:
 *   1. subir las fotos nuevas a R2
 *   2. un único DB.batch con todo el diff
 *   3. si el batch falla, revertir las subidas; si va bien, borrar las huérfanas
 */

import { buscarDuplicadosEdicion, mapearConflictoUnicoEdicion } from "./equipos";
import { limpiarFotos, subirFoto, type ExtensionFoto } from "./fotos";
import { json } from "./http";
import type { RegistroValidado } from "./validacion";

export interface FotoNueva {
  buffer: ArrayBuffer;
  ext: ExtensionFoto;
}

export interface EntornoEquipo {
  DB: D1Database;
  FOTOS?: R2Bucket;
}

const noStore = (data: unknown, status: number) => json(data, status, { "Cache-Control": "no-store" });

/**
 * Aplica el registro validado sobre el equipo. Devuelve `null` si todo ha ido
 * bien, o la `Response` de error lista para devolver al cliente.
 *
 * `fotosNuevas` va indexado por la **posición del jugador en el registro**, que
 * es como llegan las partes `foto_<i>` del multipart.
 */
export async function guardarEquipo(
  env: EntornoEquipo,
  equipoId: number,
  registro: RegistroValidado,
  fotosNuevas: Map<number, FotoNueva> = new Map()
): Promise<Response | null> {
  const { results: actuales } = await env.DB
    .prepare("SELECT id, foto_key FROM jugadores WHERE equipo_id = ?1")
    .bind(equipoId)
    .all<{ id: number; foto_key: string | null }>();
  const fotoPorId = new Map(actuales.map((j) => [j.id, j.foto_key]));

  for (const jugador of registro.jugadores) {
    if (jugador.id !== undefined && !fotoPorId.has(jugador.id)) {
      return noStore({ error: "Alguno de los jugadores no pertenece a este equipo." }, 400);
    }
  }

  const duplicados = await buscarDuplicadosEdicion(env.DB, registro, equipoId);
  if (Object.keys(duplicados).length > 0) {
    return noStore({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409);
  }

  if (fotosNuevas.size > 0 && !env.FOTOS) {
    return noStore({ error: "No se han podido guardar las fotos." }, 500);
  }

  // 1. Fotos nuevas a R2, antes de tocar D1.
  const subidas: string[] = [];
  const clavePorIndice = new Map<number, string>();
  if (env.FOTOS && fotosNuevas.size > 0) {
    const lote = crypto.randomUUID();
    try {
      for (const [i, foto] of fotosNuevas) {
        const key = `equipos/${lote}/jugador-${i + 1}.${foto.ext}`;
        await subirFoto(env.FOTOS, key, foto.buffer, foto.ext);
        subidas.push(key);
        clavePorIndice.set(i, key);
      }
    } catch (err) {
      console.error("Error subiendo foto de jugador a R2:", err);
      await limpiarFotos(env.FOTOS, subidas);
      return noStore({ error: "No se han podido guardar las fotos." }, 500);
    }
  }

  // 2. Diff: los jugadores actuales cuyo id no viene en el registro se borran.
  const idsEnviados = new Set(
    registro.jugadores.filter((j) => j.id !== undefined).map((j) => j.id as number)
  );
  const idsABorrar = actuales.filter((j) => !idsEnviados.has(j.id)).map((j) => j.id);
  const clavesABorrar = actuales
    .filter((j) => idsABorrar.includes(j.id) && j.foto_key)
    .map((j) => j.foto_key as string);

  const statements = [
    env.DB
      .prepare("UPDATE equipos SET nombre = ?1, nombre_normalizado = ?2 WHERE id = ?3")
      .bind(registro.equipo, registro.equipoNormalizado, equipoId)
  ];

  if (idsABorrar.length > 0) {
    statements.push(
      env.DB
        .prepare(`DELETE FROM jugadores WHERE id IN (${idsABorrar.map(() => "?").join(",")})`)
        .bind(...idsABorrar)
    );
  }

  registro.jugadores.forEach((jugador, i) => {
    // El orden manda: los dos primeros son titulares y el resto suplentes.
    const esSuplente = i >= 2 ? 1 : 0;
    const orden = i + 1;
    const fotoNueva = clavePorIndice.get(i);

    if (jugador.id !== undefined) {
      const fotoActual = fotoPorId.get(jugador.id) ?? null;
      let fotoKey: string | null;
      if (fotoNueva) {
        fotoKey = fotoNueva;
        if (fotoActual) clavesABorrar.push(fotoActual);
      } else if (jugador.eliminarFoto) {
        fotoKey = null;
        if (fotoActual) clavesABorrar.push(fotoActual);
      } else {
        // Sin foto nueva y sin orden de borrarla: se conserva la que había.
        fotoKey = fotoActual;
      }

      statements.push(
        env.DB
          .prepare(
            `UPDATE jugadores SET nombre = ?1, apellidos = ?2, nombre_completo_normalizado = ?3,
               telefono = ?4, telefono_normalizado = ?5, email = ?6, email_normalizado = ?7,
               red_social = ?8, foto_key = ?9, es_suplente = ?10, orden = ?11
             WHERE id = ?12`
          )
          .bind(
            jugador.nombre,
            jugador.apellidos,
            jugador.nombreCompletoNormalizado,
            jugador.telefono,
            jugador.telefonoNormalizado,
            jugador.email,
            jugador.emailNormalizado,
            jugador.redSocial,
            fotoKey,
            esSuplente,
            orden,
            jugador.id
          )
      );
    } else {
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO jugadores (
               equipo_id, nombre, apellidos, nombre_completo_normalizado,
               telefono, telefono_normalizado, email, email_normalizado,
               red_social, foto_key, es_suplente, orden, edicion_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
               (SELECT edicion_id FROM equipos WHERE id = ?1))`
          )
          .bind(
            equipoId,
            jugador.nombre,
            jugador.apellidos,
            jugador.nombreCompletoNormalizado,
            jugador.telefono,
            jugador.telefonoNormalizado,
            jugador.email,
            jugador.emailNormalizado,
            jugador.redSocial,
            fotoNueva ?? null,
            esSuplente,
            orden
          )
      );
    }
  });

  // 3. Un solo batch: o entra todo, o no entra nada.
  try {
    await env.DB.batch(statements);
  } catch (err) {
    await limpiarFotos(env.FOTOS, subidas);
    const conflicto = mapearConflictoUnicoEdicion(err);
    if (conflicto) {
      return noStore({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409);
    }
    console.error("Error guardando el equipo:", err);
    return noStore({ error: "No se ha podido guardar el equipo." }, 500);
  }

  await limpiarFotos(env.FOTOS, clavesABorrar);
  return null;
}
