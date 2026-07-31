import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../../functions/api/anotacion";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, peticion, type EquipoSembrado } from "../helpers/db";

/*
 * El reclamo del partido.
 *
 * El UNIQUE(partido_id, orden) impide que un punto pise a otro, pero sólo salta
 * cuando dos anotadores coinciden en el mismo hueco. Si se turnan sin llegar a
 * chocar, los dos anotan el mismo partido y ninguno se entera. Con una sola
 * pista eso no es raro: quien entra en /anotador/ se encuentra el partido en
 * juego arriba de la lista.
 *
 * El reclamo separa a dos personas; el UNIQUE sigue separando a dos pestañas de
 * la misma persona.
 */

interface Respuesta {
  anotador: { id: number | null; nombre: string | null; puedeAnotar: boolean };
  ultimaActividad: string;
  estado: { puntos: { A: number; B: number } };
  siguienteOrden: number;
  error?: string;
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> => {
  const respuesta = await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env));
  return (await respuesta.json()) as Respuesta;
};

/** Un partido con sus dos equipos y sin una sola escritura detrás: sin dueño. */
async function partidoLibre() {
  const local: EquipoSembrado = await crearEquipo({
    nombre: "Delfines",
    jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }]
  });
  const visitante: EquipoSembrado = await crearEquipo({
    nombre: "Gaviotas",
    jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }]
  });
  const partidoId = await crearPartido({ equipoA: local, equipoB: visitante, status: "live" });
  return { partidoId, local, visitante };
}

describe("quién lleva el partido", () => {
  it("un partido sin escrituras no lo lleva nadie, y cualquiera puede anotarlo", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const datos = await leer(admin, partidoId);

    expect(datos.anotador).toEqual({ id: null, nombre: null, puedeAnotar: true });
    expect(datos.ultimaActividad).toBeTruthy();
  });
});
