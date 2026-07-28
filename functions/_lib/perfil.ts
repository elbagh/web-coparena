// Ficha de jugador ("Mi zona"): valores admitidos y validación.
//
// Vive en _lib porque la usan dos endpoints con reglas idénticas: /api/perfil,
// donde cada uno edita la suya, y /api/admin/usuarios, donde el administrador
// edita la de cualquiera. Si las reglas se duplicaran, acabarían divergiendo.
//
// Los mismos valores están replicados en public/assets/perfil.js: al tocar
// aquí, tocar allí.

import { limpiar } from "./validacion";

export const POSICIONES = ["Bloqueo", "Defensa", "Todoterreno"];
export const MANOS = ["Diestro", "Zurdo", "Ambidiestro"];
export const ATRIBUTOS = ["saque", "remate", "bloqueo", "defensa", "recepcion", "colocacion"];

export interface PerfilValidado {
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
  atributos: Record<string, number>;
}

/** Lee la columna `atributos` (JSON) descartando lo que no sea un 1–5 conocido. */
export function parseAtributos(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const limpio: Record<string, number> = {};
    for (const key of ATRIBUTOS) {
      const valor = obj[key];
      if (typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= 5) {
        limpio[key] = valor;
      }
    }
    return limpio;
  } catch {
    return {};
  }
}

export function validarPerfil(raw: unknown): { perfil: PerfilValidado } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const apodo = limpiar(body.apodo);
  if (apodo && apodo.length > 40) campos.apodo = "El apodo no puede pasar de 40 caracteres.";

  const lema = limpiar(body.lema);
  if (lema && lema.length > 80) campos.lema = "El lema no puede pasar de 80 caracteres.";

  let dorsal: number | null = null;
  if (body.dorsal !== undefined && body.dorsal !== null && body.dorsal !== "") {
    const n = Number(body.dorsal);
    if (!Number.isInteger(n) || n < 0 || n > 99) campos.dorsal = "El dorsal debe estar entre 0 y 99.";
    else dorsal = n;
  }

  let posicion: string | null = null;
  if (body.posicion !== undefined && body.posicion !== null && body.posicion !== "") {
    if (!POSICIONES.includes(String(body.posicion))) campos.posicion = "Elige una posición válida.";
    else posicion = String(body.posicion);
  }

  let mano: string | null = null;
  if (body.mano !== undefined && body.mano !== null && body.mano !== "") {
    if (!MANOS.includes(String(body.mano))) campos.mano = "Elige una opción válida.";
    else mano = String(body.mano);
  }

  const atributos: Record<string, number> = {};
  if (body.atributos !== undefined && body.atributos !== null) {
    if (typeof body.atributos !== "object") {
      campos.atributos = "Los atributos no son válidos.";
    } else {
      const src = body.atributos as Record<string, unknown>;
      for (const key of ATRIBUTOS) {
        const valor = src[key];
        if (valor === undefined || valor === null || valor === "") continue;
        const n = Number(valor);
        if (!Number.isInteger(n) || n < 1 || n > 5) campos[`atributos.${key}`] = "Puntúa del 1 al 5.";
        else atributos[key] = n;
      }
    }
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { perfil: { apodo: apodo || null, dorsal, posicion, mano, lema: lema || null, atributos } };
}

/** Upsert de la ficha. `usuarioId` permite al panel guardar la de otra persona. */
export async function guardarPerfil(db: D1Database, usuarioId: number, perfil: PerfilValidado): Promise<void> {
  await db
    .prepare(
      `INSERT INTO perfiles (usuario_id, apodo, dorsal, posicion, mano, lema, atributos, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
       ON CONFLICT(usuario_id) DO UPDATE SET
         apodo = ?2, dorsal = ?3, posicion = ?4, mano = ?5, lema = ?6, atributos = ?7,
         updated_at = datetime('now')`
    )
    .bind(usuarioId, perfil.apodo, perfil.dorsal, perfil.posicion, perfil.mano, perfil.lema, JSON.stringify(perfil.atributos))
    .run();
}
