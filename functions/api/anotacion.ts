// /api/anotacion?partido=ID
//   GET   estado del partido, alineación y log
//   POST  { accion: "evento" | "deshacer" | "corregir" | "alineacion" | "cambio"
//           | "cambio-deshacer" | "adoptar" | "soltar" | "relevo" | "directo" | "cronometro" }
//
// Vive fuera de functions/api/admin/ a propósito: tiene otro permiso
// (`partidos.anotar`), otro público (quien está a pie de pista con el móvil) y
// otra cadencia. Un anotador no entra al panel de administración.
//
// Corregir un partido que ya terminó exige `partidos.editar`, no solo
// `partidos.anotar`: rehacer un resultado cerrado ya no es anotar, es enmendar.

import { jsonAdmin, requireAlgunPermiso, requirePermiso, type AdminEnv } from "../_lib/admin";
import {
  ErrorDeAnotacion,
  MarcadorSinAdoptar,
  PartidoDeOtroAnotador,
  adoptarMarcador,
  corregirEvento,
  deshacerCambio,
  deshacerUltimo,
  fijarAlineacion,
  hayMarcadorAMano,
  leerAlineacion,
  leerCambios,
  leerEstado,
  marcadorPlano,
  moverCronometro,
  ponerEnDirecto,
  reclamarPartido,
  recalcularPartido,
  registrarCambio,
  registrarEvento,
  soltarAnotacion,
  validarEvento,
  type PartidoAnotable,
  type ResultadoAnotacion
} from "../_lib/eventos";
import { AVATAR_DEL_JUGADOR } from "../_lib/fotos";
import { atributosPorJugador, mediaAtributos, NIVEL_POR_DEFECTO } from "../_lib/perfil";
import { TIPOS, type TipoEvento } from "../_lib/marcador";
import { normalizarReglas } from "../_lib/reglas";
import { propagarResultado, sincronizarCuadro } from "../_lib/torneo";

/**
 * Tope de gente en pista por lado. No es una regla del volley: es que D1 corta
 * en 100 parámetros por consulta, y el `IN (...)` que comprueba de qué equipo es
 * cada uno se construye con tantos huecos como ids lleguen. Con una lista larga
 * la consulta reventaba y el fallo del motor salía por el catch-all como si
 * fuera un aviso para el anotador.
 */
const MAXIMO_EN_PISTA = 30;

/*
 * El nombre de quien lleva el partido viaja con la propia fila, no en una
 * consulta aparte: esta carga la hace cada punto anotado.
 */
const SELECT_PARTIDO = `SELECT p.id, p.status, p.origen_marcador, p.equipo_a_id, p.equipo_b_id,
                               p.points_a, p.points_b, p.sets_a, p.sets_b, p.reglas, p.started_at,
                               p.elapsed_ms, p.updated_at, p.anotador_usuario_id,
                               u.nombre AS anotador_nombre, u.email AS anotador_email
                          FROM partidos p
                          LEFT JOIN usuarios u ON u.id = p.anotador_usuario_id
                         WHERE p.id = ?1`;

/**
 * La fila que devuelve `SELECT_PARTIDO`, con quién lleva la anotación.
 *
 * `anotador_usuario_id` vive aquí y no en `PartidoAnotable` porque este tipo es
 * el único que garantiza el `SELECT` con la columna. En la interfaz compartida,
 * un segundo cargador que la omitiera daría `undefined`: ni el usuario ni
 * `null`, así que `asegurarReclamo` rechazaría a todo el mundo con un dueño sin
 * id ni nombre.
 */
export type PartidoConAnotador = PartidoAnotable & {
  updated_at: string;
  /** Quién lleva la anotación, o `null` si no la lleva nadie. */
  anotador_usuario_id: number | null;
  anotador_nombre: string | null;
  anotador_email: string | null;
};

const idDelPartido = (url: URL) => url.searchParams.get("partido") || "";

async function cargarPartido(db: D1Database, id: string): Promise<PartidoConAnotador | null> {
  if (!id) return null;
  return await db.prepare(SELECT_PARTIDO).bind(id).first<PartidoConAnotador>();
}

