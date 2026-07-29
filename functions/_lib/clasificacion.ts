// La clasificación de un grupo.
//
// No se guarda en ninguna tabla: se calcula a partir de los partidos terminados
// cada vez que hace falta. Guardarla obligaría a mantenerla en sintonía con los
// resultados, y corregir un marcador viejo dejaría una tabla mintiendo.
//
// Es una función pura, sin base de datos delante, para poder probar a fondo lo
// único de todo esto que tiene reglas de verdad: los desempates.

import type { CriterioDesempate, ReglasClasificacion } from "./reglas";

export interface EquipoEnGrupo {
  id: number;
  nombre: string;
}

export interface PartidoClasificable {
  equipoAId: number | null;
  equipoBId: number | null;
  setsA: number;
  setsB: number;
  /** Suma de los puntos de todos los sets, no el marcador del set en curso. */
  puntosA: number;
  puntosB: number;
  status: "scheduled" | "live" | "finished";
  /** Si se resolvió en el último set posible. Cambia lo que puntúa. */
  setDecisivo: boolean;
}

export interface FilaClasificacion {
  posicion: number;
  equipoId: number;
  nombre: string;
  jugados: number;
  ganados: number;
  perdidos: number;
  setsAFavor: number;
  setsEnContra: number;
  puntosAFavor: number;
  puntosEnContra: number;
  puntos: number;
  /** Qué criterio lo separó de aquellos con los que estaba empatado. */
  desempatadoPor: CriterioDesempate | null;
}

type FilaEnCurso = Omit<FilaClasificacion, "posicion">;

/**
 * Ordena un grupo. Solo cuentan los partidos terminados: uno en juego todavía no
 * ha dado nada, y contarlo a medias haría bailar la tabla en cada punto.
 */
export function clasificacionDeGrupo(
  equipos: readonly EquipoEnGrupo[],
  partidos: readonly PartidoClasificable[],
  reglas: ReglasClasificacion
): FilaClasificacion[] {
  const jugados = partidos.filter((p) => p.status === "finished");
  const filas = calcularFilas(equipos, jugados, reglas);
  const ordenadas = ordenar(filas, jugados, reglas, reglas.desempates, 0);
  return ordenadas.map((fila, indice) => ({ ...fila, posicion: indice + 1 }));
}

function calcularFilas(
  equipos: readonly EquipoEnGrupo[],
  partidos: readonly PartidoClasificable[],
  reglas: ReglasClasificacion
): FilaEnCurso[] {
  const porId = new Map<number, FilaEnCurso>(
    equipos.map((equipo) => [
      equipo.id,
      {
        equipoId: equipo.id,
        nombre: equipo.nombre,
        jugados: 0,
        ganados: 0,
        perdidos: 0,
        setsAFavor: 0,
        setsEnContra: 0,
        puntosAFavor: 0,
        puntosEnContra: 0,
        puntos: 0,
        desempatadoPor: null
      }
    ])
  );

  for (const partido of partidos) {
    const filaA = partido.equipoAId === null ? undefined : porId.get(partido.equipoAId);
    const filaB = partido.equipoBId === null ? undefined : porId.get(partido.equipoBId);
    // Un partido con un equipo de fuera del grupo (o un bye) no cuenta para nadie.
    if (!filaA || !filaB) continue;

    anotar(filaA, partido.setsA, partido.setsB, partido.puntosA, partido.puntosB, partido.setDecisivo, reglas);
    anotar(filaB, partido.setsB, partido.setsA, partido.puntosB, partido.puntosA, partido.setDecisivo, reglas);
  }

  return [...porId.values()];
}

function anotar(
  propia: FilaEnCurso,
  setsPropios: number,
  setsRival: number,
  puntosPropios: number,
  puntosRival: number,
  setDecisivo: boolean,
  reglas: ReglasClasificacion
): void {
  propia.jugados += 1;
  propia.setsAFavor += setsPropios;
  propia.setsEnContra += setsRival;
  propia.puntosAFavor += puntosPropios;
  propia.puntosEnContra += puntosRival;

  const gano = setsPropios > setsRival;
  if (gano) {
    propia.ganados += 1;
    propia.puntos += setDecisivo ? reglas.puntosVictoriaAjustada : reglas.puntosVictoria;
  } else {
    propia.perdidos += 1;
    propia.puntos += setDecisivo ? reglas.puntosDerrotaAjustada : reglas.puntosDerrota;
  }
}

/** Un ratio en el que no dividir por cero: no encajar nada es el mejor ratio. */
const ratio = (aFavor: number, enContra: number): number => {
  if (enContra !== 0) return aFavor / enContra;
  return aFavor === 0 ? 0 : Number.POSITIVE_INFINITY;
};

/** Cuánto vale una fila según un criterio. Siempre "más es mejor". */
function valor(criterio: CriterioDesempate, fila: FilaEnCurso): number {
  switch (criterio) {
    case "puntos":
      return fila.puntos;
    case "victorias":
      return fila.ganados;
    case "diferencia_sets":
      return fila.setsAFavor - fila.setsEnContra;
    case "ratio_sets":
      return ratio(fila.setsAFavor, fila.setsEnContra);
    case "diferencia_puntos":
      return fila.puntosAFavor - fila.puntosEnContra;
    case "ratio_puntos":
      return ratio(fila.puntosAFavor, fila.puntosEnContra);
    default:
      // enfrentamiento_directo no se resuelve comparando valores de la tabla
      // general: tiene su propia rama en ordenar().
      return 0;
  }
}

