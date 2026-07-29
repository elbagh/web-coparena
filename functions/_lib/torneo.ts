// Generación del cuadro y progresión de resultados.
//
// Dos piezas puras, que son las que tienen algoritmo (`calendarioLiga` y
// `plantillaCuadro`), y las que tocan la base para materializarlas y para llevar
// al ganador de un cruce al siguiente.

import { reglasEfectivas, type ReglasFase } from "./reglas";

export type Lado = "A" | "B";

// ---------------------------------------------------------------------------
// Piezas puras
// ---------------------------------------------------------------------------

export interface CruceLiga {
  jornada: number;
  a: number;
  b: number;
}

/**
 * Todos contra todos, por el método del círculo: uno se queda fijo y los demás
 * rotan a su alrededor. Sale determinista (mismo orden de entrada, mismo
 * calendario) y reparte los descansos, en vez de emparejar por fuerza bruta.
 *
 * Con un número impar de equipos se añade un hueco: quien le toca, descansa esa
 * jornada.
 */
export function calendarioLiga(equipoIds: readonly number[]): CruceLiga[] {
  const lista: (number | null)[] = [...equipoIds];
  if (lista.length < 2) return [];
  if (lista.length % 2 === 1) lista.push(null);

  const n = lista.length;
  const fijo = lista[0]!;
  const rotan = lista.slice(1);
  const cruces: CruceLiga[] = [];

  for (let jornada = 0; jornada < n - 1; jornada += 1) {
    const ronda: (number | null)[] = [fijo, ...rotan];
    for (let i = 0; i < n / 2; i += 1) {
      const a = ronda[i];
      const b = ronda[n - 1 - i];
      if (a !== null && b !== null) cruces.push({ jornada: jornada + 1, a, b });
    }
    rotan.unshift(rotan.pop()!);
  }

  return cruces;
}

export interface NodoCuadro {
  /** Profundidad: 0 es la primera ronda. */
  rondaOrden: number;
  posicion: number;
  ronda: string;
  siguienteRonda: number | null;
  siguientePosicion: number | null;
  siguienteSlot: Lado | null;
  /** A dónde va el perdedor. Solo lo usan las semifinales, hacia el 3.er puesto. */
  perdedorRonda: number | null;
  perdedorPosicion: number | null;
  perdedorSlot: Lado | null;
}

const NOMBRES_RONDA: Record<number, string> = {
  1: "Final",
  2: "Semifinales",
  4: "Cuartos de final",
  8: "Octavos de final",
  16: "Dieciseisavos de final"
};

const nombreRonda = (partidosEnLaRonda: number): string =>
  NOMBRES_RONDA[partidosEnLaRonda] ?? `Ronda de ${partidosEnLaRonda * 2}`;

/** ¿Es potencia de dos y de un tamaño razonable para un cuadro? */
export const tamanoDeCuadroValido = (tamano: number): boolean =>
  Number.isInteger(tamano) && tamano >= 2 && tamano <= 64 && (tamano & (tamano - 1)) === 0;

/**
 * El esqueleto de una eliminatoria de `tamano` equipos: qué partidos hay y a
 * cuál lleva cada uno.
 *
 * El ganador del hueco `p` cae en el hueco `p/2` de la ronda siguiente, por el
 * lado A si venía de un hueco par y por el B si venía de uno impar. Es lo que
 * dibuja el árbol.
 */