/**
 * Los dos equipos con su nombre y su plantilla, para elegir quién sale a pista.
 *
 * Trae dorsal, metal y nota porque la pista del anotador pinta el retrato de
 * cada uno, el mismo que ve el público. Aquí **no** se aplica `oculto_publico`:
 * eso saca a alguien del álbum, no de la pantalla de quien tiene que atribuirle
 * los puntos.
 */
async function plantillas(db: D1Database, partido: PartidoAnotable) {
  const vacio = { A: { nombre: "Equipo A", jugadores: [] }, B: { nombre: "Equipo B", jugadores: [] } };
  const ids = [partido.equipo_a_id, partido.equipo_b_id].filter((id): id is number => id !== null);
  if (ids.length === 0) return vacio;

  const { results } = await db
    .prepare(
      `SELECT j.id, j.equipo_id, j.nombre, j.apellidos, j.dorsal, j.nivel, j.es_suplente,
              j.foto_key, p.avatar_key
         FROM jugadores j
         ${AVATAR_DEL_JUGADOR}
        WHERE j.equipo_id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})
        ORDER BY j.es_suplente ASC, j.orden ASC, j.id ASC`
    )
    .bind(...ids)
    .all<{
      id: number;
      equipo_id: number;
      nombre: string;
      apellidos: string;
      dorsal: number | null;
      nivel: string | null;
      es_suplente: number;
      foto_key: string | null;
      avatar_key: string | null;
    }>();

  const atributos = await atributosPorJugador(db, results.map((jugador) => jugador.id));

  // El nombre congelado del partido es el que vale: es el que se ve en el cuadro.
  const fila = await db
    .prepare("SELECT equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre FROM partidos WHERE id = ?1")
    .bind(partido.id)
    .first<{ equipo_a_id: number | null; equipo_b_id: number | null; equipo_a_nombre: string; equipo_b_nombre: string }>();
  const nombres = new Map<number, string>();
  if (fila?.equipo_a_id) nombres.set(fila.equipo_a_id, fila.equipo_a_nombre);
  if (fila?.equipo_b_id) nombres.set(fila.equipo_b_id, fila.equipo_b_nombre);

  const mapear = (equipoId: number | null, porDefecto: string) => ({
    nombre: (equipoId === null ? null : nombres.get(equipoId)) ?? porDefecto,
    jugadores:
      equipoId === null
        ? []
        : results
            .filter((jugador) => jugador.equipo_id === equipoId)
            .map((jugador) => ({
              id: jugador.id,
              nombre: jugador.nombre,
              apellidos: jugador.apellidos,
              dorsal: jugador.dorsal,
              nivel: jugador.nivel ?? NIVEL_POR_DEFECTO,
              media: mediaAtributos(atributos.get(jugador.id)),
              tieneFoto: Boolean(jugador.foto_key || jugador.avatar_key),
              esSuplente: jugador.es_suplente === 1
            }))
  });

  return { A: mapear(partido.equipo_a_id, "Equipo A"), B: mapear(partido.equipo_b_id, "Equipo B") };
}

/**
 * La respuesta completa de la pantalla.
 *
 * `yaLeido` es el estado que acaba de calcular la escritura. Sin él, cada punto
 * anotado pagaba DOS veces el mismo trabajo: `registrarEvento` termina llamando
 * a `leerEstado` y devolviendo el resultado, y aquí se tiraba para volver a
 * leer el log y a plegarlo. Es el camino que más se recorre del sitio —una vez
 * por punto de cada partido de la jornada— y el que más crece con lo ya
 * anotado, porque lee el log entero.
 */
