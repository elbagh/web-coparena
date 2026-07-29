// /api/admin/jugadores
//   GET                               lista completa, con su equipo y edición
//   GET ?id=N                         ficha de un jugador
//   POST                              alta suelta en cualquier equipo (multipart)
//   POST ?accion=normalizar-nombres   recapitaliza nombre y apellidos de todos
//   PATCH ?id=N                       edita, cambia la foto y mueve de equipo (multipart)
//   DELETE ?id=N                      borra el jugador y su foto
//
// A diferencia del editor de equipo, aquí se trabaja jugador a jugador: es lo
// que permite mover a alguien de equipo sin tener que reconstruir la plantilla
// entera por los dos lados.

import {
  requirePermiso,
  jsonAdmin,
  accionNoValida,
  idDeQuery,
  mapJugador,
  type AdminEnv,
  type JugadorRow
} from "../../_lib/admin";
import { limpiarFotos, subirFoto, type ExtensionFoto } from "../../_lib/fotos";
import { capitalizarPropio } from "../../_lib/nombres";
import {
  MAX_BODY_BYTES,
  MENSAJE_CAPITAN_CONTACTO,
  limpiar,
  normalizarEmail,
  normalizarTelefono,
  normalizarTexto,
  validarFoto
} from "../../_lib/validacion";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MOVIL_PATTERN = /^[67]\d{8}$/;
const NOMBRE_PATTERN = /^[\p{L}\p{M}'’. -]+$/u;
const HANDLE_PATTERN = /^@?[a-zA-Z0-9._]{2,30}$/;
const URL_SOCIAL_PATTERN = /^https:\/\/\S{5,110}$/;

interface JugadorNombreRow {
  id: number;
  nombre: string;
  apellidos: string;
}

/** Devuelve solo los jugadores cuyo nombre o apellidos cambian al capitalizar. */
export function calcularNombresNormalizados(jugadores: JugadorNombreRow[]): JugadorNombreRow[] {
  return jugadores.reduce<JugadorNombreRow[]>((cambios, jugador) => {
    const nombre = capitalizarPropio(jugador.nombre);
    const apellidos = capitalizarPropio(jugador.apellidos);
    if (nombre !== jugador.nombre || apellidos !== jugador.apellidos) {
      cambios.push({ id: jugador.id, nombre, apellidos });
    }
    return cambios;
  }, []);
}

// ------------------------------------------------------------------ lectura ---

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "jugadores.ver");
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const id = idDeQuery(url);

  try {
    if (id !== null) {
      const jugador = await cargarJugador(env.DB, id);
      if (!jugador) return jsonAdmin({ error: "Ese jugador ya no existe." }, 404);
      return jsonAdmin({ jugador });
    }

    const { results } = await env.DB
      .prepare(
        `SELECT j.id, j.equipo_id, j.nombre, j.apellidos, j.telefono, j.email, j.red_social,
                j.foto_key, j.es_suplente, j.orden,
                e.nombre AS equipo_nombre, ed.anio AS edicion_anio
         FROM jugadores j
         LEFT JOIN equipos e ON e.id = j.equipo_id
         LEFT JOIN ediciones ed ON ed.id = j.edicion_id
         ORDER BY e.nombre COLLATE NOCASE ASC, j.orden ASC, j.id ASC`
      )
      .all<JugadorRow & { equipo_nombre: string | null; edicion_anio: number | null }>();

    return jsonAdmin({
      jugadores: results.map((fila) => ({
        ...mapJugador(fila),
        equipoId: fila.equipo_id,
        equipoNombre: fila.equipo_nombre,
        edicionAnio: fila.edicion_anio
      }))
    });
  } catch (err) {
    console.error("Error leyendo jugadores desde el panel:", err);
    return jsonAdmin({ error: "No se han podido cargar los jugadores." }, 500);
  }
};

