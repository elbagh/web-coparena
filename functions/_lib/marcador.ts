// El pliegue: de una lista de eventos a un marcador y a unas estadísticas.
//
// Es la pieza central de la anotación en directo y es **pura**: entra un array,
// sale un objeto. Toda la lógica de sets, de puntos y de quién gana vive aquí y
// solo aquí, así que deshacer un punto no es restar a mano y esperar que cuadre
// — es quitar el evento y volver a plegar.
//
// El marcador no es un `SUM`: es una máquina de estados (el set cierra a 21 con
// dos de ventaja, los puntos se reinician, sube el número de set, el partido
// acaba al llegar a los sets que pida el formato). Por eso se pliega en
// TypeScript en vez de resolverse con SQL agregado. Las estadísticas sí son un
// agregado y por eso el endpoint las resuelve en una sola sentencia.

import { ganadorDelPartido, ganadorDelSet, type ReglasPartido } from "./reglas";

export type Lado = "A" | "B";

export type TipoEvento = "punto" | "ace" | "saque_fallado" | "bloqueo" | "chilena" | "ajuste";

export interface Accion {
  clave: TipoEvento;
  etiqueta: string;
  /**
   * Opcional a propósito: su ausencia es una decisión, no un `""` que haya que
   * interpretar. `bloqueo` y `chilena` no la llevan — ver el porqué junto a
   * `TIPOS`.
   */
  ayuda?: string;
  /**
   * `"siempre"`: el tipo ya decide si hubo punto.
   * `"pregunta"`: lo decide quien anota, rally a rally.
   */
  punto: "siempre" | "pregunta";
  /** El punto cruza la red: se lo lleva el rival de quien hizo la acción. */
  aRival: boolean;
}

/**
 * Los botones del anotador, y lo que hace falta para predecir el marcador.
 *
 * `ajuste` no está: no es una acción que nadie pulse, es el saldo de apertura al
 * adoptar un partido que venía llevándose a mano.
 *
 * Esta lista viaja entera al cliente (`/api/anotacion`) y recortada al público
 * (`/api/plantilla`, sólo clave y etiqueta). El cliente NO vuelve a escribir la
 * regla de quién se lleva el punto: la lee de aquí. La tenía copiada a mano
 * («todo menos defensa puntúa») y era una copia esperando a quedarse vieja.
 *
 * `bloqueo` y `chilena` no llevan `ayuda`: de las cinco, son las únicas cuyo
 * subtítulo se limitaba a repetir la etiqueta («Bloqueo» / «Bloqueo suyo»,
 * «Chilena» / «Chilena suya»). Las otras tres añaden algo que la etiqueta sola
 * no dice — a quién beneficia el punto o cómo se hizo—; estas dos, no. Que de
 * paso el botón vuelva a caber en una línea y devuelva el suelo táctil a 56px
 * es la confirmación de que sobraba, no el motivo de quitarlo.
 */
export const TIPOS: readonly Accion[] = [
  { clave: "punto", etiqueta: "Punto", ayuda: "Gana el rally", punto: "siempre", aRival: false },
  { clave: "ace", etiqueta: "Ace", ayuda: "Punto directo de saque", punto: "siempre", aRival: false },
  {
    clave: "saque_fallado",
    etiqueta: "Falló saque",
    ayuda: "El punto es del rival",
    punto: "siempre",
    aRival: true
  },
  { clave: "bloqueo", etiqueta: "Bloqueo", punto: "pregunta", aRival: false },
  { clave: "chilena", etiqueta: "Chilena", punto: "pregunta", aRival: false }
];

/** El catálogo indexado. `ajuste` no está: no se ofrece y no se valida contra él. */
export const ACCION_POR_CLAVE: ReadonlyMap<TipoEvento, Accion> = new Map(
  TIPOS.map((accion) => [accion.clave, accion])
);

/**
 * Quién se lleva el punto, o nadie.
 *
 * Con `bloqueo` y `chilena` no lo dice el tipo sino el propio evento, y por eso
 * hace falta `puntua`: un bloqueo puede cerrar el rally o sólo levantar la
 * pelota. Sin respuesta se devuelve `null` — no se adivina, porque adivinar aquí
 * es inventar marcador.
 *
 * Lo llama el servidor y **nunca el cliente**: invertirlo es trivial y el daño
 * (marcador y estadísticas cruzados) no se vería hasta el final del torneo.
 */
