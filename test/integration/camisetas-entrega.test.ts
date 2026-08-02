import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPatch as patchAdmin } from "../../functions/api/admin/camisetas";
import { onRequestGet as resumenAdmin } from "../../functions/api/admin/index";
import { onRequestDelete as borrarPropia, onRequestGet as misCamisetas } from "../../functions/api/camisetas";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import {
  crearAdmin,
  crearEdicion,
  crearReservaCamiseta,
  crearUsuario,
  crearUsuarioConPermisos,
  peticion
} from "../helpers/db";

/*
 * La entrega de una camiseta.
 *
 * La organización la marca desde el panel y su dueño la ve marcada en
 * /camisetas/. Lo que hace falta probar es la asimetría: el panel puede ir y
 * volver, y quien la ha recibido ya no puede borrar el registro — es lo que le
 * deja el recuerdo de qué compró y en qué edición.
 */

const RUTA_ADMIN = "/api/admin/camisetas";

const entregadaEnBase = async (id: number) =>
  (
    await env.DB
      .prepare("SELECT entregada FROM camisetas_reservas WHERE id = ?1")
      .bind(id)
      .first<{ entregada: number }>()
  )?.entregada;

const marcar = async (id: number, entregada: boolean, quien: UsuarioSesion) =>
  patchAdmin(
    ctx(
      await peticion(`${RUTA_ADMIN}?id=${id}&accion=entrega`, { method: "PATCH", user: quien, json: { entregada } }),
      env
    )
  );

describe("marcar una reserva como entregada", () => {
  it("la marca y la devuelve a pendiente", async () => {
    const admin = await crearAdmin();
    const dueno = await crearUsuario();
    const reserva = await crearReservaCamiseta(dueno.id);

    expect(await entregadaEnBase(reserva)).toBe(0);

    const marcada = await marcar(reserva, true, admin);
    expect(marcada.status).toBe(200);
    expect(await entregadaEnBase(reserva)).toBe(1);

    const devuelta = await marcar(reserva, false, admin);
    expect(devuelta.status).toBe(200);
    expect(await entregadaEnBase(reserva)).toBe(0);
  });

  it("rechaza un cuerpo sin el campo", async () => {
    const admin = await crearAdmin();
    const dueno = await crearUsuario();
    const reserva = await crearReservaCamiseta(dueno.id);

    const respuesta = await patchAdmin(
      ctx(
        await peticion(`${RUTA_ADMIN}?id=${reserva}&accion=entrega`, {
          method: "PATCH",
          user: admin,
          json: { entregada: "si" }
        }),
        env
      )
    );

    expect(respuesta.status).toBe(400);
    expect(await entregadaEnBase(reserva)).toBe(0);
  });

  it("responde 404 sobre una reserva que ya no existe", async () => {
    const admin = await crearAdmin();

    const respuesta = await patchAdmin(
      ctx(
        await peticion(`${RUTA_ADMIN}?id=9999&accion=entrega`, { method: "PATCH", user: admin, json: { entregada: true } }),
        env
      )
    );

    expect(respuesta.status).toBe(404);
  });

  it("una cuenta sin camisetas.editar no puede marcarla", async () => {
    const mirona = await crearUsuarioConPermisos(["panel.entrar", "camisetas.ver"]);
    const dueno = await crearUsuario();
    const reserva = await crearReservaCamiseta(dueno.id);

    const respuesta = await marcar(reserva, true, mirona);

    expect(respuesta.status).toBe(403);
    expect(await entregadaEnBase(reserva)).toBe(0);
  });

  /*
   * El UPDATE de la edición no menciona la columna a propósito. Si algún día
   * alguien la añade ahí, corregir una talla desharía la entrega sin que nadie
   * lo vea: este test es el cerrojo.
   */
  it("editar la reserva desde el panel no la devuelve a pendiente", async () => {
    const admin = await crearAdmin();
    const dueno = await crearUsuario();
    const reserva = await crearReservaCamiseta(dueno.id, { talla: "M", entregada: true });

    const respuesta = await patchAdmin(
      ctx(
        await peticion(`${RUTA_ADMIN}?id=${reserva}`, {
          method: "PATCH",
          user: admin,
          json: { nombre: "Nombre Corregido", talla: "XL", cantidad: 2, notas: "" }
        }),
        env
      )
    );

    expect(respuesta.status).toBe(200);
    expect(await entregadaEnBase(reserva)).toBe(1);

    const fila = await env.DB
      .prepare("SELECT talla FROM camisetas_reservas WHERE id = ?1")
      .bind(reserva)
      .first<{ talla: string }>();
    expect(fila?.talla).toBe("XL");
  });

  it("el resumen del panel dice el estado de cada reserva", async () => {
    const admin = await crearAdmin();
    const dueno = await crearUsuario();
    const pendiente = await crearReservaCamiseta(dueno.id);
    const entregada = await crearReservaCamiseta(dueno.id, { entregada: true });

    const respuesta = await resumenAdmin(ctx(await peticion("/api/admin", { user: admin }), env));
    const datos = (await respuesta.json()) as { camisetas: { id: number; entregada: boolean }[] };

    expect(datos.camisetas.find((c) => c.id === pendiente)?.entregada).toBe(false);
    expect(datos.camisetas.find((c) => c.id === entregada)?.entregada).toBe(true);
  });
});

