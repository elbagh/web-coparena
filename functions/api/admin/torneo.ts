// /api/admin/torneo
//   GET                          el torneo entero de la edición actual
//   POST   ?accion=fase          crea una fase
//   PATCH  ?accion=fase&id=N     renombra una fase y cambia sus reglas
//   DELETE ?accion=fase&id=N     borra una fase (y con ella sus grupos y partidos)
//   POST   ?accion=grupo&fase=N  crea un grupo
//   PATCH  ?accion=grupo&id=N
//   DELETE ?accion=grupo&id=N
//   POST   ?accion=asignar&grupo=N   mete un equipo en un grupo
//   DELETE ?accion=asignar&grupo=N&equipo=M
//   POST   ?accion=generar-liga&fase=N     calendario de todos los grupos
//   POST   ?accion=generar-cuadro&fase=N   esqueleto de la eliminatoria
//   POST   ?accion=sembrar&fase=N          coloca a los clasificados en el cuadro
//
// La clasificación no se guarda: se calcula aquí a partir de los partidos
// terminados cada vez que se pide. Guardarla obligaría a mantenerla en sintonía
// con los resultados, y corregir un marcador viejo dejaría una tabla mintiendo.

import { requirePermiso, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { CRITERIOS, normalizarReglas, validarReglas } from "../../_lib/reglas";
import { cargarTorneo } from "../../_lib/torneo-vista";
import {
  generarEliminatoria,
  generarLiga,
  sembrarEliminatoria,
  tamanoDeCuadroValido,
  type FaseRow,
  type GrupoRow
} from "../../_lib/torneo";
import { limpiar } from "../../_lib/validacion";

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "torneo.ver");
  if (acceso instanceof Response) return acceso;

  try {
    const edicion = await env.DB
      .prepare("SELECT id, anio, nombre FROM ediciones WHERE es_actual = 1")
      .first<{ id: number; anio: number; nombre: string }>();
    if (!edicion) return jsonAdmin({ edicion: null, fases: [], equipos: [], criterios: CRITERIOS });

    return jsonAdmin({ edicion, ...(await cargarTorneo(env.DB, edicion.id)), criterios: CRITERIOS });
  } catch (err) {
    console.error("Error leyendo el torneo:", err);
    return jsonAdmin({ error: "No se ha podido cargar el torneo." }, 500);
  }
};

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "torneo.editar");
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const accion = url.searchParams.get("accion") || "";
  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;

  try {
    switch (accion) {
      case "fase":
        return await crearFase(env.DB, body);
      case "grupo":
        return await crearGrupo(env.DB, url, body);
      case "asignar":
        return await asignarEquipo(env.DB, url, body);
      case "generar-liga":
        return await accionGenerarLiga(env.DB, url);
      case "generar-cuadro":
        return await accionGenerarCuadro(env.DB, url, body);
      case "sembrar":
        return await accionSembrar(env.DB, url, body);
      default:
        return accionNoValida();
    }
  } catch (err) {
    console.error(`Error en el torneo (${accion}):`, err);
    return jsonAdmin({ error: "No se ha podido guardar el cambio." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "torneo.editar");
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const accion = url.searchParams.get("accion") || "";
  const id = idDeQuery(url);
  if (id === null) return accionNoValida();
  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;

  try {
    if (accion === "fase") return await editarFase(env.DB, id, body);
    if (accion === "grupo") return await editarGrupo(env.DB, id, body);
    return accionNoValida();
  } catch (err) {
    console.error(`Error editando el torneo (${accion}):`, err);
    return jsonAdmin({ error: "No se ha podido guardar el cambio." }, 500);
  }
};

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "torneo.editar");
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const accion = url.searchParams.get("accion") || "";

  try {
    if (accion === "asignar") {
      const grupoId = idDeQuery(url, "grupo");
      const equipoId = idDeQuery(url, "equipo");
      if (grupoId === null || equipoId === null) return accionNoValida();
      await env.DB
        .prepare("DELETE FROM torneo_grupo_equipos WHERE grupo_id = ?1 AND equipo_id = ?2")
        .bind(grupoId, equipoId)
        .run();
      return await respuesta(env.DB);
    }

    const id = idDeQuery(url);
    if (id === null) return accionNoValida();

    if (accion === "fase") {
      /*
       * Los partidos apuntan a la fase con ON DELETE por defecto (ninguno), así
       * que hay que soltarlos a mano antes. Se borran en vez de quedar sueltos:
       * un cruce de una fase que ya no existe no significa nada, y dejarlo
       * ensuciaría el cuadro público.
       */
      await env.DB.batch([
        env.DB.prepare("DELETE FROM partidos WHERE fase_id = ?1").bind(id),
        env.DB.prepare("DELETE FROM torneo_fases WHERE id = ?1").bind(id)
      ]);
      return await respuesta(env.DB);
    }

    if (accion === "grupo") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM partidos WHERE grupo_id = ?1").bind(id),
        env.DB.prepare("DELETE FROM torneo_grupos WHERE id = ?1").bind(id)
      ]);
      return await respuesta(env.DB);
    }

    return accionNoValida();
  } catch (err) {
    console.error(`Error borrando en el torneo (${accion}):`, err);
    return jsonAdmin({ error: "No se ha podido borrar." }, 500);
  }
};

