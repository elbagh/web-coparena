import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPatch as miEquipoPatch } from "../../functions/api/mi-equipo";
import { onRequestPatch as jugadoresPatch, onRequestPost as jugadoresPost } from "../../functions/api/admin/jugadores";
import { leerAlineacion } from "../../functions/_lib/eventos";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, crearUsuario, peticion } from "../helpers/db";

/*
 * La 0022 mueve la ficha del cromo (apodo, dorsal, posición, mano, lema) y el
 * metal desde `perfiles` —que colgaba de la cuenta de Google— a `jugadores`.
 *
 * Lo que se prueba aquí es que esas columnas son de verdad del jugador: que
 * nacen con su valor de serie, que el panel las escribe, y sobre todo que
 * **nadie las borra sin querer** desde los otros dos caminos que tocan la misma
 * fila (el editor de plantilla y el cambio de equipo).
 */

const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  Object.entries(campos).forEach(([k, v]) => fd.append(k, v));
  return fd;
};

describe("esquema del cromo", () => {
  it("un jugador recién inscrito nace en bronce y con la ficha en blanco", async () => {
    const equipo = await crearEquipo();

    const fila = await env.DB
      .prepare("SELECT apodo, dorsal, posicion, mano, lema, nivel FROM jugadores WHERE id = ?1")
      .bind(equipo.jugadores[0]!.id)
      .first<Record<string, unknown>>();

    expect(fila).toEqual({
      apodo: null,
      dorsal: null,
      posicion: null,
      mano: null,
      lema: null,
      nivel: "bronce"
    });
  });
});

describe("POST/PATCH /api/admin/jugadores", () => {
  it("da de alta a alguien con su ficha del cromo", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const respuesta = await jugadoresPost(
      ctx(
        await peticion("/api/admin/jugadores", {
          method: "POST",
          user: admin,
          body: formulario({
            equipoId: String(equipo.id),
            nombre: "Marta",
            apellidos: "Souto",
            telefono: "612345678",
            email: "marta@example.com",
            apodo: "La Muralla",
            dorsal: "7",
            posicion: "Bloqueo",
            mano: "Zurdo",
            lema: "La red es mía"
          })
        }),
        env
      )
    );

    expect(respuesta.status).toBe(201);
    const datos = (await respuesta.json()) as { jugador: Record<string, unknown> };
    expect(datos.jugador).toMatchObject({
      apodo: "La Muralla",
      dorsal: 7,
      posicion: "Bloqueo",
      mano: "Zurdo",
      lema: "La red es mía",
      // El metal se pone en /admin/estadisticas/: aquí nace de serie.
      nivel: "bronce"
    });
  });

  it("funde los errores de contacto y de ficha en una sola respuesta", async () => {
    // Validados por separado, un móvil mal escrito y una posición inventada
    // obligarían a guardar dos veces para enterarse de los dos.
    const admin = await crearAdmin();
    const equipo = await crearEquipo();

    const respuesta = await jugadoresPost(
      ctx(
        await peticion("/api/admin/jugadores", {
          method: "POST",
          user: admin,
          body: formulario({
            equipoId: String(equipo.id),
            nombre: "Marta",
            apellidos: "Souto",
            telefono: "no es un móvil",
            posicion: "Portera"
          })
        }),
        env
      )
    );

    expect(respuesta.status).toBe(400);
    const campos = ((await respuesta.json()) as { campos: Record<string, string> }).campos;
    expect(Object.keys(campos).sort()).toEqual(["posicion", "telefono"]);
  });

  it("mover de equipo no le borra el cromo a nadie", async () => {
    const admin = await crearAdmin();
    // Apellidos explícitos: los que genera `crearEquipo` llevan dígitos y no
    // pasarían la validación al reenviarlos en el formulario.
    const origen = await crearEquipo({
      nombre: "Los De Aqui",
      jugadores: [
        { nombre: "Fija", apellidos: "Quieta" },
        { nombre: "Viajera", apellidos: "Souto", apodo: "La Nomada", dorsal: 3, posicion: "Defensa" }
      ]
    });
    const destino = await crearEquipo({ nombre: "Los De Alla" });
    const viajera = origen.jugadores[1]!;

    const respuesta = await jugadoresPatch(
      ctx(
        await peticion(`/api/admin/jugadores?id=${viajera.id}`, {
          method: "PATCH",
          user: admin,
          body: formulario({
            equipoId: String(destino.id),
            nombre: viajera.nombre,
            apellidos: viajera.apellidos,
            telefono: viajera.telefono,
            email: viajera.email ?? "",
            apodo: "La Nomada",
            dorsal: "3",
            posicion: "Defensa"
          })
        }),
        env
      )
    );

    expect(respuesta.status).toBe(200);
    const fila = await env.DB
      .prepare("SELECT equipo_id, apodo, dorsal, posicion FROM jugadores WHERE id = ?1")
      .bind(viajera.id)
      .first<Record<string, unknown>>();
    expect(fila).toMatchObject({ equipo_id: destino.id, apodo: "La Nomada", dorsal: 3, posicion: "Defensa" });
  });
});