async function respuesta(
  db: D1Database,
  partido: PartidoAnotable,
  usuarioId: number,
  status = 200,
  yaLeido?: ResultadoAnotacion
): Promise<Response> {
  const fresco = (await cargarPartido(db, partido.id))!;
  const [estado, alineacion, equipos, cambios] = await Promise.all([
    yaLeido ? Promise.resolve(yaLeido) : leerEstado(db, fresco),
    leerAlineacion(db, fresco.id),
    plantillas(db, fresco),
    leerCambios(db, fresco.id)
  ]);

  return jsonAdmin(
    {
      partido: {
        id: fresco.id,
        status: fresco.status,
        origenMarcador: fresco.origen_marcador,
        reglas: normalizarReglas(fresco.reglas).partido,
        startedAt: fresco.started_at,
        // El acumulado viaja para que el navegador pueda pintar el reloj: el
        // servidor manda el ancla, no el número que se ve girar. Sin él,
        // `elapsed()` de match-utils devuelve 0 en un partido pausado o
        // terminado —justo cuando el reloj deja de correr solo y todo el
        // tiempo vive en esta columna— y la pantalla se despedía marcando
        // 00:00 tras cuarenta minutos de juego.
        elapsedMs: fresco.elapsed_ms
      },
      ...estado,
      /*
       * El marcador de las columnas planas viaja SIEMPRE, aparte del plegado.
       * Sin él, la pantalla no podía enseñar el 8–6 de un partido llevado a mano
       * —el pliegue de un log vacío es 0–0— y ofrecía adoptar un marcador que no
       * sabía que existía. `pendienteDeAdoptar` es la misma condición que usa el
       * cerrojo del servidor, resuelta aquí para que cliente y servidor no
       * puedan discrepar sobre cuándo hay que decidir.
       */
      marcadorPanel: marcadorPlano(fresco),
      pendienteDeAdoptar: hayMarcadorAMano(fresco, estado.estado),
      /*
       * `puedeAnotar`, no `esMio`. Se separan justo en el caso más frecuente al
       * abrir un partido: todavía no lo lleva nadie. Con «es mío» ese estado
       * sería `false` y la pantalla arrancaría en modo lectura pidiendo un
       * relevo a nadie.
       */
      anotador: {
        id: fresco.anotador_usuario_id,
        nombre:
          fresco.anotador_usuario_id === null ? null : fresco.anotador_nombre || fresco.anotador_email,
        puedeAnotar: fresco.anotador_usuario_id === null || fresco.anotador_usuario_id === usuarioId
      },
      // La última escritura sobre el partido, sea de quien sea: el relevo no la
      // mueve y soltar sí. No es «el último punto de quien lo lleva», así que la
      // banda del relevo tampoco lo dice.
      ultimaActividad: fresco.updated_at,
      alineacion,
      // Los cambios no son eventos del log: viajan aparte y el cliente los
      // mezcla con los puntos por `trasOrden` para pintar el historial.
      cambios: cambios.map((cambio) => ({
        id: cambio.id,
        trasOrden: cambio.tras_orden,
        lado: cambio.lado,
        entra: cambio.entra_jugador_id,
        sale: cambio.sale_jugador_id,
        setNumero: cambio.set_numero
      })),
      equipos,
      tipos: TIPOS
    },
    status
  );
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requireAlgunPermiso(request, env, ["partidos.anotar", "partidos.editar"]);
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const id = idDelPartido(url);

  try {
    // Sin partido concreto, la lista de lo que hay que anotar hoy.
    if (!id) return jsonAdmin({ partidos: await partidosDeHoy(env.DB, acceso.user.id) });

    const partido = await cargarPartido(env.DB, id);
    if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);
    return await respuesta(env.DB, partido, acceso.user.id);
  } catch (err) {
    console.error("Error leyendo la anotación:", err);
    return jsonAdmin({ error: "No se ha podido cargar el partido." }, 500);
  }
};

/**
 * Lo que se juega o se va a jugar en la edición actual, para elegir.
 *
 * Recibe `usuarioId` para poder decir `puedeAnotar` en cada fila: sin él, la
 * nota «Lo lleva…» se pintaba también en la propia tarjeta de quien pregunta
 * — el aviso que existe para avisar de un dueño *distinto* se lo decía a su
 * propio dueño.
 */
