// Helpers de ediciones (anos de la Copa Arena). Solo hay una edicion "actual"
// (es_actual = 1); es la unica sobre la que se puede inscribir/editar.

export interface EdicionActual {
  id: number;
  anio: number;
  nombre: string;
  estado: string;
  inscripcionesAbiertas: boolean;
}

interface EdicionActualRow {
  id: number;
  anio: number;
  nombre: string;
  estado: string;
  inscripciones_abiertas: number;
}

export async function edicionActual(db: D1Database): Promise<EdicionActual | null> {
  const fila = await db
    .prepare(
      "SELECT id, anio, nombre, estado, inscripciones_abiertas FROM ediciones WHERE es_actual = 1 LIMIT 1"
    )
    .first<EdicionActualRow>();
  if (!fila) return null;
  return {
    id: fila.id,
    anio: fila.anio,
    nombre: fila.nombre,
    estado: fila.estado,
    inscripcionesAbiertas: fila.inscripciones_abiertas === 1
  };
}