export function plantillaCuadro(tamano: number, conTercerPuesto = false): NodoCuadro[] {
  if (!tamanoDeCuadroValido(tamano)) return [];

  const rondas = Math.log2(tamano);
  const nodos: NodoCuadro[] = [];

  for (let r = 0; r < rondas; r += 1) {
    const partidosEnLaRonda = tamano / 2 ** (r + 1);
    const esUltima = r === rondas - 1;

    for (let p = 0; p < partidosEnLaRonda; p += 1) {
      nodos.push({
        rondaOrden: r,
        posicion: p,
        ronda: nombreRonda(partidosEnLaRonda),
        siguienteRonda: esUltima ? null : r + 1,
        siguientePosicion: esUltima ? null : Math.floor(p / 2),
        siguienteSlot: esUltima ? null : p % 2 === 0 ? "A" : "B",
        perdedorRonda: null,
        perdedorPosicion: null,
        perdedorSlot: null
      });
    }
  }

  // El tercer puesto necesita semifinales de las que salgan perdedores: con dos
  // equipos solo hay final, y no hay tercero al que dar nada.
  if (conTercerPuesto && rondas >= 2) {
    const rondaFinal = rondas - 1;
    nodos.push({
      rondaOrden: rondaFinal,
      posicion: 1,
      ronda: "Tercer puesto",
      siguienteRonda: null,
      siguientePosicion: null,
      siguienteSlot: null,
      perdedorRonda: null,
      perdedorPosicion: null,
      perdedorSlot: null
    });

    for (const semifinal of nodos.filter((n) => n.rondaOrden === rondaFinal - 1)) {
      semifinal.perdedorRonda = rondaFinal;
      semifinal.perdedorPosicion = 1;
      semifinal.perdedorSlot = semifinal.posicion === 0 ? "A" : "B";
    }
  }

  return nodos;
}

// ---------------------------------------------------------------------------
// Materialización en la base
// ---------------------------------------------------------------------------

export interface FaseRow {
  id: number;
  edicion_id: number;
  clave: string;
  nombre: string;
  tipo: "grupos" | "eliminatoria";
  orden: number;
  reglas: string;
  /** Plazas directas por grupo. Un grupo puede sobrescribirlo. */
  clasifican: number;
  /** Plazas extra que se reparten comparando entre grupos. */
  repesca: number;
}

export interface GrupoRow {
  id: number;
  fase_id: number;
  nombre: string;
  orden: number;
  reglas: string | null;
  /** null = hereda el cupo de la fase, que no es lo mismo que 0. */
  clasifican: number | null;
  /** 0/1: si el siguiente de este grupo entra al bote de la repesca. */
  en_repesca: number;
}

interface EquipoNombrado {
  id: number;
  nombre: string;
}

/**
 * Crea el calendario de todos los grupos de una fase. Antes borra los partidos
 * que ya hubiera **de esa fase**: regenerar un calendario es rehacerlo, y dejar
 * los viejos duplicaría cruces. Lo que hay fuera de la fase no se toca.
 */
export async function generarLiga(
  db: D1Database,
  fase: FaseRow,
  grupos: readonly { grupo: GrupoRow; equipos: readonly EquipoNombrado[] }[]
): Promise<{ creados: number }> {
  const ahora = new Date().toISOString();
  const sentencias: D1PreparedStatement[] = [borrarPartidosDeFase(db, fase.id)];
  let orden = 0;

  for (const { grupo, equipos } of grupos) {
    const reglas = reglasEfectivas(fase, grupo);
    const porId = new Map(equipos.map((e) => [e.id, e]));

    for (const cruce of calendarioLiga(equipos.map((e) => e.id))) {
      const a = porId.get(cruce.a)!;
      const b = porId.get(cruce.b)!;
      sentencias.push(
        insertarPartido(db, {
          ronda: `${grupo.nombre} · jornada ${cruce.jornada}`,
          faseId: fase.id,
          grupoId: grupo.id,
          edicionId: fase.edicion_id,
          equipoA: a,
          equipoB: b,
          origen: "sorteo",
          sortOrder: orden,
          reglas,
          ahora
        })
      );
      orden += 1;
    }
  }

  await db.batch(sentencias);
  return { creados: sentencias.length - 1 };
}

/**
 * Crea el esqueleto de una eliminatoria, con los huecos vacíos y ya enlazados
 * entre sí. Los equipos entran después: sembrados desde la clasificación o a
 * mano.
 *
 * Los ids se calculan antes de insertar nada, porque cada partido tiene que
 * apuntar al siguiente y ese siguiente aún no existe en la base.
 */
