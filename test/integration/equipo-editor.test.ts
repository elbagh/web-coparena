import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { guardarEquipo, type FotoNueva } from "../../functions/_lib/equipo-editor";
import type { JugadorValidado, RegistroValidado } from "../../functions/_lib/validacion";
import { normalizarEmail, normalizarTelefono, normalizarTexto } from "../../functions/_lib/validacion";
import { crearEquipo, sembrarFoto, type EquipoSembrado } from "../helpers/db";

/*
 * guardarEquipo es el único sitio donde se reescribe una plantilla, y lo hace
 * diferenciando por `id` precisamente para no perder las fotos. La versión
 * anterior borraba e insertaba, y al capitán le desaparecían todas las fotos del
 * equipo cada vez que cambiaba una coma. Estos tests son la red de ese diff.
 */

interface EntradaJugador {
  id?: number;
  nombre: string;
  apellidos: string;
  telefono: string;
  email?: string | null;
  redSocial?: string | null;
  eliminarFoto?: boolean;
}

/** Construye el registro ya validado que recibe guardarEquipo. */
function registro(nombreEquipo: string, jugadores: EntradaJugador[], capitan = 0): RegistroValidado {
  return {
    equipo: nombreEquipo,
    equipoNormalizado: normalizarTexto(nombreEquipo),
    capitan,
    jugadores: jugadores.map<JugadorValidado>((j) => ({
      id: j.id,
      nombre: j.nombre,
      apellidos: j.apellidos,
      nombreCompletoNormalizado: normalizarTexto(`${j.nombre} ${j.apellidos}`),
      telefono: j.telefono,
      telefonoNormalizado: normalizarTelefono(j.telefono),
      email: j.email === undefined ? null : j.email,
      emailNormalizado: j.email ? normalizarEmail(j.email) : null,
      redSocial: j.redSocial ?? null,
      eliminarFoto: j.eliminarFoto === true
    }))
  };
}

/** Los jugadores del equipo tal y como están ahora en la base. */
const filas = async (equipoId: number) =>
  (
    await env.DB
      .prepare(
        `SELECT id, nombre, apellidos, telefono, email, foto_key, es_suplente, orden, edicion_id
         FROM jugadores WHERE equipo_id = ?1 ORDER BY orden ASC, id ASC`
      )
      .bind(equipoId)
      .all<{
        id: number;
        nombre: string;
        apellidos: string;
        telefono: string;
        email: string | null;
        foto_key: string | null;
        es_suplente: number;
        orden: number;
        edicion_id: number | null;
      }>()
  ).results;

const existeEnR2 = async (key: string) => (await env.FOTOS.head(key)) !== null;

/** Convierte una fila sembrada en entrada de registro, conservando su id. */
const comoEntrada = (j: EquipoSembrado["jugadores"][number], extra: Partial<EntradaJugador> = {}): EntradaJugador => ({
  id: j.id,
  nombre: j.nombre,
  apellidos: j.apellidos,
  telefono: j.telefono,
  email: j.email,
  ...extra
});

const fotoNueva = (): FotoNueva => ({ buffer: new Uint8Array([1, 2, 3, 4]).buffer, ext: "jpg" });

describe("guardarEquipo: conservación de fotos", () => {
  // La regresión histórica que motivó todo el diff por id.
  it("un jugador enviado con su id y sin foto nueva conserva su foto", async () => {
    const key = await sembrarFoto("equipos/lote/jugador-1.jpg");
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: key }, {}] });

    const error = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!, { nombre: "Renombrada" }),
        comoEntrada(equipo.jugadores[1]!)
      ])
    );

    expect(error).toBeNull();
    const [primero] = await filas(equipo.id);
    expect(primero!.nombre).toBe("Renombrada");
    expect(primero!.foto_key).toBe(key);
    expect(await existeEnR2(key)).toBe(true);
  });

  it("eliminarFoto deja el jugador sin foto y borra el objeto de R2", async () => {
    const key = await sembrarFoto("equipos/lote/jugador-1.jpg");
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: key }, {}] });

    const error = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!, { eliminarFoto: true }),
        comoEntrada(equipo.jugadores[1]!)
      ])
    );

    expect(error).toBeNull();
    expect((await filas(equipo.id))[0]!.foto_key).toBeNull();
    expect(await existeEnR2(key)).toBe(false);
  });

  it("una foto nueva sustituye a la anterior y borra la vieja de R2", async () => {
    const vieja = await sembrarFoto("equipos/lote/jugador-1.jpg");
    const equipo = await crearEquipo({ jugadores: [{ fotoKey: vieja }, {}] });

    const error = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[1]!)]),
      new Map([[0, fotoNueva()]])
    );

    expect(error).toBeNull();
    const [primero] = await filas(equipo.id);
    expect(primero!.foto_key).not.toBe(vieja);
    expect(primero!.foto_key).toMatch(/^equipos\/.+\/jugador-1\.jpg$/);
    expect(await existeEnR2(primero!.foto_key!)).toBe(true);
    expect(await existeEnR2(vieja)).toBe(false);
  });

  it("al borrar un jugador se borra también su foto", async () => {
    const key = await sembrarFoto("equipos/lote/jugador-3.jpg");
    const equipo = await crearEquipo({ jugadores: [{}, {}, { fotoKey: key }] });

    const error = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[1]!)])
    );

    expect(error).toBeNull();
    expect(await filas(equipo.id)).toHaveLength(2);
    expect(await existeEnR2(key)).toBe(false);
  });

  it("guardar fotos sin bucket configurado devuelve 500 y no toca la base", async () => {
    const equipo = await crearEquipo();
    const sinBucket = { DB: env.DB };

    const respuesta = await guardarEquipo(
      sinBucket,
      equipo.id,
      registro("Nombre Cambiado", [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[1]!)]),
      new Map([[0, fotoNueva()]])
    );

    expect(respuesta?.status).toBe(500);
    const fila = await env.DB.prepare("SELECT nombre FROM equipos WHERE id = ?1").bind(equipo.id).first<{ nombre: string }>();
    expect(fila?.nombre).toBe(equipo.nombre);
  });
});

