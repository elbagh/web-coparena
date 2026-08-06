// Cómo se lee un torneo entero: fases, grupos, equipos, partidos y la
// clasificación de cada grupo.
//
// Vive aquí y no dentro de un endpoint porque lo usan dos: el panel y la página
// pública. Si cada uno montara la suya, un día la clasificación que ve la
// organización y la que ve el público dejarían de coincidir, y no habría forma
// de saber cuál miente.

import { clasificacionDeGrupo, type PartidoClasificable } from "./clasificacion";
import { calcularClasificados, type GrupoParaClasificar } from "./clasificados";
import { normalizarReglas, reglasEfectivas, setsMaximos } from "./reglas";
import type { FaseRow, GrupoRow } from "./torneo";

export interface PartidoVistaRow {
  id: string;
  ronda: string;
  fase_id: number | null;
  grupo_id: number | null;
  ronda_orden: number | null;
  posicion: number | null;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  scheduled_at: string | null;
  pista: string | null;
  status: "scheduled" | "live" | "finished";
  sets_a: number;
  sets_b: number;
  points_a: number;
  points_b: number;
  set_history: string;
  winner: "A" | "B" | null;
  reglas: string;
  siguiente_partido_id: string | null;
  perdedor_partido_id: string | null;
  /**
   * 1 si el partido tiene log de anotación, y por tanto hay historial que abrir.
   *
   * No sale de una columna de `partidos` porque ninguna de las dos que lo parecen
   * sirve: `soltarAnotacion` devuelve `origen_marcador` a `'manual'` dejando el
   * log intacto, y `log_version` sube también al publicar el partido o al mover
   * el cronómetro, sin que exista un solo evento. Las dos ofrecerían el enlace a
   * un historial vacío o lo esconderían habiéndolo.
   */
  tiene_log: number;
}

export async function cargarTorneo(db: D1Database, edicionId: number) {
  const [fases, grupos, asignados, partidos, equipos] = await Promise.all([
    db
      .prepare("SELECT * FROM torneo_fases WHERE edicion_id = ?1 ORDER BY orden ASC, id ASC")
      .bind(edicionId)
      .all<FaseRow>(),
    db
      .prepare(
        `SELECT g.* FROM torneo_grupos g
           JOIN torneo_fases f ON f.id = g.fase_id
          WHERE f.edicion_id = ?1
          ORDER BY g.orden ASC, g.id ASC`
      )
      .bind(edicionId)
      .all<GrupoRow>(),
    db
      .prepare(
        `SELECT ge.grupo_id, ge.equipo_id, ge.retirado, e.nombre
           FROM torneo_grupo_equipos ge
           JOIN equipos e ON e.id = ge.equipo_id
           JOIN torneo_fases f ON f.id = ge.fase_id
          WHERE f.edicion_id = ?1
          ORDER BY ge.orden ASC, e.nombre COLLATE NOCASE ASC`
      )
      .bind(edicionId)
      .all<{ grupo_id: number; equipo_id: number; nombre: string; retirado: number }>(),
    db
      .prepare(
        // El EXISTS es una sonda al índice de UNIQUE(partido_id, orden) por
        // partido: son treinta en una lectura que está cacheada 30 s y no se
        // sondea. Contar los eventos sería leer el log entero del torneo.
        `SELECT p.*,
                EXISTS (SELECT 1 FROM partido_eventos e WHERE e.partido_id = p.id) AS tiene_log
           FROM partidos p
          WHERE p.edicion_id = ?1
          ORDER BY p.ronda_orden ASC, p.posicion ASC, p.sort_order ASC, p.created_at ASC`
      )
      .bind(edicionId)
      .all<PartidoVistaRow>(),
    db
      .prepare("SELECT id, nombre FROM equipos WHERE edicion_id = ?1 ORDER BY nombre COLLATE NOCASE ASC")
      .bind(edicionId)
      .all<{ id: number; nombre: string }>()
  ]);

  const grupoDeEquipo = new Map<number, number>();
  asignados.results.forEach((fila) => grupoDeEquipo.set(fila.equipo_id, fila.grupo_id));

  const fasesSalida = fases.results.map((fase) => {
    const gruposDeFase = grupos.results.filter((g) => g.fase_id === fase.id);
    const partidosDeFase = partidos.results.filter((p) => p.fase_id === fase.id);

    const reglasDeFase = normalizarReglas(fase.reglas);

    // Primero cada grupo por su cuenta; el reparto de plazas mira a todos a la vez.
    const calculados = gruposDeFase.map((grupo) => {
      const equiposDelGrupo = asignados.results
        .filter((a) => a.grupo_id === grupo.id)
        .map((a) => ({ id: a.equipo_id, nombre: a.nombre, retirado: a.retirado === 1 }));
      const reglas = reglasEfectivas(fase, grupo);

      return {
        grupo,
        equiposDelGrupo,
        reglas,
        /** Quien no compite la fase siguiente: sigue en la tabla, no ocupa plaza. */
        retirados: new Set(equiposDelGrupo.filter((e) => e.retirado).map((e) => e.id)),
        /** El cupo del grupo si lo tiene; si no, el de la fase. */
        clasifican: grupo.clasifican ?? fase.clasifican,
        enRepesca: grupo.en_repesca !== 0,
        clasificacion: clasificacionDeGrupo(
          equiposDelGrupo,
          partidosDeFase.filter((p) => p.grupo_id === grupo.id).map(aClasificable),
          reglas.clasificacion
        )
      };
    });

    const paraClasificar: GrupoParaClasificar[] = calculados.map((c) => ({
      id: c.grupo.id,
      nombre: c.grupo.nombre,
      clasifican: c.clasifican,
      enRepesca: c.enRepesca,
      retirados: c.retirados,
      clasificacion: c.clasificacion
    }));
    const { condiciones } = calcularClasificados(
      paraClasificar,
      fase.repesca,
      reglasDeFase.clasificacion.desempates
    );

    return {
      id: fase.id,
      clave: fase.clave,
      nombre: fase.nombre,
      tipo: fase.tipo,
      orden: fase.orden,
      clasifican: fase.clasifican,
      repesca: fase.repesca,
      reglas: reglasDeFase,
      grupos: calculados.map((c) => ({
        id: c.grupo.id,
        nombre: c.grupo.nombre,
        orden: c.grupo.orden,
        /** null si hereda; distinguirlo de «iguales por casualidad» importa al editar. */
        reglasPropias: c.grupo.reglas === null ? null : normalizarReglas(c.grupo.reglas),
        reglas: c.reglas,
        /** Ya resuelto: el del grupo si lo tiene, si no el de la fase. */
        clasifican: c.clasifican,
        /** null en el grupo significa que hereda, y al editar hay que saberlo. */
        clasificanPropio: c.grupo.clasifican,
        enRepesca: c.enRepesca,
        equipos: c.equiposDelGrupo,
        clasificacion: c.clasificacion.map((fila) => ({
          ...fila,
          clasifica: condiciones.get(fila.equipoId) ?? null
        }))
      })),
      partidos: partidosDeFase.map(mapPartido)
    };
  });

  return {
    fases: fasesSalida,
    equipos: equipos.results.map((e) => ({ ...e, grupoId: grupoDeEquipo.get(e.id) ?? null })),
    // Los partidos sueltos (amistoso, repesca) siguen existiendo y no cuelgan de
    // ninguna fase: se enseñan aparte en vez de desaparecer.
    sueltos: partidos.results.filter((p) => p.fase_id === null).map(mapPartido)
  };
}

