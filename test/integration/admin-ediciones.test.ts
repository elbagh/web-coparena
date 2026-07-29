import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPatch } from "../../functions/api/admin/ediciones";
import { ctx } from "../helpers/ctx";
import { crearAdmin, peticion } from "../helpers/db";

interface EdicionPanel {
  id: number;
  anio: number;
  esActual: boolean;
  inscripcionesAbiertas: boolean;
}

const listar = async (user: Awaited<ReturnType<typeof crearAdmin>>) => {
  const respuesta = await onRequestGet(ctx(await peticion("/api/admin/ediciones", { user }), env));
  const cuerpo = (await respuesta.json()) as { ediciones: EdicionPanel[] };
  return cuerpo.ediciones;
};

describe("PATCH /api/admin/ediciones — inscripcionesAbiertas", () => {
  it("cierra y reabre las inscripciones de la edición actual", async () => {
    const admin = await crearAdmin();
    const [actual] = await listar(admin);
    expect(actual.inscripcionesAbiertas).toBe(true);

    const cierre = await onRequestPatch(
      ctx(
        await peticion(`/api/admin/ediciones?id=${actual.id}`, {
          method: "PATCH",
          user: admin,
          json: { inscripcionesAbiertas: false }
        }),
        env
      )
    );
    expect(cierre.status).toBe(200);
    const [cerrada] = ((await cierre.json()) as { ediciones: EdicionPanel[] }).ediciones;
    expect(cerrada.inscripcionesAbiertas).toBe(false);

    const reapertura = await onRequestPatch(
      ctx(
        await peticion(`/api/admin/ediciones?id=${actual.id}`, {
          method: "PATCH",
          user: admin,
          json: { inscripcionesAbiertas: true }
        }),
        env
      )
    );
    const [abierta] = ((await reapertura.json()) as { ediciones: EdicionPanel[] }).ediciones;
    expect(abierta.inscripcionesAbiertas).toBe(true);
  });
});