describe("guardarEquipo: diff de la plantilla", () => {
  it("inserta los jugadores que llegan sin id y les hereda la edición del equipo", async () => {
    const equipo = await crearEquipo();

    const error = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!),
        comoEntrada(equipo.jugadores[1]!),
        { nombre: "Nuevo", apellidos: "Fichaje", telefono: "699888777", email: "nuevo@example.com" }
      ])
    );

    expect(error).toBeNull();
    const resultado = await filas(equipo.id);
    expect(resultado).toHaveLength(3);
    expect(resultado[2]!.nombre).toBe("Nuevo");
    expect(resultado[2]!.edicion_id).toBe(equipo.edicionId);
  });

  it("actualiza en su sitio los jugadores que llegan con id, sin cambiarles el id", async () => {
    const equipo = await crearEquipo();
    const idOriginal = equipo.jugadores[0]!.id;

    await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!, { nombre: "Nombre", apellidos: "Nuevo", telefono: "611222333" }),
        comoEntrada(equipo.jugadores[1]!)
      ])
    );

    const resultado = await filas(equipo.id);
    expect(resultado[0]!.id).toBe(idOriginal);
    expect(resultado[0]!.nombre).toBe("Nombre");
    expect(resultado[0]!.telefono).toBe("611222333");
  });

  it("borra los jugadores que ya no llegan en el registro", async () => {
    const equipo = await crearEquipo({ jugadores: [{}, {}, {}, {}] });

    await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[3]!)])
    );

    const resultado = await filas(equipo.id);
    expect(resultado.map((j) => j.id)).toEqual([equipo.jugadores[0]!.id, equipo.jugadores[3]!.id]);
  });

  it("renombra el equipo y su nombre normalizado", async () => {
    const equipo = await crearEquipo();

    await guardarEquipo(
      env,
      equipo.id,
      registro("Los Ánimos", [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[1]!)])
    );

    const fila = await env.DB
      .prepare("SELECT nombre, nombre_normalizado FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ nombre: string; nombre_normalizado: string }>();
    expect(fila).toEqual({ nombre: "Los Ánimos", nombre_normalizado: "los animos" });
  });

  // Defensa en profundidad: la UI nunca debería mandar esto.
  it("rechaza con 400 un id de jugador que pertenece a otro equipo", async () => {
    const equipo = await crearEquipo();
    const ajeno = await crearEquipo();

    const respuesta = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!),
        comoEntrada(ajeno.jugadores[0]!, { id: ajeno.jugadores[0]!.id })
      ])
    );

    expect(respuesta?.status).toBe(400);
    expect(await respuesta!.json()).toMatchObject({ error: expect.stringContaining("no pertenece") });
  });
});

describe("guardarEquipo: orden, titulares y suplentes", () => {
  it("el orden del array fija orden y es_suplente", async () => {
    const equipo = await crearEquipo({ jugadores: [{}, {}, {}, {}] });

    await guardarEquipo(
      env,
      equipo.id,
      registro(
        equipo.nombre,
        equipo.jugadores.map((j) => comoEntrada(j))
      )
    );

    const resultado = await filas(equipo.id);
    expect(resultado.map((j) => j.orden)).toEqual([1, 2, 3, 4]);
    expect(resultado.map((j) => j.es_suplente)).toEqual([0, 0, 1, 1]);
  });

  it("subir un suplente a titular actualiza su es_suplente", async () => {
    const equipo = await crearEquipo({ jugadores: [{}, {}, {}] });
    const [a, b, c] = equipo.jugadores;

    await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [comoEntrada(c!), comoEntrada(a!), comoEntrada(b!)])
    );

    const resultado = await filas(equipo.id);
    expect(resultado.map((j) => j.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(resultado.map((j) => j.es_suplente)).toEqual([0, 0, 1]);
  });
});