/** Suma de los puntos de todos los sets, no el marcador del set en curso. */
export function puntosTotales(historial: string, caidaA: number, caidaB: number): { a: number; b: number } {
  try {
    const sets = JSON.parse(historial);
    if (Array.isArray(sets) && sets.length > 0) {
      return sets.reduce(
        (total: { a: number; b: number }, set: { a?: number; b?: number }) => ({
          a: total.a + (Number(set.a) || 0),
          b: total.b + (Number(set.b) || 0)
        }),
        { a: 0, b: 0 }
      );
    }
  } catch {
    /* historial ilegible: se cae al marcador plano */
  }
  // Un partido cerrado a mano puede no tener historial: queda lo que se tecleó.
  return { a: caidaA, b: caidaB };
}

export function aClasificable(partido: PartidoVistaRow): PartidoClasificable {
  const reglas = normalizarReglas(partido.reglas).partido;
  const puntos = puntosTotales(partido.set_history, partido.points_a, partido.points_b);
  return {
    equipoAId: partido.equipo_a_id,
    equipoBId: partido.equipo_b_id,
    setsA: partido.sets_a,
    setsB: partido.sets_b,
    puntosA: puntos.a,
    puntosB: puntos.b,
    status: partido.status,
    setDecisivo: partido.sets_a + partido.sets_b >= setsMaximos(reglas)
  };
}

export const mapPartido = (partido: PartidoVistaRow) => ({
  id: partido.id,
  ronda: partido.ronda,
  grupoId: partido.grupo_id,
  rondaOrden: partido.ronda_orden,
  posicion: partido.posicion,
  scheduledAt: partido.scheduled_at,
  pista: partido.pista,
  status: partido.status,
  sets: { A: partido.sets_a, B: partido.sets_b },
  points: { A: partido.points_a, B: partido.points_b },
  history: leerHistorial(partido.set_history),
  reglas: normalizarReglas(partido.reglas).partido,
  winner: partido.winner,
  teams: {
    A: { id: partido.equipo_a_id, name: partido.equipo_a_nombre },
    B: { id: partido.equipo_b_id, name: partido.equipo_b_nombre }
  },
  siguientePartidoId: partido.siguiente_partido_id,
  perdedorPartidoId: partido.perdedor_partido_id,
  /** Si hay log, `/torneo/` ofrece el historial; si no, el enlace no existe. */
  conHistorial: partido.tiene_log === 1
});

function leerHistorial(valor: string) {
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