describe("lo que ve y puede su dueño", () => {
  it("la reserva viaja con su estado y el año de su edición", async () => {
    const dueno = await crearUsuario();
    const vieja = await crearEdicion({ anio: 2024 });
    await crearReservaCamiseta(dueno.id, { edicionId: vieja.id, entregada: true });
    await crearReservaCamiseta(dueno.id);

    const respuesta = await misCamisetas(ctx(await peticion("/api/camisetas", { user: dueno }), env));
    const datos = (await respuesta.json()) as {
      reservas: { entregada: boolean; anio: number | null }[];
    };

    expect(datos.reservas).toHaveLength(2);
    expect(datos.reservas.some((r) => r.entregada && r.anio === 2024)).toBe(true);
    expect(datos.reservas.some((r) => !r.entregada && r.anio === 2026)).toBe(true);
  });

  it("puede borrar una pendiente", async () => {
    const dueno = await crearUsuario();
    const reserva = await crearReservaCamiseta(dueno.id);

    const respuesta = await borrarPropia(
      ctx(await peticion(`/api/camisetas?id=${reserva}`, { method: "DELETE", user: dueno }), env)
    );

    expect(respuesta.status).toBe(200);
    expect(await entregadaEnBase(reserva)).toBeUndefined();
  });

  it("no puede borrar una entregada", async () => {
    const dueno = await crearUsuario();
    const reserva = await crearReservaCamiseta(dueno.id, { entregada: true });

    const respuesta = await borrarPropia(
      ctx(await peticion(`/api/camisetas?id=${reserva}`, { method: "DELETE", user: dueno }), env)
    );

    expect(respuesta.status).toBe(409);
    expect(await entregadaEnBase(reserva)).toBe(1);
  });

  /*
   * El 409 mira la reserva del usuario de la sesión, no la reserva a secas: si
   * lo hiciera al revés, la entrega de otra persona bloquearía un borrado que sí
   * es suyo, o peor, el DELETE seguiría adelante contra una fila ajena.
   */
  it("la entrega de otra persona no bloquea la suya", async () => {
    const dueno = await crearUsuario();
    const otra = await crearUsuario();
    await crearReservaCamiseta(otra.id, { entregada: true });
    const propia = await crearReservaCamiseta(dueno.id);

    const respuesta = await borrarPropia(
      ctx(await peticion(`/api/camisetas?id=${propia}`, { method: "DELETE", user: dueno }), env)
    );

    expect(respuesta.status).toBe(200);
  });
});
