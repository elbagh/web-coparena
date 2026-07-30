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

export type TipoEvento = "remate" | "ace" | "bloqueo" | "defensa" | "error" | "ajuste";

/**
 * Qué acciones cierran el rally con punto.
 *
 * `defensa` no puntúa: un rally puede llevar varias defensas y exactamente una
 * acción que lo cierra. `ajuste` tampoco — no es un punto, es un saldo de
 * apertura al adoptar un partido que venía llevándose a mano.
 */
export const PUNTUA: Readonly<Record<TipoEvento, boolean>> = {
  remate: true,
  ace: true,
  bloqueo: true,
  error: true,
  defensa: false,
  ajuste: false
};

const ETIQUETAS: readonly { clave: TipoEvento; etiqueta: string; ayuda: string }[] = [
  { clave: "remate", etiqueta: "Remate", ayuda: "Punto de ataque" },
  { clave: "ace", etiqueta: "Ace", ayuda: "Punto directo de saque" },
  { clave: "bloqueo", etiqueta: "Bloqueo", ayuda: "Punto en el bloqueo" },
  { clave: "error", etiqueta: "Error", ayuda: "Falla y el punto es del rival" },
  { clave: "defensa", etiqueta: "Defensa", ayuda: "Buena defensa, el rally sigue" }
];

/**
 * Los botones del anotador, con lo que hace falta para predecir el marcador.
 *
 * `puntua` y `alRival` salen de `PUNTUA` y de `ladoDelPunto`, no de una lista
 * escrita otra vez: el anotador pinta el marcador antes de que responda el
 * servidor, y con la regla copiada a mano en el cliente («todo menos defensa
 * puntúa») cualquier tipo nuevo la habría dejado mintiendo. El que decide sigue
 * siendo el servidor; esto solo evita que la predicción discrepe.
 */
export const TIPOS: readonly {
  clave: TipoEvento;
  etiqueta: string;
  ayuda: string;
  puntua: boolean;
  alRival: boolean;
}[] = ETIQUETAS.map((tipo) => ({
  ...tipo,
  puntua: PUNTUA[tipo.clave],
  alRival: PUNTUA[tipo.clave] && ladoDelPunto(tipo.clave, "A") === "B"
}));

/** A qué columna de `estadisticas` suma cada tipo, además de a `puntos`. */
export const METRICA_DE_TIPO: Readonly<Record<TipoEvento, string | null>> = {
  remate: "remates",
  ace: "aces",
  bloqueo: "bloqueos",
  defensa: "defensas",
  error: "errores",
  ajuste: null
};

/**
 * Quién se lleva el punto.
 *
 * El error es el único caso en que no coincide con el lado de quien hizo la
 * acción: fallar da el punto al rival. Es la razón de que el evento guarde los
 * dos lados en vez de uno.
 */
export function ladoDelPunto(tipo: TipoEvento, ladoJugador: Lado): Lado | null {
  if (!PUNTUA[tipo]) return null;
  if (tipo === "error") return ladoJugador === "A" ? "B" : "A";
  return ladoJugador;
}

export interface EventoFila {
  orden: number;
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
 * El marcador que resulta de una lista de eventos.
 *
 * Los eventos tienen que llegar ordenados por `orden`. Un `ajuste` reinicia el
 * estado al saldo que traiga: es lo que permite que un partido empezado a mano
 * gane un anotador a mitad sin inventarse quién metió los puntos anteriores.
 */
export function plegarEventos(eventos: readonly EventoFila[], reglas: ReglasPartido): EstadoMarcador {
  let estado = marcadorInicial();

  for (const evento of eventos) {
    if (evento.tipo === "ajuste") {
      estado = {
        setNumero: Math.max(1, (evento.sets_a ?? 0) + (evento.sets_b ?? 0) + 1),
        puntos: { A: evento.puntos_a ?? 0, B: evento.puntos_b ?? 0 },
        sets: { A: evento.sets_a ?? 0, B: evento.sets_b ?? 0 },
        // El historial de lo jugado antes del anotador no se conoce: se deja
        // vacío en vez de inventar parciales.
        historial: [],
        terminado: false,
        winner: null
      };
      const ganador = ganadorDelPartido(reglas, estado.sets.A, estado.sets.B);
      if (ganador) {
        estado.terminado = true;
        estado.winner = ganador;
      }
      continue;
    }

    if (!evento.lado_punto) continue;
    estado = aplicarPunto(estado, evento.lado_punto, reglas);
  }

  return estado;
}

export interface EstadisticasJugador {
  puntos: number;
  remates: number;
  bloqueos: number;
  aces: number;
  defensas: number;
  errores: number;
}

const vacias = (): EstadisticasJugador => ({
  puntos: 0,
  remates: 0,
  bloqueos: 0,
  aces: 0,
  defensas: 0,
  errores: 0
});

/**
 * Lo que cada jugador hizo, según el log.
 *
 * `puntos` cuenta solo las acciones que ganaron el punto **para su propio
 * equipo**: un error suma a `errores` de quien lo comete y no suma `puntos` a
 * nadie. La invariante es «todo punto tiene una acción con un jugador detrás»,
 * no «todo punto suma a la ficha de alguien».
 */
export function estadisticasDeEventos(eventos: readonly EventoFila[]): Map<number, EstadisticasJugador> {
  const porJugador = new Map<number, EstadisticasJugador>();

  for (const evento of eventos) {
    if (evento.jugador_id === null || evento.tipo === "ajuste") continue;

    const fila = porJugador.get(evento.jugador_id) ?? vacias();
    const metrica = METRICA_DE_TIPO[evento.tipo];
    if (metrica) fila[metrica as keyof EstadisticasJugador] += 1;
    if (PUNTUA[evento.tipo] && evento.lado_punto !== null && evento.lado_punto === evento.lado_jugador) {
      fila.puntos += 1;
    }

    porJugador.set(evento.jugador_id, fila);
  }

  return porJugador;
}