export async function generarEliminatoria(
  db: D1Database,
  fase: FaseRow,
  tamano: number,
  conTercerPuesto: boolean
): Promise<{ creados: number }> {
  const nodos = plantillaCuadro(tamano, conTercerPuesto);
  if (nodos.length === 0) return { creados: 0 };

  const reglas = reglasEfectivas(fase);
  const ahora = new Date().toISOString();
  const ids = new Map<string, string>();
  const clave = (ronda: number, posicion: number) => `${ronda}:${posicion}`;
  nodos.forEach((nodo) => ids.set(clave(nodo.rondaOrden, nodo.posicion), crypto.randomUUID()));

  const sentencias: D1PreparedStatement[] = [borrarPartidosDeFase(db, fase.id)];
  const ordenDeVisualizacion = new Map(nodos.map((nodo, indice) => [nodo, indice]));

  /*
   * Se insertan de la última ronda hacia atrás. `siguiente_partido_id` es una
   * clave ajena a la propia tabla, así que meter una semifinal antes que la
   * final la haría apuntar a una fila que todavía no existe y D1 la rechaza.
   * Como los enlaces solo van hacia delante, el orden inverso siempre encuentra
   * ya puesto su destino.
   */
  [...nodos].sort((a, b) => b.rondaOrden - a.rondaOrden).forEach((nodo) => {
    const indice = ordenDeVisualizacion.get(nodo)!;
    const id = ids.get(clave(nodo.rondaOrden, nodo.posicion))!;
    const siguiente =
      nodo.siguienteRonda === null ? null : ids.get(clave(nodo.siguienteRonda, nodo.siguientePosicion!)) ?? null;
    const perdedor =
      nodo.perdedorRonda === null ? null : ids.get(clave(nodo.perdedorRonda, nodo.perdedorPosicion!)) ?? null;

    sentencias.push(
      db
        .prepare(
          `INSERT INTO partidos (
             id, ronda, equipo_a_nombre, equipo_b_nombre, status, sort_order, edicion_id,
             fase_id, ronda_orden, posicion, siguiente_partido_id, siguiente_slot,
             perdedor_partido_id, perdedor_slot, reglas, origen_equipo_a, origen_equipo_b,
             created_at, updated_at
           ) VALUES (?1, ?2, '', '', 'scheduled', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'progresion', 'progresion', ?13, ?13)`
        )
        .bind(
          id,
          nodo.ronda,
          indice,
          fase.edicion_id,
          fase.id,
          nodo.rondaOrden,
          nodo.posicion,
          siguiente,
          nodo.siguienteSlot,
          perdedor,
          nodo.perdedorSlot,
          JSON.stringify(reglas),
          ahora
        )
    );
  });

  await db.batch(sentencias);
  return { creados: nodos.length };
}

export interface Semilla {
  equipoId: number;
  nombre: string;
}

/**
 * Coloca a los clasificados en la primera ronda del cuadro. El emparejamiento es
 * el clásico: el primero contra el último, el segundo contra el penúltimo. Así
 * quien mejor lo hizo en la fase de grupos se cruza lo más tarde posible con los
 * otros cabezas de serie.
 */
