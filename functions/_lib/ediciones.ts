// Helpers de ediciones (anos de la Copa Arena). Solo hay una edicion "actual"
// (es_actual = 1); es la unica sobre la que se puede inscribir/editar.

export interface EdicionActual {
  id: number;
  anio: number;
  nombre: string;
  estado: string;
}

export async function edicionActual(db: D1Database): Promise<EdicionActual | null> {
  return await db
    .prepare("SELECT id, anio, nombre, estado FROM ediciones WHERE es_actual = 1 LIMIT 1")
    .first<EdicionActual>();
}
