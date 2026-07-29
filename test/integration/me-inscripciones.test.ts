import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/api/me";
import { ctx } from "../helpers/ctx";
import { cerrarInscripcionesEdicionActual, crearUsuario, peticion } from "../helpers/db";

/*
 * /inscripcion/ pinta el aviso de cierre a partir de este campo, incluso antes
 * de iniciar sesión — de ahí las dos comprobaciones, con y sin usuario.
 */
describe("GET /api/me — inscripcionesAbiertas", () => {
  it("es true por defecto, para un usuario logueado y para uno anónimo", async () => {
    const user = await crearUsuario();
    const conSesion = await onRequestGet(ctx(await peticion("/api/me", { user }), env));
    const sinSesion = await onRequestGet(ctx(await peticion("/api/me"), env));

    expect((await conSesion.json()) as { inscripcionesAbiertas: boolean }).toMatchObject({
      inscripcionesAbiertas: true
    });
    expect((await sinSesion.json()) as { inscripcionesAbiertas: boolean }).toMatchObject({
      inscripcionesAbiertas: true
    });
  });

  it("pasa a false tras cerrar las inscripciones de la edición actual", async () => {
    await cerrarInscripcionesEdicionActual();
    const respuesta = await onRequestGet(ctx(await peticion("/api/me"), env));

    expect((await respuesta.json()) as { inscripcionesAbiertas: boolean }).toMatchObject({
      inscripcionesAbiertas: false
    });
  });
});