describe("guardarEquipo: conflictos de unicidad", () => {
  it("devuelve 409 con los campos si el nombre de equipo ya existe", async () => {
    const equipo = await crearEquipo({ nombre: "Los Delfines" });
    await crearEquipo({ nombre: "Las Gaviotas" });

    const respuesta = await guardarEquipo(
      env,
      equipo.id,
      registro("Las Gaviotas", [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[1]!)])
    );

    expect(respuesta?.status).toBe(409);
    const cuerpo = (await respuesta!.json()) as { campos: Record<string, string> };
    expect(cuerpo.campos.equipo).toBeTruthy();
  });

  it("devuelve 409 si un jugador ya está registrado en otro equipo", async () => {
    const equipo = await crearEquipo();
    const otro = await crearEquipo({ jugadores: [{ telefono: "655444333" }, {}] });

    const respuesta = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!, { telefono: "655444333" }),
        comoEntrada(equipo.jugadores[1]!)
      ])
    );

    expect(respuesta?.status).toBe(409);
    expect(otro.jugadores[0]!.telefono).toBe("655444333");
  });

  /*
   * El rollback de R2. Para llegar hasta él hace falta un conflicto que la
   * comprobación previa NO vea: buscarDuplicadosEdicion mira solo *otros*
   * equipos (`equipo_id <> ?`), así que un móvil repetido dentro de la propia
   * plantilla la esquiva y solo lo caza el índice UNIQUE, ya con las fotos
   * subidas. Con un choque contra otro equipo el 409 salta antes de subir nada
   * y este test pasaría sin ejercitar nada.
   */
  it("si el lote falla en D1, se revierten las fotos ya subidas", async () => {
    const equipo = await crearEquipo({ jugadores: [{ telefono: "655444333" }, {}] });
    expect((await env.FOTOS.list()).objects).toHaveLength(0);

    const respuesta = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [
        comoEntrada(equipo.jugadores[0]!),
        comoEntrada(equipo.jugadores[1]!),
        // Mismo móvil que su compañero: invisible para el pre-check.
        { nombre: "Nuevo", apellidos: "Fichaje", telefono: "655444333", email: "nuevo@example.com" }
      ]),
      new Map([[2, fotoNueva()]])
    );

    expect(respuesta?.status).toBe(409);
    expect((await respuesta!.json() as { campos: Record<string, string> }).campos.jugadores).toContain("móviles");
    expect((await env.FOTOS.list()).objects, "la foto subida debería haberse borrado").toHaveLength(0);
  });

  it("un lote fallido no deja la plantilla a medias", async () => {
    const equipo = await crearEquipo({ jugadores: [{ telefono: "655444333" }, {}] });

    await guardarEquipo(
      env,
      equipo.id,
      registro("Nombre Nuevo", [
        comoEntrada(equipo.jugadores[0]!),
        comoEntrada(equipo.jugadores[1]!),
        { nombre: "Nuevo", apellidos: "Fichaje", telefono: "655444333", email: "nuevo@example.com" }
      ])
    );

    // Ni se insertó el jugador nuevo ni se renombró el equipo.
    expect(await filas(equipo.id)).toHaveLength(2);
    const fila = await env.DB.prepare("SELECT nombre FROM equipos WHERE id = ?1").bind(equipo.id).first<{ nombre: string }>();
    expect(fila?.nombre).toBe(equipo.nombre);
  });
});

describe("guardarEquipo: capitán", () => {
  // `capitan` es obligatorio en RegistroValidado desde la Tarea 2, y guardarEquipo
  // lo aplica siempre por índice: quien llama tiene que mandar el índice de
  // quien sigue mandando, o el mando saltaría al jugador de `orden 1`.
  it("fija el capitán según el índice enviado, aunque no sea el de orden 1", async () => {
    const equipo = await crearEquipo({ jugadores: [{}, {}], capitan: 1 });
    expect(equipo.capitanId).toBe(equipo.jugadores[1]!.id);

    const error = await guardarEquipo(
      env,
      equipo.id,
      registro(equipo.nombre, [comoEntrada(equipo.jugadores[0]!), comoEntrada(equipo.jugadores[1]!)], 1)
    );

    expect(error).toBeNull();
    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();
    expect(fila?.capitan_jugador_id).toBe(equipo.capitanId);
  });
});