async function partidosDeHoy(db: D1Database, usuarioId: number) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.ronda, p.pista, p.status, p.origen_marcador, p.scheduled_at,
              p.equipo_a_nombre, p.equipo_b_nombre, p.points_a, p.points_b, p.sets_a, p.sets_b,
              p.anotador_usuario_id, u.nombre AS anotador_nombre, u.email AS anotador_email
         FROM partidos p
         LEFT JOIN usuarios u ON u.id = p.anotador_usuario_id
        WHERE p.edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
          AND p.status <> 'finished'
        ORDER BY (p.status = 'live') DESC, COALESCE(p.scheduled_at, '9999'), p.sort_order ASC`
    )
    .all<Record<string, unknown>>();

  return results.map((fila) => ({
    id: fila.id,
    ronda: fila.ronda,
    pista: fila.pista,
    status: fila.status,
    origenMarcador: fila.origen_marcador,
    scheduledAt: fila.scheduled_at,
    teams: { A: { name: fila.equipo_a_nombre }, B: { name: fila.equipo_b_nombre } },
    points: { A: fila.points_a, B: fila.points_b },
    sets: { A: fila.sets_a, B: fila.sets_b },
    anotador:
      fila.anotador_usuario_id === null
        ? null
        : {
            id: fila.anotador_usuario_id,
            nombre: fila.anotador_nombre || fila.anotador_email,
            puedeAnotar: fila.anotador_usuario_id === usuarioId
          }
  }));
}

/**
 * Deja el partido reclamado por quien escribe, o dice quién lo lleva.
 *
 * Devuelve `null` cuando quien pregunta puede anotar, y el dueño cuando es otra
 * persona. El orden de las ramas es el coste: el camino que se recorre en cada
 * punto —ya es suyo— no gasta ninguna consulta extra, y la fila con el nombre ya
 * viene cargada, así que rechazar tampoco gasta ninguna. Sólo paga el caso raro,
 * que es perder el CAS.
 */
async function asegurarReclamo(
  db: D1Database,
  partido: PartidoConAnotador,
  usuarioId: number
): Promise<{ id: number; nombre: string | null } | null> {
  if (partido.anotador_usuario_id === usuarioId) return null;

  if (partido.anotador_usuario_id !== null) {
    return { id: partido.anotador_usuario_id, nombre: partido.anotador_nombre || partido.anotador_email };
  }

  if (await reclamarPartido(db, partido.id, usuarioId)) return null;

  // El CAS perdió: alguien lo reclamó entre la carga de la fila y este momento.
  const relectura = () =>
    db
      .prepare(
        `SELECT p.anotador_usuario_id AS id, u.nombre, u.email
           FROM partidos p LEFT JOIN usuarios u ON u.id = p.anotador_usuario_id
          WHERE p.id = ?1`
      )
      .bind(partido.id)
      .first<{ id: number | null; nombre: string | null; email: string | null }>();

  let fila = await relectura();

  /*
   * Entre perder el CAS y esta relectura, quien lo tenía puede haberlo
   * soltado (`soltarAnotacion` pone la columna a NULL): la fila vuelve a
   * enseñar libre sin que este usuario la haya reclamado de verdad. Sin este
   * segundo intento, la petición seguiría adelante sobre un partido sin
   * dueño en la base. Un solo reintento no es un cerrojo, pero cierra la
   * ventana salvo que se suelte dos veces seguidas en el mismo instante.
   */
  if (fila && fila.id === null) {
    if (await reclamarPartido(db, partido.id, usuarioId)) return null;
    fila = await relectura();
  }

  if (!fila || fila.id === null || fila.id === usuarioId) return null;
  return { id: fila.id, nombre: fila.nombre || fila.email };
}

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requireAlgunPermiso(request, env, ["partidos.anotar", "partidos.editar"]);
  if (acceso instanceof Response) return acceso;

  const url = new URL(request.url);
  const partido = await cargarPartido(env.DB, idDelPartido(url));
  if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const accion = String(body.accion || "");

  /*
   * Rehacer un partido cerrado ya no es anotar. Quien solo tiene
   * `partidos.anotar` lleva el marcador de lo que se está jugando; enmendar un
   * resultado terminado es otra cosa y pide el permiso de edición.
   */
  if (partido.status === "finished" && accion !== "soltar") {
    const edicion = await requirePermiso(request, env, "partidos.editar");
    if (edicion instanceof Response) {
      return jsonAdmin({ error: "Este partido ya ha terminado. Corregirlo necesita permiso de edición." }, 403);
    }
  }

  /*
   * La puerta del reclamo. Una sola, aquí, y no repartida por las funciones de
   * `_lib`: el mismo criterio que el bloqueo de «ver como», que vive sólo en
   * `_middleware.ts`. Repartirla sería escribirla siete veces y olvidarla en la
   * octava.
   *
   * Va después de la comprobación de permiso porque son preguntas distintas:
   * primero quién eres, que no depende del partido; luego si este partido es
   * tuyo. De ahí que tomar el relevo de un partido terminado herede la exigencia
   * de `partidos.editar`, que es lo coherente: enmendar un resultado cerrado ya
   * la pedía.
   *
   * `relevo` es la salida, así que no pasa por aquí. `soltar` sí: quien no lo
   * lleva toma el relevo primero, porque si no sería una puerta trasera para
   * quitarle el partido a otro sin que quede dicho.
   */
  if (accion !== "relevo") {
    const otro = await asegurarReclamo(env.DB, partido, acceso.user.id);
    if (otro) {
      return jsonAdmin({ error: new PartidoDeOtroAnotador(otro).message, anotador: otro }, 409);
    }
  }

  try {
    switch (accion) {
      case "evento":
        return await accionEvento(env.DB, partido, body, acceso.user.id);
      case "deshacer":
        return await accionDeshacer(env.DB, partido, body, acceso.user.id);
      case "corregir":
        return await accionCorregir(env.DB, partido, body, acceso.user.id);
      case "alineacion":
        return await accionAlineacion(env.DB, partido, body, acceso.user.id);
      case "cambio":
        return await accionCambio(env.DB, partido, body, acceso.user.id);
      case "cambio-deshacer":
        await deshacerCambio(env.DB, partido);
        return await respuesta(env.DB, partido, acceso.user.id);
      case "adoptar":
        return await accionAdoptar(env.DB, partido, acceso.user.id, body.desdeCero === true);
      case "soltar":
        await soltarAnotacion(env.DB, partido.id);
        return await respuesta(env.DB, partido, acceso.user.id);
      case "relevo":
        return await accionRelevo(env.DB, partido, acceso.user.id);
      case "directo":
        await ponerEnDirecto(env.DB, partido);
        return await respuesta(env.DB, partido, acceso.user.id);
      case "cronometro":
        await moverCronometro(env.DB, partido, body.marcha === true);
        return await respuesta(env.DB, partido, acceso.user.id);
      default:
        return jsonAdmin({ error: "La acción no es válida." }, 400);
    }
  } catch (err) {
    // Lleva el marcador de a mano en el cuerpo: la pantalla lo necesita para
    // poder decir «va 8–6» y ofrecer las dos salidas.
    if (err instanceof MarcadorSinAdoptar) {
      return jsonAdmin({ error: err.message, marcadorPanel: err.marcadorPanel, pendienteDeAdoptar: true }, 409);
    }
    /*
     * Sólo sale con su texto lo que se ha decidido decir. Aquí había un
     * `err.message.length < 200 → 409`, y por ahí se colaba cualquier fallo
     * interno: un «D1_ERROR: variable number must be between ?1 and ?100 at
     * offset 555» llegaba al móvil del anotador con aspecto de regla del juego,
     * y de paso contaba cómo está montada la consulta.
     */
    if (err instanceof ErrorDeAnotacion) return jsonAdmin({ error: err.message }, err.estado);
    console.error("Error anotando:", err);
    return jsonAdmin({ error: "No se ha podido guardar." }, 500);
  }
};

/*
 * Sin `Number()` de por medio: `Number(null)`, `Number("")` y `Number([])` son
 * todos 0, así que un cliente que mandaba el campo vacío estaba pidiendo «el
 * orden 0» sin saberlo. Un número es un número.
 */
const ordenDe = (body: Record<string, unknown>): number | null => {
  const valor = body.ordenEsperado;
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : null;
};

async function accionEvento(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
  const orden = ordenDe(body);
  if (orden === null) return jsonAdmin({ error: "Falta el orden esperado." }, 400);

  const alineacion = await leerAlineacion(db, partido.id);
  if (alineacion.length === 0) {
    return jsonAdmin({ error: "Marca antes quién está en pista: cada punto lleva un jugador detrás." }, 409);
  }

  const validado = validarEvento(body, alineacion);
  if ("campos" in validado) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: validado.campos }, 400);
  }

  const resultado = await registrarEvento(db, partido, validado.evento, orden, usuarioId);

  // Un punto puede cerrar el partido, y entonces el ganador sube al siguiente
  // cruce igual que si se hubiera cerrado desde el panel. Fuera del batch: es
  // otro partido, y que falle no debe deshacer el punto. No hace falta
  // `sincronizarCuadro`: un punto puede cerrar un partido, nunca abrirlo.
  await propagarResultado(db, partido.id);

  return await respuesta(db, partido, usuarioId, 201, resultado);
}

async function accionDeshacer(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
  const orden = ordenDe(body);
  if (orden === null) return jsonAdmin({ error: "Falta el orden del evento a deshacer." }, 400);

  const resultado = await deshacerUltimo(db, partido, orden);
  // Deshacer el punto que cerró el partido le quita el ganador: la plaza que
  // había dado en la ronda siguiente tiene que volver a quedar libre.
  await sincronizarCuadro(db, partido.id);
  return await respuesta(db, partido, usuarioId, 200, resultado);
}

async function accionCorregir(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
  const orden = Number(body.orden);
  if (!Number.isInteger(orden) || orden < 0) return jsonAdmin({ error: "Indica qué evento corregir." }, 400);

  const ordenEsperado = ordenDe(body);
  if (ordenEsperado === null) return jsonAdmin({ error: "Falta el orden esperado." }, 400);

  const alineacion = await leerAlineacion(db, partido.id);
  const cambios: { tipo?: TipoEvento; jugadorId?: number; punto?: boolean } = {};
  if (body.tipo !== undefined) cambios.tipo = String(body.tipo) as TipoEvento;
  if (body.jugadorId !== undefined) cambios.jugadorId = Number(body.jugadorId);
  // Sólo si viene un booleano de verdad: ausente significa «no lo toques», y
  // `Boolean(undefined)` lo convertiría en «no fue punto» sin que nadie lo pida.
  if (typeof body.punto === "boolean") cambios.punto = body.punto;

  const resultado = await corregirEvento(db, partido, orden, cambios, alineacion, ordenEsperado);
  // Corregir puede cambiar quién ganó, y puede dejarlo sin ganador: el cuadro
  // tiene que seguir a las dos.
  await sincronizarCuadro(db, partido.id);
  return await respuesta(db, partido, usuarioId, 200, resultado);
}

/**
 * ¿Todos esos jugadores son de ese equipo?
 *
 * Se comprueba en el servidor y no solo en el cliente: atribuir puntos a alguien
 * de otro equipo —o de otra edición— falsearía el álbum entero y no se notaría
 * hasta mucho después. Lo usan la alineación y el cambio, para que no puedan
 * divergir.
 */
async function sonDelEquipo(db: D1Database, equipoId: number, ids: readonly number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const { results } = await db
    .prepare(
      `SELECT id FROM jugadores
        WHERE equipo_id = ?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(", ")})`
    )
    .bind(equipoId, ...ids)
    .all<{ id: number }>();
  return results.length === ids.length;
}

/**
 * Un suplente entra por un titular.
 *
 * El lado no se acepta del cliente: sale de la alineación de quien está saliendo
 * —misma regla que `lado_punto`—, y con él se comprueba que quien entra sea de
 * ese mismo equipo.
 */
async function accionCambio(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
  const entra = Number(body.entra);
  const sale = Number(body.sale);
  const campos: Record<string, string> = {};
  if (!Number.isInteger(entra) || entra <= 0) campos.entra = "Elige quién entra.";
  if (!Number.isInteger(sale) || sale <= 0) campos.sale = "Elige a quién sustituye.";
  if (Object.keys(campos).length > 0) return jsonAdmin({ error: "Revisa el cambio.", campos }, 400);

  const alineacion = await leerAlineacion(db, partido.id);
  const saliente = alineacion.find((fila) => fila.jugador_id === sale);
  if (!saliente) {
    return jsonAdmin({ error: "Quien sale ya no está en pista. Vuelve a cargar el partido." }, 409);
  }

  const equipoId = saliente.lado === "A" ? partido.equipo_a_id : partido.equipo_b_id;
  if (equipoId === null) return jsonAdmin({ error: "Ese lado del partido todavía no tiene equipo." }, 409);
  if (!(await sonDelEquipo(db, equipoId, [entra]))) {
    return jsonAdmin({ error: "Esa persona no juega en ese equipo.", campos: { entra: "No es de ese equipo." } }, 400);
  }

  await registrarCambio(db, partido, entra, sale, usuarioId);
  return await respuesta(db, partido, usuarioId, 201);
}

async function accionAlineacion(
  db: D1Database,
  partido: PartidoAnotable,
  body: Record<string, unknown>,
  usuarioId: number
): Promise<Response> {
  const lado = body.lado === "B" ? "B" : "A";
  const brutos = Array.isArray(body.jugadorIds) ? body.jugadorIds : [];
  const ids = [...new Set(brutos.map((valor) => Number(valor)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length > MAXIMO_EN_PISTA) {
    return jsonAdmin({ error: `No caben tantas personas en pista: como mucho ${MAXIMO_EN_PISTA}.` }, 400);
  }

  const equipoId = lado === "A" ? partido.equipo_a_id : partido.equipo_b_id;
  if (equipoId === null) return jsonAdmin({ error: "Ese lado del partido todavía no tiene equipo." }, 409);

  if (!(await sonDelEquipo(db, equipoId, ids))) {
    return jsonAdmin({ error: "Alguna de esas personas no juega en ese equipo." }, 400);
  }

  await fijarAlineacion(db, partido.id, lado, ids);
  return await respuesta(db, partido, usuarioId);
}

async function accionAdoptar(
  db: D1Database,
  partido: PartidoAnotable,
  usuarioId: number,
  desdeCero: boolean
): Promise<Response> {
  const resultado = await adoptarMarcador(db, partido, usuarioId, desdeCero);
  // Adoptar un partido que ya venía ganado a mano también lo deja `finished`:
  // era el cuarto camino al final, y el único que no tocaba el cuadro.
  await sincronizarCuadro(db, partido.id);
  return await respuesta(db, partido, usuarioId, 201, resultado);
}

/**
 * Toma el partido, lo lleve quien lo lleve.
 *
 * Sin condición y sin comprobar nada: es la salida del 409, y una salida que
 * puede fallar no es una salida. Tampoco hace falta registrar el cambio de
 * manos en ninguna parte, porque cada evento del log ya va firmado con su
 * `usuario_id`.
 *
 * **Y no toca `updated_at` a propósito.** Esa columna alimenta
 * `ultimaActividad`, que la pantalla enseñaba como «su último punto»: tras un
 * relevo le atribuía al nuevo dueño la hora del anterior. De las dos salidas se
 * elige arreglar la frase, no la marca, por dos razones. `updated_at` entra en
 * el ETag del directo (`versionDirecto`), así que subirla aquí le costaría un
 * cuerpo entero a cada espectador por un cambio que el directo ni siquiera
 * enseña. Y no arreglaría nada: quien acaba de tomar el relevo tampoco ha
 * anotado ningún punto a esa hora. Lo que la columna dice de verdad es «la
 * última escritura sobre este partido», y eso es lo que dice ahora la banda.
 */
async function accionRelevo(db: D1Database, partido: PartidoAnotable, usuarioId: number): Promise<Response> {
  await db
    .prepare("UPDATE partidos SET anotador_usuario_id = ?1 WHERE id = ?2")
    .bind(usuarioId, partido.id)
    .run();
  return await respuesta(db, partido, usuarioId);
}

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "partidos.editar");
  if (acceso instanceof Response) return acceso;

  const partido = await cargarPartido(env.DB, idDelPartido(new URL(request.url)));
  if (!partido) return jsonAdmin({ error: "Ese partido ya no existe." }, 404);

  // Vía de escape: volver a derivar todo desde el log si algo quedó descuadrado.
  try {
    const resultado = await recalcularPartido(env.DB, partido);
    return await respuesta(env.DB, partido, acceso.user.id, 200, resultado);
  } catch (err) {
    console.error("Error recalculando:", err);
    return jsonAdmin({ error: "No se ha podido recalcular." }, 500);
  }
};
