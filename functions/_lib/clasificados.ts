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

export type Condicion = "directo" | "repesca";

export interface GrupoParaClasificar {
  id: number;
  nombre: string;
  /** Plazas directas ya resueltas: las del grupo si las tiene, si no las de la fase. */
  clasifican: number;
  /** Si el siguiente de este grupo entra al bote de la repesca. */
  enRepesca: boolean;
  clasificacion: readonly FilaClasificacion[];
}

export interface Semilla {
  equipoId: number;
  nombre: string;
  grupoId: number;
  condicion: Condicion;
}

export interface Clasificados {
  /** equipoId → condición. Solo lleva a quien pasa. */
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
      const fila = grupo.clasificacion.find((f) => f.posicion === posicion);
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
      fila: grupo.clasificacion.find((f) => f.posicion === grupo.clasifican + 1)
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

  bote.slice(0, Math.max(0, repesca)).forEach(({ grupo, fila }) => {
    condiciones.set(fila.equipoId, "repesca");
    semillas.push({ equipoId: fila.equipoId, nombre: fila.nombre, grupoId: grupo.id, condicion: "repesca" });
  });

  return { condiciones, semillas };
}