// -------------------------------------------------------------------- altas ---

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "jugadores.editar");
  if (acceso instanceof Response) return acceso;

  if (new URL(request.url).searchParams.get("accion") === "normalizar-nombres") {
    return normalizarNombres(env.DB);
  }

  const datos = await leerFormulario(request);
  if (datos instanceof Response) return datos;
  const { campos: valores, foto } = datos;

  const equipoId = Number(valores.equipoId);
  if (!Number.isInteger(equipoId) || equipoId <= 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { equipoId: "Elige un equipo." } }, 400);
  }
  const equipo = await env.DB
    .prepare("SELECT id, edicion_id FROM equipos WHERE id = ?1")
    .bind(equipoId)
    .first<{ id: number; edicion_id: number | null }>();
  if (!equipo) {
    return jsonAdmin({ error: "Ese equipo ya no existe.", campos: { equipoId: "Elige un equipo válido." } }, 400);
  }

  // La fila es nueva: nunca puede ser la que ya manda en un equipo.
  const validado = validarJugador(valores);
  if ("campos" in validado) return jsonAdmin({ error: "Revisa los campos marcados.", campos: validado.campos }, 400);

  const duplicados = await buscarDuplicados(env.DB, validado.jugador, null, equipo.edicion_id);
  if (Object.keys(duplicados).length > 0) {
    return jsonAdmin({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409);
  }

  let claveFoto: string | null = null;
  if (foto) {
    if (!env.FOTOS) return jsonAdmin({ error: "No se ha podido guardar la foto." }, 500);
    claveFoto = `equipos/${crypto.randomUUID()}/jugador-1.${foto.ext}`;
    try {
      await subirFoto(env.FOTOS, claveFoto, foto.buffer, foto.ext);
    } catch (err) {
      console.error("Error subiendo la foto de un jugador nuevo:", err);
      return jsonAdmin({ error: "No se ha podido guardar la foto." }, 500);
    }
  }

  try {
    // Entra siempre como último de la plantilla; el orden se recoloca luego
    // desde el editor de equipo.
    const fila = await env.DB
      .prepare(
        `INSERT INTO jugadores (
           equipo_id, nombre, apellidos, nombre_completo_normalizado,
           telefono, telefono_normalizado, email, email_normalizado,
           red_social, foto_key, es_suplente, orden, edicion_id
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
           CASE WHEN (SELECT COUNT(*) FROM jugadores WHERE equipo_id = ?1) >= 2 THEN 1 ELSE 0 END,
           (SELECT COALESCE(MAX(orden), 0) + 1 FROM jugadores WHERE equipo_id = ?1),
           ?11
         )
         RETURNING id`
      )
      .bind(
        equipoId,
        validado.jugador.nombre,
        validado.jugador.apellidos,
        validado.jugador.nombreCompletoNormalizado,
        validado.jugador.telefono,
        validado.jugador.telefonoNormalizado,
        validado.jugador.email,
        validado.jugador.emailNormalizado,
        validado.jugador.redSocial,
        claveFoto,
        equipo.edicion_id
      )
      .first<{ id: number }>();

    return jsonAdmin({ ok: true, jugador: await cargarJugador(env.DB, fila!.id) }, 201);
  } catch (err) {
    if (claveFoto) await limpiarFotos(env.FOTOS, [claveFoto]);
    console.error("Error creando un jugador desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido crear el jugador." }, 500);
  }
};

