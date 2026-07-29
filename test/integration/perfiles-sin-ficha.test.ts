import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet as jugadoresGet } from "../../functions/api/jugadores";
import { onRequestGet as perfilGet, onRequestPatch as perfilPatch } from "../../functions/api/perfil";
import { ctx } from "../helpers/ctx";
import { crearEquipo, crearUsuario, peticion, sembrarFoto } from "../helpers/db";

/*
 * La 0024 deja `perfiles` con lo único que sigue siendo de la cuenta de Google:
 * el avatar. La ficha del cromo se fue a `jugadores` en la 0023.
 *
 * Lo que se prueba aquí es que el corte está hecho de verdad —que no quedó
 * ningún SELECT leyendo las columnas borradas, que es como se cae un endpoint
 * en producción sin que ningún test se entere— y que el avatar, que NO se ha
 * movido, sigue funcionando en los tres sitios que dependen de él.
 *
 * El cuerpo de la migración (la repesca y el cerrojo) no se prueba aquí: para
 * cuando estos tests corren, las columnas ya no existen y el SQL no se puede ni
 * compilar. Se verificó a mano contra un D1 local sembrado con los tres casos
 * —ficha varada, ficha que no debe pisar a la del panel, y huérfana sin
 * inscripción— y queda anotado en el PR.
 */

describe("esquema tras la 0024", () => {
  it("`perfiles` se queda solo con el avatar", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('perfiles')").all<{
      name: string;
    }>();
    const columnas = results.map((c) => c.name).sort();

    expect(columnas).toEqual(["avatar_key", "created_at", "updated_at", "usuario_id"]);
  });

  it("la ficha vive en `jugadores`", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('jugadores')").all<{
      name: string;
    }>();
    const columnas = results.map((c) => c.name);

    ["apodo", "dorsal", "posicion", "mano", "lema", "nivel"].forEach((c) => expect(columnas).toContain(c));
  });
});

describe("nada lee ya las columnas borradas", () => {
  it("GET /api/perfil sigue devolviendo la ficha, desde el jugador", async () => {
    const user = await crearUsuario({ email: "sigue@example.com" });
    await crearEquipo({
      jugadores: [{ email: user.email, apodo: "La Que Sigue", dorsal: 5, posicion: "Bloqueo", mano: "Zurdo" }, {}]
    });

    const respuesta = await perfilGet(ctx(await peticion("/api/perfil", { user }), env));
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as { perfil: Record<string, unknown> };
    expect(datos.perfil).toMatchObject({
      apodo: "La Que Sigue",
      dorsal: 5,
      posicion: "Bloqueo",
      mano: "Zurdo",
      nivel: "bronce"
    });
  });

  it("PATCH /api/perfil sigue guardando sobre el jugador", async () => {
    const user = await crearUsuario({ email: "guarda@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: user.email }, {}] });

    const respuesta = await perfilPatch(
      ctx(await peticion("/api/perfil", { method: "PATCH", user, json: { apodo: "Nuevo" } }), env)
    );
    expect(respuesta.status).toBe(200);

    const fila = await env.DB.prepare("SELECT apodo FROM jugadores WHERE id = ?1")
      .bind(equipo.jugadores[0]!.id)
      .first<{ apodo: string }>();
    expect(fila!.apodo).toBe("Nuevo");
  });

  it("el álbum sigue pintando la ficha de cada jugador", async () => {
    await crearEquipo({ jugadores: [{ nombre: "Cromo", apodo: "El Cromo", posicion: "Defensa" }, {}] });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as { jugadores: { nombre: string; apodo: string | null }[] };

    expect(datos.jugadores.find((j) => j.nombre === "Cromo")!.apodo).toBe("El Cromo");
  });
});

describe("el avatar no se ha movido", () => {
  /*
   * `avatar_key` es lo único que sobrevive en `perfiles`, y de él dependen tres
   * cosas: `tieneAvatar` en Mi zona, `tieneFoto` en el álbum y el respaldo de
   * `?foto=N`. Si alguien quita el join que queda a `perfiles`, esto es lo que
   * lo caza.
   */
  const sembrarAvatar = async (usuarioId: number, contenido = "avatar") =>
    env.DB.prepare("INSERT INTO perfiles (usuario_id, avatar_key) VALUES (?1, ?2)")
      .bind(usuarioId, await sembrarFoto(`avatares/${usuarioId}.jpg`, contenido))
      .run();

  it("Mi zona sigue sabiendo que hay avatar", async () => {
    const user = await crearUsuario({ email: "conavatar@example.com" });
    await sembrarAvatar(user.id);

    const respuesta = await perfilGet(ctx(await peticion("/api/perfil", { user }), env));
    const datos = (await respuesta.json()) as { perfil: { tieneAvatar: boolean } };

    expect(datos.perfil.tieneAvatar).toBe(true);
  });

  it("el álbum sigue dando por puesto el cromo de quien solo tiene avatar", async () => {
    const user = await crearUsuario({ email: "soloavatar@example.com" });
    await sembrarAvatar(user.id);
    await crearEquipo({ jugadores: [{ nombre: "Retratada", email: user.email }, { nombre: "Anonima" }] });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as { jugadores: { nombre: string; tieneFoto: boolean }[] };

    expect(datos.jugadores.find((j) => j.nombre === "Retratada")!.tieneFoto).toBe(true);
    expect(datos.jugadores.find((j) => j.nombre === "Anonima")!.tieneFoto).toBe(false);
  });

  it("?foto=N sigue cayendo al avatar cuando no hay foto de inscripción", async () => {
    const user = await crearUsuario({ email: "respaldo@example.com" });
    await sembrarAvatar(user.id, "el-avatar");
    const equipo = await crearEquipo({ jugadores: [{ email: user.email }, {}] });

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?foto=${equipo.jugadores[0]!.id}`), env));

    expect(respuesta.status).toBe(200);
    expect(new TextDecoder().decode(await respuesta.arrayBuffer())).toBe("el-avatar");
  });
});
