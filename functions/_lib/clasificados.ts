// Quién pasa de la fase de grupos, y en qué orden entra al cuadro.
//
// Vive aparte de clasificacion.ts porque responde a otra pregunta: aquella
// ordena un grupo, esta mira todos los grupos a la vez y reparte plazas.
//
// `torneo_fases.clasifican` solo sabe decir «los N primeros de CADA grupo», y
// eso no siempre es la regla. Con grupos de tamaños distintos, el tercero de un
// grupo de cinco puede pasar directo mientras los terceros de los grupos de
// cuatro se juegan una sola plaza entre ellos.
//
// Devuelve las dos cosas de una sola pasada —los colores de la tabla y las
// semillas de la siembra— y eso es lo importante. Si el pintado saliera por un
// lado y la siembra por otro, un día la tabla diría que pasa uno y el cuadro
// colocaría a otro, sin forma de saber cuál miente.

import { valorDeCriterio, type FilaClasificacion } from "./clasificacion";
import type { CriterioDesempate } from "./reglas";

// Cuatro condiciones, dos de ellas plaza y las otras dos no:
//   - `directo`   pasa por su grupo, no depende de nadie más.
//   - `repesca`   ahora mismo ocupa la plaza que se disputa entre grupos.
//   - `aspirante` está en ese mismo bote y hoy se queda fuera.
//   - `retirado`  no puede competir, así que no ocupa plaza.
//
// `aspirante` existe porque la tabla tiene que enseñar a los DOS que se juegan
// la plaza, no solo al que va ganando. Pintar únicamente a uno decía que el otro
// está eliminado, y no lo está: le basta con ganar el último partido.
export type Condicion = "directo" | "repesca" | "aspirante" | "retirado";

/**
 * Las que de verdad dan plaza. Un aspirante no se siembra porque todavía no ha
 * pasado, y un retirado porque ya no va a pasar.
 *
 * Enumerada a mano y no con `Exclude`: con `Exclude<Condicion, "aspirante">`,
 * añadir un valor a `Condicion` lo mete aquí sin que nada falle, y un retirado
 * acabaría siendo una semilla legítima del cuadro sin un solo error de
 * compilación.
 */
export type CondicionClasificado = "directo" | "repesca";

export interface GrupoParaClasificar {
  id: number;
  nombre: string;
  /** Plazas directas ya resueltas: las del grupo si las tiene, si no las de la fase. */
  clasifican: number;
  /** Si el siguiente de este grupo entra al bote de la repesca. */
  enRepesca: boolean;
  /**
   * Quién de este grupo no puede competir la fase siguiente.
   *
   * Obligatorio, no opcional: el sembrado del cuadro monta esta estructura a
   * mano en otro fichero, y si se lo pudiera saltar la tabla pintaría a alguien
   * retirado y el cuadro lo colocaría igual.
   */
  retirados: ReadonlySet<number>;
  clasificacion: readonly FilaClasificacion[];
}

export interface Semilla {
  equipoId: number;
  nombre: string;
  grupoId: number;
  condicion: CondicionClasificado;
}

export interface Clasificados {
  /** equipoId → condición. Lleva a quien pasa y a quien todavía se lo juega. */
  condiciones: Map<number, Condicion>;
  /** En orden de siembra: todos los primeros, luego los segundos… y las repescas al final. */
  semillas: Semilla[];
}

export function calcularClasificados(
  grupos: readonly GrupoParaClasificar[],
  repesca: number,
  desempates: readonly CriterioDesempate[]
): Clasificados {
  const condiciones = new Map<number, Condicion>();
  const semillas: Semilla[] = [];

  /*
   * La tabla conserva la posición de quien se retira: se la ganó en el campo, y
   * sus partidos siguen contando para los demás. Lo que se cuenta sobre la
   * lista SIN él es el reparto de plazas — si no, saltarse al segundo dejaría
   * la segunda plaza vacía en vez de pasársela al tercero.
   *
   * Un retirado se marca aquí y ya no vuelve a aparecer en ninguno de los dos
   * bucles de abajo, así que su condición no la puede pisar nada.
   */
  const enJuego = new Map<number, readonly FilaClasificacion[]>();
  for (const grupo of grupos) {
    for (const fila of grupo.clasificacion) {
      if (grupo.retirados.has(fila.equipoId)) condiciones.set(fila.equipoId, "retirado");
    }
    enJuego.set(
      grupo.id,
      grupo.clasificacion.filter((fila) => !grupo.retirados.has(fila.equipoId))
    );
  }

  /*
   * Se siembra por posición y no grupo a grupo: primero todos los primeros,
   * luego todos los segundos. Así el emparejamiento 1.º contra último cruza
   * cabezas de serie con colistas, que es lo que hace que un cuadro tenga
   * sentido. El tope es el cupo más alto, porque los grupos pueden no tener el
   * mismo número de plazas directas.
   */
  const maximo = grupos.reduce((tope, g) => Math.max(tope, g.clasifican), 0);
  for (let posicion = 1; posicion <= maximo; posicion += 1) {
    for (const grupo of grupos) {
      if (posicion > grupo.clasifican) continue;
      // Por orden dentro de la lista en juego, no por `posicion`: son la misma
      // fila mientras no haya retirados, y cuando los hay es esta la que pasa
      // la plaza al siguiente en vez de dejarla sin dueño.
      const fila = (enJuego.get(grupo.id) ?? [])[posicion - 1];
      if (!fila) continue;
      condiciones.set(fila.equipoId, "directo");
      semillas.push({ equipoId: fila.equipoId, nombre: fila.nombre, grupoId: grupo.id, condicion: "directo" });
    }
  }

  /*
   * El bote: el siguiente de cada grupo que participe. `enfrentamiento_directo`
   * se salta porque entre equipos de grupos distintos no hay partidos que mirar
   * — daría siempre empate y solo estorbaría.
   */
  const criterios = desempates.filter((c) => c !== "enfrentamiento_directo");
  const bote = grupos
    .filter((grupo) => grupo.enRepesca)
    .map((grupo) => ({
      grupo,
      // El primero que se queda fuera de las plazas directas, retirados aparte.
      fila: (enJuego.get(grupo.id) ?? [])[grupo.clasifican]
    }))
    .filter((candidato): candidato is { grupo: GrupoParaClasificar; fila: FilaClasificacion } =>
      candidato.fila !== undefined
    );

  bote.sort((a, b) => {
    for (const criterio of criterios) {
      const diferencia = valorDeCriterio(criterio, b.fila) - valorDeCriterio(criterio, a.fila);
      if (diferencia !== 0) return diferencia;
    }
    // Empate perfecto: por nombre, para que al menos sea estable y reproducible.
    return a.fila.nombre.localeCompare(b.fila.nombre, "es");
  });

  /*
   * El bote entero queda marcado, no solo la parte de arriba: los de abajo son
   * `aspirante`. Sin plazas de repesca no hay bote que valga y nadie se marca —
   * ahí el siguiente de cada grupo simplemente está fuera.
   */
  const plazas = Math.max(0, repesca);
  bote.forEach(({ grupo, fila }, indice) => {
    if (plazas === 0) return;
    if (indice >= plazas) {
      condiciones.set(fila.equipoId, "aspirante");
      return;
    }
    condiciones.set(fila.equipoId, "repesca");
    semillas.push({ equipoId: fila.equipoId, nombre: fila.nombre, grupoId: grupo.id, condicion: "repesca" });
  });

  return { condiciones, semillas };
}