describe("PATCH /api/mi-equipo", () => {
  it("guardar la plantilla no toca el cromo de nadie", async () => {
    /*
     * `_lib/equipo-editor.ts` es el único sitio donde se escribe una plantilla,
     * y su UPDATE no menciona las columnas del cromo, así que sobreviven. Es un
     * invariante frágil: el día que alguien añada `apodo = ?` a ese UPDATE,
     * guardar la plantilla desde /mi-equipo/ borraría el cromo del equipo
     * entero — hecho por su propio capitán, sin que la organización se entere.
     * Este test es el candado.
     */
    const user = await crearUsuario({ email: "capitana@example.com" });
    const equipo = await crearEquipo({
      jugadores: [
        {
          nombre: "Capitana",
          apellidos: "Ferro",
          email: user.email,
          apodo: "La Jefa",
          dorsal: 1,
          posicion: "Bloqueo",
          nivel: "oro"
        },
        { nombre: "Compi", apellidos: "Rega", apodo: "El Otro", dorsal: 2, mano: "Zurdo" }
      ]
    });

    const respuesta = await miEquipoPatch(
      ctx(
        await peticion("/api/mi-equipo", {
          method: "PATCH",
          user,
          json: {
            equipo: "Nombre Cambiado",
            capitan: 0,
            jugadores: equipo.jugadores.map((j) => ({
              id: j.id,
              nombre: j.nombre,
              apellidos: j.apellidos,
              telefono: j.telefono,
              email: j.email ?? ""
            }))
          }
        }),
        env
      )
    );
    expect(respuesta.status).toBe(200);

    const { results } = await env.DB
      .prepare("SELECT apodo, dorsal, posicion, mano, nivel FROM jugadores WHERE equipo_id = ?1 ORDER BY orden")
      .bind(equipo.id)
      .all<Record<string, unknown>>();

    expect(results[0]).toMatchObject({ apodo: "La Jefa", dorsal: 1, posicion: "Bloqueo", nivel: "oro" });
    expect(results[1]).toMatchObject({ apodo: "El Otro", dorsal: 2, mano: "Zurdo" });
  });
});

describe("leerAlineacion", () => {
  it("saca el dorsal del jugador, sin pasar por la cuenta de Google", async () => {
    // Antes lo cruzaba por correo con `perfiles`, así que quien nunca había
    // iniciado sesión salía sin dorsal en los botones del anotador.
    const equipo = await crearEquipo({
      jugadores: [{ nombre: "Sindorsal" }, { nombre: "Condorsal", dorsal: 12, email: null }]
    });
    const partidoId = await crearPartido();

    for (const [i, jugador] of equipo.jugadores.entries()) {
      await env.DB.prepare(
        "INSERT INTO partido_alineacion (partido_id, jugador_id, lado, orden) VALUES (?1, ?2, 'A', ?3)"
      )
        .bind(partidoId, jugador.id, i)
        .run();
    }

    const alineacion = await leerAlineacion(env.DB, partidoId);
    expect(alineacion.map((a) => a.dorsal)).toEqual([null, 12]);
  });
});