// ------------------------------------------------------------------ edición ---

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "jugadores.editar");
  if (acceso instanceof Response) return acceso;

  const jugadorId = idDeQuery(new URL(request.url));
  if (jugadorId === null) return accionNoValida();

  const actual = await env.DB
    .prepare("SELECT id, equipo_id, edicion_id, foto_key FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ id: number; equipo_id: number; edicion_id: number | null; foto_key: string | null }>();
  if (!actual) return jsonAdmin({ error: "Ese jugador ya no existe." }, 404);

  const datos = await leerFormulario(request);
  if (datos instanceof Response) return datos;
  const { campos: valores, foto, eliminarFoto } = datos;

  const esCapitan = Boolean(
    await env.DB.prepare("SELECT 1 FROM equipos WHERE capitan_jugador_id = ?1").bind(jugadorId).first()
  );
  const validado = validarJugador(valores, { esCapitan });
  if ("campos" in validado) return jsonAdmin({ error: "Revisa los campos marcados.", campos: validado.campos }, 400);

  // Cambio de equipo: el jugador hereda la edición del equipo de destino y se
  // coloca al final de su plantilla. Se resuelve antes que los duplicados
  // porque la unicidad se comprueba en la edición a la que va a caer.
  let equipoDestino = actual.equipo_id;
  let edicionDestino: number | null | undefined;
  if (valores.equipoId !== undefined && valores.equipoId !== "") {
    const nuevo = Number(valores.equipoId);
    if (!Number.isInteger(nuevo) || nuevo <= 0) {
      return jsonAdmin({ error: "Revisa los campos marcados.", campos: { equipoId: "Elige un equipo." } }, 400);
    }
    if (nuevo !== actual.equipo_id) {
      const equipo = await env.DB
        .prepare("SELECT id, edicion_id FROM equipos WHERE id = ?1")
        .bind(nuevo)
        .first<{ id: number; edicion_id: number | null }>();
      if (!equipo) {
        return jsonAdmin({ error: "Ese equipo ya no existe.", campos: { equipoId: "Elige un equipo válido." } }, 400);
      }
      equipoDestino = nuevo;
      edicionDestino = equipo.edicion_id;
    }
  }

  const cambioDeEquipo = equipoDestino !== actual.equipo_id;

  // Mover al capitán a otro equipo dejaría a su equipo apuntando a alguien que
  // ya no está en la plantilla. Primero se cede el mando. Se comprueba antes
  // de duplicados y de subir la foto para no tener que deshacer nada si se
  // corta aquí.
  if (cambioDeEquipo && esCapitan) {
    return jsonAdmin(
      {
        error: "Es el capitán de su equipo. Nombra antes a otro capitán desde el editor del equipo.",
        campos: { equipoId: "No se puede mover al capitán." }
      },
      409
    );
  }

  const duplicados = await buscarDuplicados(
    env.DB,
    validado.jugador,
    jugadorId,
    edicionDestino !== undefined ? edicionDestino : actual.edicion_id
  );
  if (Object.keys(duplicados).length > 0) {
    return jsonAdmin({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409);
  }

  let claveNueva: string | null | undefined;
  if (foto) {
    if (!env.FOTOS) return jsonAdmin({ error: "No se ha podido guardar la foto." }, 500);
    claveNueva = `equipos/${crypto.randomUUID()}/jugador-1.${foto.ext}`;
    try {
      await subirFoto(env.FOTOS, claveNueva, foto.buffer, foto.ext);
    } catch (err) {
      console.error("Error subiendo la foto de un jugador:", err);
      return jsonAdmin({ error: "No se ha podido guardar la foto." }, 500);
    }
  } else if (eliminarFoto) {
    claveNueva = null;
  }

  const sets = [
    "nombre = ?1",
    "apellidos = ?2",
    "nombre_completo_normalizado = ?3",
    "telefono = ?4",
    "telefono_normalizado = ?5",
    "email = ?6",
    "email_normalizado = ?7",
    "red_social = ?8"
  ];
  const binds: (string | number | null)[] = [
    validado.jugador.nombre,
    validado.jugador.apellidos,
    validado.jugador.nombreCompletoNormalizado,
    validado.jugador.telefono,
    validado.jugador.telefonoNormalizado,
    validado.jugador.email,
    validado.jugador.emailNormalizado,
    validado.jugador.redSocial
  ];
  if (claveNueva !== undefined) {
    sets.push(`foto_key = ?${binds.length + 1}`);
    binds.push(claveNueva);
  }
  if (cambioDeEquipo) {
    sets.push(`equipo_id = ?${binds.length + 1}`);
    binds.push(equipoDestino);
    sets.push(`edicion_id = ?${binds.length + 1}`);
    binds.push(edicionDestino ?? null);
    sets.push(
      `orden = (SELECT COALESCE(MAX(orden), 0) + 1 FROM jugadores WHERE equipo_id = ?${binds.length - 1})`,
      `es_suplente = CASE WHEN (SELECT COUNT(*) FROM jugadores WHERE equipo_id = ?${binds.length - 1}) >= 2 THEN 1 ELSE 0 END`
    );
  }
  binds.push(jugadorId);

  try {
    await env.DB.prepare(`UPDATE jugadores SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
  } catch (err) {
    if (claveNueva) await limpiarFotos(env.FOTOS, [claveNueva]);
    console.error("Error actualizando un jugador desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido guardar el jugador." }, 500);
  }

  if (claveNueva !== undefined && actual.foto_key && actual.foto_key !== claveNueva) {
    await limpiarFotos(env.FOTOS, [actual.foto_key]);
  }

  return jsonAdmin({ ok: true, jugador: await cargarJugador(env.DB, jugadorId) });
};

// ------------------------------------------------------------------ borrado ---

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "jugadores.borrar");
  if (acceso instanceof Response) return acceso;

  const jugadorId = idDeQuery(new URL(request.url));
  if (jugadorId === null) return accionNoValida();

  const jugador = await env.DB
    .prepare("SELECT id, foto_key FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ id: number; foto_key: string | null }>();
  if (!jugador) return jsonAdmin({ error: "Ese jugador ya no existe." }, 404);

  const capitanea = await env.DB
    .prepare("SELECT id FROM equipos WHERE capitan_jugador_id = ?1")
    .bind(jugadorId)
    .first<{ id: number }>();
  if (capitanea) {
    return jsonAdmin(
      {
        error:
          "Es el capitán de su equipo. Nombra antes a otro capitán desde el editor del equipo y vuelve a intentarlo."
      },
      409
    );
  }

  try {
    await env.DB.prepare("DELETE FROM jugadores WHERE id = ?1").bind(jugadorId).run();
    if (jugador.foto_key) await limpiarFotos(env.FOTOS, [jugador.foto_key]);
    return jsonAdmin({ ok: true });
  } catch (err) {
    console.error("Error borrando un jugador desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido borrar el jugador." }, 500);
  }
};

// ------------------------------------------------------------------ helpers ---

async function cargarJugador(db: D1Database, id: number) {
  const fila = await db
    .prepare(
      `SELECT j.id, j.equipo_id, j.nombre, j.apellidos, j.telefono, j.email, j.red_social,
              j.foto_key, j.es_suplente, j.orden,
              e.nombre AS equipo_nombre, ed.anio AS edicion_anio
       FROM jugadores j
       LEFT JOIN equipos e ON e.id = j.equipo_id
       LEFT JOIN ediciones ed ON ed.id = j.edicion_id
       WHERE j.id = ?1`
    )
    .bind(id)
    .first<JugadorRow & { equipo_nombre: string | null; edicion_anio: number | null }>();
  if (!fila) return null;

  return {
    ...mapJugador(fila),
    equipoId: fila.equipo_id,
    equipoNombre: fila.equipo_nombre,
    edicionAnio: fila.edicion_anio
  };
}

interface FormularioJugador {
  campos: Record<string, string | undefined>;
  foto: { buffer: ArrayBuffer; ext: ExtensionFoto } | null;
  eliminarFoto: boolean;
}

/** Lee el multipart del formulario de jugador y valida la foto si viene. */
async function leerFormulario(request: Request): Promise<FormularioJugador | Response> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonAdmin({ error: "La petición es demasiado grande. La foto puede ocupar como máximo 4 MB." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonAdmin({ error: "El formulario debe enviarse como multipart/form-data." }, 400);
  }

  const campos: Record<string, string | undefined> = {};
  ["equipoId", "nombre", "apellidos", "telefono", "email", "redSocial"].forEach((clave) => {
    const valor = formData.get(clave);
    if (typeof valor === "string") campos[clave] = valor;
  });

  let foto: { buffer: ArrayBuffer; ext: ExtensionFoto } | null = null;
  const entrada = formData.get("foto");
  if (entrada instanceof File && entrada.size > 0) {
    const buffer = await entrada.arrayBuffer();
    const validada = validarFoto(buffer, entrada.type, entrada.size);
    if ("error" in validada) {
      return jsonAdmin({ error: "Revisa los campos marcados.", campos: { foto: validada.error } }, 400);
    }
    foto = { buffer, ext: validada.ext };
  }

  return { campos, foto, eliminarFoto: formData.get("eliminarFoto") === "1" };
}

interface JugadorSaneado {
  nombre: string;
  apellidos: string;
  nombreCompletoNormalizado: string;
  telefono: string;
  telefonoNormalizado: string;
  email: string | null;
  emailNormalizado: string | null;
  redSocial: string | null;
}

/**
 * Mismas reglas que validarRegistro() para un jugador suelto. No se reutiliza
 * aquélla porque exige un equipo entero con mínimo dos jugadores.
 */
function validarJugador(
  valores: Record<string, string | undefined>,
  opciones: { esCapitan?: boolean } = {}
): { jugador: JugadorSaneado } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};

  const nombre = capitalizarPropio(limpiar(valores.nombre));
  if (nombre.length < 2 || nombre.length > 60 || !NOMBRE_PATTERN.test(nombre)) {
    campos.nombre = "Introduce el nombre (solo letras, entre 2 y 60 caracteres).";
  }

  const apellidos = capitalizarPropio(limpiar(valores.apellidos));
  if (apellidos.length < 2 || apellidos.length > 80 || !NOMBRE_PATTERN.test(apellidos)) {
    campos.apellidos = "Introduce los apellidos (solo letras, entre 2 y 80 caracteres).";
  }

  // Móvil y correo solo son obligatorios para el capitán: es el contacto del
  // equipo y quien puede editarlo. Del resto, quien no los dé se queda fuera
  // del grupo y de los avisos, y eso ya se advierte en los formularios.
  const telefono = limpiar(valores.telefono);
  const telefonoNormalizado = telefono ? normalizarTelefono(telefono) : "";
  if (!telefono) {
    if (opciones.esCapitan) campos.telefono = MENSAJE_CAPITAN_CONTACTO;
  } else if (!MOVIL_PATTERN.test(telefonoNormalizado)) {
    campos.telefono = "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos).";
  }

  const emailRaw = limpiar(valores.email);
  if (!emailRaw) {
    if (opciones.esCapitan) campos.email = MENSAJE_CAPITAN_CONTACTO;
  } else if (!EMAIL_PATTERN.test(emailRaw) || emailRaw.length > 120) {
    campos.email = "Ese correo no parece válido.";
  }

  const redSocialRaw = limpiar(valores.redSocial);
  if (redSocialRaw && (redSocialRaw.length > 120 || !(HANDLE_PATTERN.test(redSocialRaw) || URL_SOCIAL_PATTERN.test(redSocialRaw)))) {
    campos.redSocial = "Usa un usuario tipo @nombre o un enlace https://.";
  }

  if (Object.keys(campos).length > 0) return { campos };

  return {
    jugador: {
      nombre,
      apellidos,
      nombreCompletoNormalizado: normalizarTexto(`${nombre} ${apellidos}`),
      telefono,
      telefonoNormalizado,
      email: emailRaw || null,
      emailNormalizado: emailRaw ? normalizarEmail(emailRaw) : null,
      redSocial: redSocialRaw || null
    }
  };
}

/**
 * Nombre, móvil y correo no se pueden repetir **dentro de una edición**
 * (migración 0010). `edicionId` es la del equipo de destino: al mover a alguien
 * de año, lo que manda es dónde va a caer.
 */
async function buscarDuplicados(
  db: D1Database,
  jugador: JugadorSaneado,
  excluirId: number | null,
  edicionId: number | null
): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};
  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (nombre_completo_normalizado = ?1
              OR (?2 <> '' AND telefono_normalizado = ?2)
              OR (?3 IS NOT NULL AND email_normalizado = ?3))
         AND id <> ?4 AND edicion_id IS ?5`
    )
    .bind(
      jugador.nombreCompletoNormalizado,
      jugador.telefonoNormalizado,
      jugador.emailNormalizado,
      excluirId ?? -1,
      edicionId
    )
    .all<{ nombre_completo_normalizado: string; telefono_normalizado: string; email_normalizado: string | null }>();

  results.forEach((fila) => {
    if (fila.nombre_completo_normalizado === jugador.nombreCompletoNormalizado) {
      campos.nombre = "Esta persona ya está inscrita en otro equipo.";
    }
    if (jugador.telefonoNormalizado && fila.telefono_normalizado === jugador.telefonoNormalizado) {
      campos.telefono = "Este móvil ya está registrado en otra inscripción.";
    }
    if (jugador.emailNormalizado && fila.email_normalizado === jugador.emailNormalizado) {
      campos.email = "Este correo ya está registrado en otra inscripción.";
    }
  });

  return campos;
}

async function normalizarNombres(db: D1Database): Promise<Response> {
  try {
    const { results } = await db.prepare("SELECT id, nombre, apellidos FROM jugadores").all<JugadorNombreRow>();
    const cambios = calcularNombresNormalizados(results);
    if (cambios.length > 0) {
      await db.batch(
        cambios.map((c) =>
          db.prepare("UPDATE jugadores SET nombre = ?1, apellidos = ?2 WHERE id = ?3").bind(c.nombre, c.apellidos, c.id)
        )
      );
    }
    return jsonAdmin({ ok: true, actualizados: cambios.length });
  } catch (err) {
    console.error("Error normalizando nombres desde el panel:", err);
    return jsonAdmin({ error: "No se han podido normalizar los nombres." }, 500);
  }
}