/**
 * Ordena aplicando los criterios en cascada: el primero parte el grupo en
 * bloques, y dentro de cada bloque se sigue con el siguiente.
 *
 * `enfrentamiento_directo` no es un valor de la tabla general, sino una tabla
 * aparte: la que sale de contar **solo los partidos entre los empatados**.
 * Comparar de dos en dos sería lo intuitivo y estaría mal — con tres equipos
 * puede darse A gana a B, B gana a C y C gana a A, y no hay orden posible; hay
 * que mirar el minigrupo entero.
 */
function ordenar(
  filas: FilaEnCurso[],
  partidos: readonly PartidoClasificable[],
  reglas: ReglasClasificacion,
  criterios: readonly CriterioDesempate[],
  nivel: number
): FilaEnCurso[] {
  if (filas.length <= 1) return filas;
  if (nivel >= criterios.length) return porNombre(filas);

  const criterio = criterios[nivel]!;
  const siguiente = () => ordenar(filas, partidos, reglas, criterios, nivel + 1);

  const bloques =
    criterio === "enfrentamiento_directo"
      ? bloquesPorEnfrentamiento(filas, partidos, reglas, criterios)
      : conVarios(agruparPorValor(filas, criterio));

  if (!bloques) return siguiente();

  return bloques.flatMap((bloque) =>
    ordenar(marcar(bloque, criterio, nivel), partidos, reglas, criterios, nivel + 1)
  );
}

/** null si el criterio no separó nada, para poder pasar al siguiente. */
const conVarios = (bloques: FilaEnCurso[][]): FilaEnCurso[][] | null => (bloques.length > 1 ? bloques : null);

/**
 * El minigrupo de los empatados, resuelto con los demás criterios (sin el propio
 * enfrentamiento directo, que si no se llamaría a sí mismo para siempre).
 * Devuelve null si no separa nada: ni hay partidos entre ellos, ni el minigrupo
 * los distingue.
 */
function bloquesPorEnfrentamiento(
  filas: FilaEnCurso[],
  partidos: readonly PartidoClasificable[],
  reglas: ReglasClasificacion,
  criterios: readonly CriterioDesempate[]
): FilaEnCurso[][] | null {
  const ids = new Set(filas.map((f) => f.equipoId));
  const entreEllos = partidos.filter(
    (p) => p.equipoAId !== null && p.equipoBId !== null && ids.has(p.equipoAId) && ids.has(p.equipoBId)
  );
  if (entreEllos.length === 0) return null;

  const restantes = criterios.filter((c) => c !== "enfrentamiento_directo");
  if (restantes.length === 0) return null;

  const equipos = filas.map((f) => ({ id: f.equipoId, nombre: f.nombre }));
  const mini = calcularFilas(equipos, entreEllos, reglas);
  const ordenadas = ordenar(mini, entreEllos, reglas, restantes, 0);

  const bloquesMini = agruparPorEmpate(ordenadas, restantes);
  if (bloquesMini.length <= 1) return null;

  const porId = new Map(filas.map((f) => [f.equipoId, f]));
  return bloquesMini.map((bloque) => bloque.map((f) => porId.get(f.equipoId)!));
}

/** Parte en bloques por el valor del criterio, de mayor a menor. */
function agruparPorValor(filas: FilaEnCurso[], criterio: CriterioDesempate): FilaEnCurso[][] {
  const porValor = new Map<number, FilaEnCurso[]>();
  for (const fila of filas) {
    const v = valor(criterio, fila);
    const lista = porValor.get(v) ?? [];
    lista.push(fila);
    porValor.set(v, lista);
  }
  return [...porValor.entries()].sort((a, b) => b[0] - a[0]).map(([, lista]) => lista);
}

/** Bloques de filas consecutivas que empatan en todos los criterios dados. */
function agruparPorEmpate(filas: FilaEnCurso[], criterios: readonly CriterioDesempate[]): FilaEnCurso[][] {
  const bloques: FilaEnCurso[][] = [];
  for (const fila of filas) {
    const ultimo = bloques[bloques.length - 1];
    const iguales =
      ultimo !== undefined && criterios.every((c) => valor(c, ultimo[0]!) === valor(c, fila));
    if (iguales) ultimo!.push(fila);
    else bloques.push([fila]);
  }
  return bloques;
}

/**
 * Deja constancia de qué criterio deshizo el empate, para poder explicarlo en la
 * tabla. Solo a partir del segundo criterio: que el primero (normalmente los
 * puntos) reparta las posiciones no es deshacer un empate, es el orden normal.
 */
function marcar(bloque: FilaEnCurso[], criterio: CriterioDesempate, nivel: number): FilaEnCurso[] {
  if (nivel === 0) return bloque;
  return bloque.map((fila) => (fila.desempatadoPor ? fila : { ...fila, desempatadoPor: criterio }));
}

const porNombre = (filas: FilaEnCurso[]): FilaEnCurso[] =>
  [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