export function ladoDelPunto(tipo: TipoEvento, ladoJugador: Lado, puntua?: boolean): Lado | null {
  const accion = ACCION_POR_CLAVE.get(tipo);
  if (!accion) return null;
  if (accion.punto === "pregunta" && puntua !== true) return null;
  return accion.aRival ? (ladoJugador === "A" ? "B" : "A") : ladoJugador;
}

export interface EventoFila {
  orden: number;
  /**
   * El set en el que se guardó. Es un dato derivado que se conserva en la fila
   * porque el historial público lee solo la cola del log y no puede replegar
   * desde el principio para saberlo. Corregir un evento antiguo puede mover una
   * frontera de set, y por eso `corregirEvento` lo reescribe.
   */
  set_numero?: number;
  tipo: TipoEvento;
  lado_jugador: Lado | null;
  jugador_id: number | null;
  lado_punto: Lado | null;
  puntos_a: number | null;
  puntos_b: number | null;
  sets_a: number | null;
  sets_b: number | null;
}

export interface EstadoMarcador {
  setNumero: number;
  puntos: { A: number; B: number };
  sets: { A: number; B: number };
  historial: { a: number; b: number }[];
  terminado: boolean;
  winner: Lado | null;
}

export const marcadorInicial = (): EstadoMarcador => ({
  setNumero: 1,
  puntos: { A: 0, B: 0 },
  sets: { A: 0, B: 0 },
  historial: [],
  terminado: false,
  winner: null
});

/** Suma un punto y resuelve el cierre de set y de partido si toca. */
export function aplicarPunto(estado: EstadoMarcador, lado: Lado, reglas: ReglasPartido): EstadoMarcador {
  if (estado.terminado) return estado;

  const siguiente: EstadoMarcador = {
    ...estado,
    puntos: { ...estado.puntos },
    sets: { ...estado.sets },
    historial: [...estado.historial]
  };
  siguiente.puntos[lado] += 1;

  const ganadorSet = ganadorDelSet(reglas, siguiente.puntos.A, siguiente.puntos.B, siguiente.setNumero);
  if (!ganadorSet) return siguiente;

  siguiente.historial.push({ a: siguiente.puntos.A, b: siguiente.puntos.B });
  siguiente.sets[ganadorSet] += 1;
  siguiente.puntos = { A: 0, B: 0 };
  siguiente.setNumero += 1;

  const ganador = ganadorDelPartido(reglas, siguiente.sets.A, siguiente.sets.B);
  if (ganador) {
    siguiente.terminado = true;
    siguiente.winner = ganador;
  }
  return siguiente;
}

/**
 * Un evento encima de un estado.
 *
 * Está suelto para que se pueda plegar de uno en uno. `leerEstado` necesita
 * saber en qué set cayó cada evento, y lo sacaba replegando el log entero por
 * cada uno: O(n²) en un bucle que se recorre en cada punto anotado. Con el paso
 * suelto es una sola pasada, y `plegarEventos` no es más que este paso repetido.
 *
 * Un `ajuste` reinicia el estado al saldo que traiga: es lo que permite que un
 * partido empezado a mano gane un anotador a mitad sin inventarse quién metió
 * los puntos anteriores.
 */
export function aplicarEvento(
  estado: EstadoMarcador,
  evento: EventoFila,
  reglas: ReglasPartido
): EstadoMarcador {
  if (evento.tipo === "ajuste") {
    const siguiente: EstadoMarcador = {
      setNumero: Math.max(1, (evento.sets_a ?? 0) + (evento.sets_b ?? 0) + 1),
      puntos: { A: evento.puntos_a ?? 0, B: evento.puntos_b ?? 0 },
      sets: { A: evento.sets_a ?? 0, B: evento.sets_b ?? 0 },
      // El historial de lo jugado antes del anotador no se conoce: se deja
      // vacío en vez de inventar parciales.
      historial: [],
      terminado: false,
      winner: null
    };
    const ganador = ganadorDelPartido(reglas, siguiente.sets.A, siguiente.sets.B);
    if (ganador) {
      siguiente.terminado = true;
      siguiente.winner = ganador;
    }
    return siguiente;
  }

  if (!evento.lado_punto) return estado;
  return aplicarPunto(estado, evento.lado_punto, reglas);
}

/**
 * El marcador que resulta de una lista de eventos, que tienen que llegar
 * ordenados por `orden`.
 */
export function plegarEventos(eventos: readonly EventoFila[], reglas: ReglasPartido): EstadoMarcador {
  let estado = marcadorInicial();
  for (const evento of eventos) estado = aplicarEvento(estado, evento, reglas);
  return estado;
}