// --------------------------------------------------------------- lectura ---

const respuesta = async (db: D1Database, status = 200) => {
  const edicion = await db.prepare("SELECT id, anio, nombre FROM ediciones WHERE es_actual = 1").first<{
    id: number;
    anio: number;
    nombre: string;
  }>();
  if (!edicion) return jsonAdmin({ edicion: null, fases: [], equipos: [], criterios: CRITERIOS }, status);
  return jsonAdmin({ ok: true, edicion, ...(await cargarTorneo(db, edicion.id)), criterios: CRITERIOS }, status);
};

// -------------------------------------------------------------- escritura ---

async function crearFase(db: D1Database, body: Record<string, unknown>): Promise<Response> {
  const datos = validarFase(body);
  if ("campos" in datos) return jsonAdmin({ error: "Revisa los campos marcados.", campos: datos.campos }, 400);

  const edicion = await db.prepare("SELECT id FROM ediciones WHERE es_actual = 1").first<{ id: number }>();
  if (!edicion) return jsonAdmin({ error: "No hay ninguna edición en juego." }, 409);

  const existe = await db
    .prepare("SELECT id FROM torneo_fases WHERE edicion_id = ?1 AND clave = ?2")
    .bind(edicion.id, datos.clave)
    .first();
  if (existe) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { clave: "Ya hay una fase con esa clave." } }, 409);
  }

  await db
    .prepare(
      `INSERT INTO torneo_fases (edicion_id, clave, nombre, tipo, orden, reglas, clasifican)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(edicion.id, datos.clave, datos.nombre, datos.tipo, datos.orden, JSON.stringify(datos.reglas), datos.clasifican)
    .run();

  return await respuesta(db, 201);
}

async function editarFase(db: D1Database, id: number, body: Record<string, unknown>): Promise<Response> {
  const fase = await db.prepare("SELECT * FROM torneo_fases WHERE id = ?1").bind(id).first<FaseRow>();
  if (!fase) return jsonAdmin({ error: "Esa fase ya no existe." }, 404);

  // La clave identifica la fase y la citan los partidos ya creados: no se cambia.
  const datos = validarFase({ ...body, clave: fase.clave, tipo: body.tipo ?? fase.tipo });
  if ("campos" in datos) return jsonAdmin({ error: "Revisa los campos marcados.", campos: datos.campos }, 400);

  await db
    .prepare(
      `UPDATE torneo_fases SET nombre = ?1, tipo = ?2, orden = ?3, reglas = ?4, clasifican = ?5,
              updated_at = datetime('now')
       WHERE id = ?6`
    )
    .bind(datos.nombre, datos.tipo, datos.orden, JSON.stringify(datos.reglas), datos.clasifican, id)
    .run();

  return await respuesta(db);
}

async function crearGrupo(db: D1Database, url: URL, body: Record<string, unknown>): Promise<Response> {
  const faseId = idDeQuery(url, "fase");
  if (faseId === null) return accionNoValida();

  const fase = await db.prepare("SELECT id FROM torneo_fases WHERE id = ?1").bind(faseId).first();
  if (!fase) return jsonAdmin({ error: "Esa fase ya no existe." }, 404);

  const nombre = limpiar(body.nombre);
  if (nombre.length < 1 || nombre.length > 40) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { nombre: "Escribe entre 1 y 40 caracteres." } }, 400);
  }

  const reglas = leerReglasOpcionales(body);
  if (reglas instanceof Response) return reglas;

  const repetido = await db
    .prepare("SELECT id FROM torneo_grupos WHERE fase_id = ?1 AND nombre = ?2")
    .bind(faseId, nombre)
    .first();
  if (repetido) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { nombre: "Ya hay un grupo con ese nombre." } }, 409);
  }

  await db
    .prepare("INSERT INTO torneo_grupos (fase_id, nombre, orden, reglas) VALUES (?1, ?2, ?3, ?4)")
    .bind(faseId, nombre, Number(body.orden) || 0, reglas)
    .run();

  return await respuesta(db, 201);
}

async function editarGrupo(db: D1Database, id: number, body: Record<string, unknown>): Promise<Response> {
  const grupo = await db.prepare("SELECT id FROM torneo_grupos WHERE id = ?1").bind(id).first();
  if (!grupo) return jsonAdmin({ error: "Ese grupo ya no existe." }, 404);

  const nombre = limpiar(body.nombre);
  if (nombre.length < 1 || nombre.length > 40) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { nombre: "Escribe entre 1 y 40 caracteres." } }, 400);
  }

  const reglas = leerReglasOpcionales(body);
  if (reglas instanceof Response) return reglas;

  await db
    .prepare("UPDATE torneo_grupos SET nombre = ?1, orden = ?2, reglas = ?3, updated_at = datetime('now') WHERE id = ?4")
    .bind(nombre, Number(body.orden) || 0, reglas, id)
    .run();

  return await respuesta(db);
}

async function asignarEquipo(db: D1Database, url: URL, body: Record<string, unknown>): Promise<Response> {
  const grupoId = idDeQuery(url, "grupo");
  const equipoId = Number(body.equipoId);
  if (grupoId === null || !Number.isInteger(equipoId) || equipoId <= 0) return accionNoValida();

  const grupo = await db
    .prepare("SELECT id, fase_id FROM torneo_grupos WHERE id = ?1")
    .bind(grupoId)
    .first<{ id: number; fase_id: number }>();
  if (!grupo) return jsonAdmin({ error: "Ese grupo ya no existe." }, 404);

  const equipo = await db.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first();
  if (!equipo) return jsonAdmin({ error: "Ese equipo ya no existe." }, 404);

  /*
   * El índice UNIQUE (fase_id, equipo_id) lo impediría de todos modos, pero
   * comprobarlo aquí permite decir en qué grupo está ya en vez de devolver un
   * error de base ilegible.
   */
  const yaEnLaFase = await db
    .prepare(
      `SELECT g.nombre FROM torneo_grupo_equipos ge
         JOIN torneo_grupos g ON g.id = ge.grupo_id
        WHERE ge.fase_id = ?1 AND ge.equipo_id = ?2`
    )
    .bind(grupo.fase_id, equipoId)
    .first<{ nombre: string }>();
  if (yaEnLaFase) {
    return jsonAdmin({ error: `Ese equipo ya está en «${yaEnLaFase.nombre}» dentro de esta fase.` }, 409);
  }

  await db
    .prepare("INSERT INTO torneo_grupo_equipos (grupo_id, fase_id, equipo_id) VALUES (?1, ?2, ?3)")
    .bind(grupoId, grupo.fase_id, equipoId)
    .run();

  return await respuesta(db, 201);
}

async function accionGenerarLiga(db: D1Database, url: URL): Promise<Response> {
  const faseId = idDeQuery(url, "fase");
  if (faseId === null) return accionNoValida();

  const fase = await db.prepare("SELECT * FROM torneo_fases WHERE id = ?1").bind(faseId).first<FaseRow>();
  if (!fase) return jsonAdmin({ error: "Esa fase ya no existe." }, 404);
  if (fase.tipo !== "grupos") return jsonAdmin({ error: "El calendario de liga es para una fase de grupos." }, 409);

  const grupos = await db
    .prepare("SELECT * FROM torneo_grupos WHERE fase_id = ?1 ORDER BY orden ASC, id ASC")
    .bind(faseId)
    .all<GrupoRow>();

  const conEquipos = [];
  for (const grupo of grupos.results) {
    const { results } = await db
      .prepare(
        `SELECT e.id, e.nombre FROM torneo_grupo_equipos ge
           JOIN equipos e ON e.id = ge.equipo_id
          WHERE ge.grupo_id = ?1 ORDER BY ge.orden ASC, e.nombre COLLATE NOCASE ASC`
      )
      .bind(grupo.id)
      .all<{ id: number; nombre: string }>();
    conEquipos.push({ grupo, equipos: results });
  }

  const { creados } = await generarLiga(db, fase, conEquipos);
  if (creados === 0) {
    return jsonAdmin({ error: "No hay grupos con al menos dos equipos: no sale ningún cruce." }, 409);
  }
  return await respuesta(db, 201);
}

async function accionGenerarCuadro(db: D1Database, url: URL, body: Record<string, unknown>): Promise<Response> {
  const faseId = idDeQuery(url, "fase");
  if (faseId === null) return accionNoValida();

  const fase = await db.prepare("SELECT * FROM torneo_fases WHERE id = ?1").bind(faseId).first<FaseRow>();
  if (!fase) return jsonAdmin({ error: "Esa fase ya no existe." }, 404);
  if (fase.tipo !== "eliminatoria") return jsonAdmin({ error: "El cuadro es para una fase eliminatoria." }, 409);

  const tamano = Number(body.tamano);
  if (!tamanoDeCuadroValido(tamano)) {
    return jsonAdmin(
      {
        error: "Revisa los campos marcados.",
        campos: { tamano: "El cuadro tiene que ser de 2, 4, 8, 16, 32 o 64 equipos." }
      },
      400
    );
  }

  const { creados } = await generarEliminatoria(db, fase, tamano, body.tercerPuesto === true);
  return await respuesta(db, creados > 0 ? 201 : 200);
}

async function accionSembrar(db: D1Database, url: URL, body: Record<string, unknown>): Promise<Response> {
  const faseId = idDeQuery(url, "fase");
  const desdeId = Number(body.desdeFase);
  if (faseId === null || !Number.isInteger(desdeId) || desdeId <= 0) return accionNoValida();

  const [fase, desde] = await Promise.all([
    db.prepare("SELECT * FROM torneo_fases WHERE id = ?1").bind(faseId).first<FaseRow>(),
    db.prepare("SELECT * FROM torneo_fases WHERE id = ?1").bind(desdeId).first<FaseRow>()
  ]);
  if (!fase || !desde) return jsonAdmin({ error: "Esa fase ya no existe." }, 404);
  if (fase.tipo !== "eliminatoria") return jsonAdmin({ error: "Solo se siembra una fase eliminatoria." }, 409);
  if (desde.clasifican < 1) {
    return jsonAdmin({ error: "La fase de origen no dice cuántos equipos clasifican." }, 409);
  }

  const { fases } = await cargarTorneo(db, fase.edicion_id);
  const origen = fases.find((f) => f.id === desdeId);
  if (!origen || origen.grupos.length === 0) {
    return jsonAdmin({ error: "La fase de origen no tiene grupos con clasificación." }, 409);
  }

  /*
   * Se siembra por posición y no grupo a grupo: primero todos los primeros, luego
   * todos los segundos. Así el emparejamiento 1.º contra último cruza cabezas de
   * serie con colistas, que es lo que hace que un cuadro tenga sentido.
   */
  const semillas: { equipoId: number; nombre: string }[] = [];
  for (let posicion = 1; posicion <= desde.clasifican; posicion += 1) {
    for (const grupo of origen.grupos) {
      const fila = grupo.clasificacion.find((f) => f.posicion === posicion);
      if (fila) semillas.push({ equipoId: fila.equipoId, nombre: fila.nombre });
    }
  }

  if (semillas.length === 0) return jsonAdmin({ error: "No hay ningún equipo clasificado todavía." }, 409);

  await sembrarEliminatoria(db, faseId, semillas);
  return await respuesta(db);
}

// -------------------------------------------------------------- validación ---

interface FaseValidada {
  clave: string;
  nombre: string;
  tipo: "grupos" | "eliminatoria";
  orden: number;
  clasifican: number;
  reglas: ReturnType<typeof normalizarReglas>;
}

function validarFase(body: Record<string, unknown>): FaseValidada | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};

  const clave = limpiar(body.clave).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(clave)) {
    campos.clave = "Entre 2 y 40 caracteres: minúsculas, números y guiones.";
  }

  const nombre = limpiar(body.nombre);
  if (nombre.length < 2 || nombre.length > 60) campos.nombre = "Escribe entre 2 y 60 caracteres.";

  const tipo = String(body.tipo || "");
  if (tipo !== "grupos" && tipo !== "eliminatoria") campos.tipo = "Elige grupos o eliminatoria.";

  const clasifican = Number(body.clasifican ?? 0);
  if (!Number.isInteger(clasifican) || clasifican < 0 || clasifican > 8) {
    campos.clasifican = "Tiene que estar entre 0 y 8.";
  }

  const reglasValidadas = validarReglas(body.reglas ?? {});
  if ("campos" in reglasValidadas) Object.assign(campos, reglasValidadas.campos);

  if (Object.keys(campos).length > 0) return { campos };
  return {
    clave,
    nombre,
    tipo: tipo as "grupos" | "eliminatoria",
    orden: Number(body.orden) || 0,
    clasifican,
    reglas: (reglasValidadas as { reglas: ReturnType<typeof normalizarReglas> }).reglas
  };
}

/** El grupo puede no traer reglas: entonces hereda, y se guarda NULL. */
function leerReglasOpcionales(body: Record<string, unknown>): string | null | Response {
  if (body.reglas === undefined || body.reglas === null) return null;
  const validadas = validarReglas(body.reglas);
  if ("campos" in validadas) return jsonAdmin({ error: "Revisa los campos marcados.", campos: validadas.campos }, 400);
  return JSON.stringify(validadas.reglas);
}