export async function sembrarEliminatoria(db: D1Database, faseId: number, semillas: readonly Semilla[]): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id, posicion FROM partidos
        WHERE fase_id = ?1 AND ronda_orden = 0
        ORDER BY posicion ASC`
    )
    .bind(faseId)
    .all<{ id: string; posicion: number }>();
  if (results.length === 0) return;

  const huecos = results.length * 2;
  const ahora = new Date().toISOString();
  const sentencias: D1PreparedStatement[] = [];

  for (let i = 0; i < results.length; i += 1) {
    const partido = results[i]!;
    const local = semillas[i] ?? null;
    const visitante = semillas[huecos - 1 - i] ?? null;

    sentencias.push(
      db
        .prepare(
          `UPDATE partidos SET
             equipo_a_id = ?1, equipo_a_nombre = ?2, origen_equipo_a = 'sorteo',
             equipo_b_id = ?3, equipo_b_nombre = ?4, origen_equipo_b = 'sorteo',
             updated_at = ?5
           WHERE id = ?6`
        )
        .bind(local?.equipoId ?? null, local?.nombre ?? "", visitante?.equipoId ?? null, visitante?.nombre ?? "", ahora, partido.id)
    );
  }

  await db.batch(sentencias);
}

interface PartidoProgresion {
  id: string;
  winner: Lado | null;
  status: string;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  siguiente_partido_id: string | null;
  siguiente_slot: Lado | null;
  perdedor_partido_id: string | null;
  perdedor_slot: Lado | null;
}

/**
 * Lleva al ganador (y al perdedor, si hay partido por el tercer puesto) al hueco
 * que le toca.
 *
 * Se llama desde **todos** los caminos que dejan un partido en `finished`, y es
 * idempotente: volver a llamarla con el mismo resultado no cambia nada. Nunca
 * pisa un hueco marcado como `manual`, porque eso sería deshacer una corrección
 * hecha a mano.
 */
export async function propagarResultado(db: D1Database, partidoId: string): Promise<{ propagados: string[] }> {
  const partido = await db
    .prepare(
      `SELECT id, winner, status, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre,
              siguiente_partido_id, siguiente_slot, perdedor_partido_id, perdedor_slot
         FROM partidos WHERE id = ?1`
    )
    .bind(partidoId)
    .first<PartidoProgresion>();

  if (!partido || partido.status !== "finished" || !partido.winner) return { propagados: [] };

  const ganador =
    partido.winner === "A"
      ? { id: partido.equipo_a_id, nombre: partido.equipo_a_nombre }
      : { id: partido.equipo_b_id, nombre: partido.equipo_b_nombre };
  const perdedor =
    partido.winner === "A"
      ? { id: partido.equipo_b_id, nombre: partido.equipo_b_nombre }
      : { id: partido.equipo_a_id, nombre: partido.equipo_a_nombre };

  const propagados: string[] = [];
  const escribir = async (destinoId: string | null, slot: Lado | null, equipo: { id: number | null; nombre: string }) => {
    if (!destinoId || !slot) return;
    const columna = slot === "A" ? "a" : "b";
    const resultado = await db
      .prepare(
        `UPDATE partidos SET
           equipo_${columna}_id = ?1, equipo_${columna}_nombre = ?2,
           origen_equipo_${columna} = 'progresion', updated_at = ?3
         WHERE id = ?4 AND origen_equipo_${columna} <> 'manual'`
      )
      .bind(equipo.id, equipo.nombre, new Date().toISOString(), destinoId)
      .run();
    if ((resultado.meta.changes ?? 0) > 0) propagados.push(destinoId);
  };

  await escribir(partido.siguiente_partido_id, partido.siguiente_slot, ganador);
  await escribir(partido.perdedor_partido_id, partido.perdedor_slot, perdedor);

  return { propagados };
}

/**
 * Los partidos aguas abajo que ya han empezado. Si devuelve alguno, corregir el
 * resultado de arriba dejaría el cuadro incoherente: hay gente jugando (o que ya
 * ha jugado) un cruce que quizá no le tocaba.
 */
export async function bloqueosAguasAbajo(db: D1Database, partidoId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.ronda, p.status
         FROM partidos p
         JOIN partidos origen ON origen.id = ?1
        WHERE (p.id = origen.siguiente_partido_id OR p.id = origen.perdedor_partido_id)
          AND p.status <> 'scheduled'`
    )
    .bind(partidoId)
    .all<{ id: string; ronda: string; status: string }>();
  return results.map((fila) => fila.ronda || fila.id);
}

// ---------------------------------------------------------------------------

const borrarPartidosDeFase = (db: D1Database, faseId: number): D1PreparedStatement =>
  db.prepare("DELETE FROM partidos WHERE fase_id = ?1").bind(faseId);

interface DatosPartido {
  ronda: string;
  faseId: number;
  grupoId: number | null;
  edicionId: number;
  equipoA: EquipoNombrado;
  equipoB: EquipoNombrado;
  origen: string;
  sortOrder: number;
  reglas: ReglasFase;
  ahora: string;
}

const insertarPartido = (db: D1Database, datos: DatosPartido): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO partidos (
         id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre,
         status, sort_order, edicion_id, fase_id, grupo_id, reglas,
         origen_equipo_a, origen_equipo_b, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'scheduled', ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, ?13)`
    )
    .bind(
      crypto.randomUUID(),
      datos.ronda,
      datos.equipoA.id,
      datos.equipoB.id,
      datos.equipoA.nombre,
      datos.equipoB.nombre,
      datos.sortOrder,
      datos.edicionId,
      datos.faseId,
      datos.grupoId,
      JSON.stringify(datos.reglas),
      datos.origen,
      datos.ahora
    );
