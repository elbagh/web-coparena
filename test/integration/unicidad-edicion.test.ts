import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost as jugadorAdminPost } from "../../functions/api/admin/jugadores";
import { onRequestPatch as equipoAdminPatch } from "../../functions/api/admin/equipos";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEdicion, crearEquipo, peticion } from "../helpers/db";

/*
 * Desde la migración 0010 la unicidad de jugador (nombre completo, móvil y
 * correo) es **por edición**, no global. Es lo que permite que alguien vuelva a
 * jugar al año siguiente y que su ficha pública tenga historial de verdad.
 *
 * Dentro del mismo año la regla sigue en pie, y eso es lo que más importa
 * sujetar: relajarla de más convertiría el álbum en un listado con duplicados.
 */

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  Object.entries(campos).forEach(([clave, valor]) => datos.append(clave, valor));
  return datos;
};

describe("unicidad de jugador por edición", () => {
  it("la misma persona puede estar en dos ediciones distintas", async () => {
    const pasada = await crearEdicion({ anio: 2025 });

    const antigua = await crearEquipo({
      nombre: "Los De 2025",
      edicionId: pasada.id,
      jugadores: [{ nombre: "Iago", apellidos: "Garcia", telefono: "600111222", email: "iago@example.com" }, {}]
    });
    const nueva = await crearEquipo({
      nombre: "Los De 2026",
      jugadores: [{ nombre: "Iago", apellidos: "Garcia", telefono: "600111222", email: "iago@example.com" }, {}]
    });

    expect(antigua.jugadores[0]!.id).not.toBe(nueva.jugadores[0]!.id);

    const filas = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM jugadores WHERE email_normalizado = 'iago@example.com'")
      .first<{ n: number }>();
    expect(filas!.n).toBe(2);
  });

  it("dentro de la misma edición sigue sin poder repetirse", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({
      jugadores: [{ nombre: "Ana", apellidos: "Lopez", telefono: "600333444", email: "ana@example.com" }, {}]
    });
    const otro = await crearEquipo({ nombre: "Otro Equipo" });

    const respuesta = await jugadorAdminPost(
      ctx(
        await peticion("/api/admin/jugadores", {
          method: "POST",
          user: admin,
          body: formulario({
            equipoId: String(otro.id),
            nombre: "Ana",
            apellidos: "Lopez",
            telefono: "600333444",
            email: "ana@example.com"
          })
        }),
        env
      )
    );

    expect(respuesta.status).toBe(409);
    const datos = (await respuesta.json()) as { campos: Record<string, string> };
    expect(datos.campos.nombre).toBeDefined();
    expect(datos.campos.telefono).toBeDefined();
    expect(datos.campos.email).toBeDefined();
    expect(equipo.jugadores).toHaveLength(2);
  });

  it("editar un equipo no choca con quien jugó una edición anterior", async () => {
    const admin = await crearAdmin();
    const pasada = await crearEdicion({ anio: 2025 });
    await crearEquipo({
      nombre: "Los De Antes",
      edicionId: pasada.id,
      jugadores: [{ nombre: "Bea", apellidos: "Rios", telefono: "600555666", email: "bea@example.com" }, {}]
    });
    // Nombres sin dígitos: los que genera el sembrador por defecto (Jugador12)
    // no pasan la validación al reenviarlos.
    const actual = await crearEquipo({
      nombre: "Los De Ahora",
      jugadores: [
        { nombre: "Carla", apellidos: "Miño", telefono: "600777888", email: "carla@example.com" },
        { nombre: "Dani", apellidos: "Souto", telefono: "600999000", email: "dani@example.com" }
      ]
    });

    // El editor de equipo del panel va por multipart con el JSON en `payload`.
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        equipo: "Los De Ahora",
        jugadores: [
          {
            id: actual.jugadores[0]!.id,
            nombre: "Bea",
            apellidos: "Rios",
            telefono: "600555666",
            email: "bea@example.com"
          },
          {
            id: actual.jugadores[1]!.id,
            nombre: actual.jugadores[1]!.nombre,
            apellidos: actual.jugadores[1]!.apellidos,
            telefono: actual.jugadores[1]!.telefono,
            email: actual.jugadores[1]!.email
          }
        ]
      })
    );

    const respuesta = await equipoAdminPatch(
      ctx(await peticion(`/api/admin/equipos?id=${actual.id}`, { method: "PATCH", user: admin, body: form }), env)
    );

    expect(respuesta.status).toBe(200);
  });
});
