import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost as anotacionPost } from "../../functions/api/anotacion";
import { onRequestGet as historialGet } from "../../functions/api/historial";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import {
  crearAdmin,
  crearEquipo,
  crearPartido,
  ocultarJugador,
  peticion,
  type EquipoSembrado
} from "../helpers/db";

/*
 * /api/historial es el compañero de `feedPublico` para la otra mitad del
 * problema: aquél sirve la COLA del log a quien está sondeando el directo, y esto
 * sirve el log entero a quien abre un partido ya jugado.
 *
 * Lo que se fija aquí es lo que sólo se puede decir leyendo el log entero, y por
 * tanto lo que el directo no puede comprobar:
 *
 *   - el marcador que dejó cada línea, en cualquier set y no sólo en el que se
 *     juega, con el parcial completo en el punto que cierra un set;
 *   - el set derivado del pliegue y no leído de `partido_eventos.set_numero`;
 *   - dónde cae un cambio cuyo punto ancla se deshizo.
 *
 * Y lo de siempre en todo lo público: aquí no viaja ni un nombre de jugador. Los
 * pone el cliente desde `/api/plantilla`, que ya proyecta a quien pidió no salir
 * del álbum.
 */

interface Linea {
  o: number;
  c?: number;
  t: string;
  j?: number | null;
  x?: number;
  l?: string | null;
  p?: string | null;
  s: number;
  a: number;
  b: number;
  sa: number;
  sb: number;
  pos?: number;
}

interface Historial {
  partido: {
    id: string;
    ronda: string;
    status: string;
    sets: { A: number; B: number };
    points: { A: number; B: number };
    history: { a: number; b: number }[];
    winner: string | null;
    teams: { A: { name: string }; B: { name: string } };
  };
  lineas: Linea[];
  enPistaFinal: { A: number[]; B: number[] };
  huecos: { A: number[]; B: number[] };
  totales: Record<string, number>[];
  metricas: { clave: string; etiqueta: string }[];
  error?: string;
}

const pedir = async (partidoId: string) =>
  historialGet(ctx(await peticion(`/api/historial?partido=${encodeURIComponent(partidoId)}`), env));

const leer = async (partidoId: string): Promise<Historial> => (await pedir(partidoId)).json();

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  anotacionPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const estadoAnotacion = async (user: UsuarioSesion, partidoId: string) =>
  (await (await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env))).json()) as {
    siguienteOrden: number;
  };

/** Un punto, leyendo antes el orden esperado como hace la propia pantalla. */
async function punto(
  user: UsuarioSesion,
  partidoId: string,
  jugadorId: number,
  tipo = "punto",
  gano?: boolean
): Promise<Response> {
  const { siguienteOrden } = await estadoAnotacion(user, partidoId);
  return anotar(user, partidoId, {
    accion: "evento",
    tipo,
    jugadorId,
    ordenEsperado: siguienteOrden,
    ...(gano === undefined ? {} : { punto: gano })
  });
}

/**
 * Un partido en directo, con los dos equipos alineados y a un set corto.
 *
 * A cinco puntos y no a dos: `normalizarReglas` acota `puntosPorSet` a [5, 99],
 * así que un set más corto se cae al 21 de serie y el partido no cerraría nunca.
 */
const A_UN_SET = { partido: { sets: 1, puntosPorSet: 5, diferencia: 1 } };
const A_DOS_SETS = { partido: { sets: 2, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 } };

async function montarPartido(user: UsuarioSesion, reglas: unknown = A_UN_SET) {
  const local: EquipoSembrado = await crearEquipo({
    nombre: "Delfines",
    jugadores: [{ nombre: "Ana", dorsal: 4 }, { nombre: "Berta", dorsal: 7 }, { nombre: "Celia", dorsal: 9 }]
  });
  const visitante: EquipoSembrado = await crearEquipo({
    nombre: "Gaviotas",
    jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }]
  });

  const partidoId = await crearPartido({ equipoA: local, equipoB: visitante, status: "live", reglas });

  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "A",
    jugadorIds: [local.jugadores[0]!.id, local.jugadores[1]!.id]
  });
  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "B",
    jugadorIds: visitante.jugadores.map((j) => j.id)
  });

  return { partidoId, local, visitante };
}

describe("el historial de un partido", () => {
  it("da el marcador que dejó cada punto, y el parcial entero en el que cierra el set", async () => {
    const user = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(user);

    await punto(user, partidoId, local.jugadores[0]!.id);
    await punto(user, partidoId, visitante.jugadores[0]!.id);
    await punto(user, partidoId, local.jugadores[1]!.id);
    await punto(user, partidoId, local.jugadores[0]!.id);
    await punto(user, partidoId, local.jugadores[0]!.id);
    await punto(user, partidoId, local.jugadores[1]!.id);

    const { lineas, partido } = await leer(partidoId);
    expect(lineas.map((linea) => `${linea.a}–${linea.b}`)).toEqual([
      "1–0",
      "1–1",
      "2–1",
      "3–1",
      "4–1",
      "5–1"
    ]);
    // El punto que cierra trae el parcial completo, no el 0–0 que deja el
    // pliegue al reiniciar los puntos.
    expect(lineas.at(-1)).toMatchObject({ a: 5, b: 1, sa: 1, sb: 0 });
    expect(partido.winner).toBe("A");
  });

  /*
   * El set de cada línea sale del PLIEGUE, no de `partido_eventos.set_numero`.
   * Esa columna existe para quien sólo trae la cola del log y no puede replegar;
   * aquí se lee entero, así que se deriva. Un partido de dos sets es lo que
   * separa las dos lecturas.
   */
  it("reparte las líneas por el set en el que se jugaron", async () => {
    const user = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(user, A_DOS_SETS);

    for (let i = 0; i < 5; i++) await punto(user, partidoId, local.jugadores[0]!.id); // cierra el set 1
    await punto(user, partidoId, visitante.jugadores[0]!.id);

    const { lineas } = await leer(partidoId);
    expect(lineas.map((linea) => linea.s)).toEqual([1, 1, 1, 1, 1, 2]);
    expect(lineas[4]).toMatchObject({ a: 5, b: 0, sa: 1, sb: 0 });
    expect(lineas[5]).toMatchObject({ a: 0, b: 1, sa: 1, sb: 0 });
  });

  /*
   * Un bloqueo que sólo levanta la pelota no puntúa, y el saque fallado da el
   * punto al rival. Las dos cosas viajan en `p` frente a `l`, que es lo único que
   * dice si la acción sumó — y nunca el tipo.
   */
  it("distingue la acción de quién se llevó el punto", async () => {
    const user = await crearAdmin();
    const { partidoId, local } = await montarPartido(user);

    await punto(user, partidoId, local.jugadores[0]!.id, "bloqueo", false);
    await punto(user, partidoId, local.jugadores[0]!.id, "saque_fallado");

    const { lineas } = await leer(partidoId);
    expect(lineas[0]).toMatchObject({ t: "bloqueo", l: "A", p: null, a: 0, b: 0 });
    expect(lineas[1]).toMatchObject({ t: "saque_fallado", l: "A", p: "B", a: 0, b: 1 });
  });

  it("intercala los cambios detrás del punto en el que ocurrieron", async () => {
    const user = await crearAdmin();
    const { partidoId, local } = await montarPartido(user);

    await punto(user, partidoId, local.jugadores[0]!.id);
    await anotar(user, partidoId, {
      accion: "cambio",
      lado: "A",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });
    await punto(user, partidoId, local.jugadores[2]!.id);

    const { lineas, enPistaFinal } = await leer(partidoId);
    expect(lineas.map((linea) => linea.t)).toEqual(["punto", "cambio", "punto"]);
    // El cambio sale con el marcador del punto del que cuelga: no puntúa.
    expect(lineas[1]).toMatchObject({ t: "cambio", a: 1, b: 0, j: local.jugadores[2]!.id, x: local.jugadores[1]!.id });
    expect(enPistaFinal.A).toContain(local.jugadores[2]!.id);
    expect(enPistaFinal.A).not.toContain(local.jugadores[1]!.id);
  });

  /*
   * `tras_orden` no es clave ajena: el punto al que se ancló un cambio se puede
   * deshacer y el cambio siguió ocurriendo. Buscar el orden exacto y caer al
   * principio del partido cuando no aparece es el fallo que ya se pagó una vez en
   * `sentenciasSetNumero`.
   */
  it("un cambio anclado a un punto deshecho no se va al principio del partido", async () => {
    const user = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(user, A_DOS_SETS);

    for (let i = 0; i < 5; i++) await punto(user, partidoId, local.jugadores[0]!.id); // cierra el set 1
    await punto(user, partidoId, visitante.jugadores[0]!.id); // set 2
    await anotar(user, partidoId, {
      accion: "cambio",
      lado: "A",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });
    // Se deshace justo el punto al que el cambio quedó anclado. `deshacer` pide
    // el orden del último evento: sin él es un 400 y no se borra nada.
    const { siguienteOrden } = await estadoAnotacion(user, partidoId);
    const deshecho = await anotar(user, partidoId, {
      accion: "deshacer",
      ordenEsperado: siguienteOrden - 1
    });
    expect(deshecho.status).toBe(200);

    const { lineas } = await leer(partidoId);
    const cambio = lineas.find((linea) => linea.t === "cambio")!;
    // El último evento vivo antes de su ancla es el que cerró el set 1.
    expect(cambio.s).toBe(1);
    expect(cambio).toMatchObject({ a: 5, b: 0, sa: 1, sb: 0 });
  });

  it("los totales por jugador son los de ese partido, con sus etiquetas", async () => {
    const user = await crearAdmin();
    const { partidoId, local } = await montarPartido(user);

    await punto(user, partidoId, local.jugadores[0]!.id, "ace");
    await punto(user, partidoId, local.jugadores[0]!.id, "bloqueo", true);
    await punto(user, partidoId, local.jugadores[1]!.id, "saque_fallado");

    const { totales, metricas } = await leer(partidoId);
    const ana = totales.find((fila) => fila.jugadorId === local.jugadores[0]!.id)!;
    expect(ana).toMatchObject({ puntos: 2, aces: 1, bloqueos: 1 });

    const berta = totales.find((fila) => fila.jugadorId === local.jugadores[1]!.id)!;
    expect(berta).toMatchObject({ puntos: 0, saquesFallados: 1 });

    // «Partidos jugados» no dice nada de un solo partido, así que no viaja.
    expect(metricas.map((metrica) => metrica.clave)).not.toContain("partidosJugados");
    expect(metricas.map((metrica) => metrica.clave)).toContain("errores");
  });

  /*
   * El cerrojo de privacidad. Este endpoint no proyecta a quien está oculto: es
   * que no manda nombres, ni de quien lo está ni de quien no. Se comprueba sobre
   * el JSON entero para que un campo nuevo no cuele uno sin que nadie lo vea.
   */
  it("no devuelve ni un nombre de jugador", async () => {
    const user = await crearAdmin();
    const { partidoId, local } = await montarPartido(user);
    await ocultarJugador(local.jugadores[1]!.id);

    await punto(user, partidoId, local.jugadores[0]!.id);
    await punto(user, partidoId, local.jugadores[1]!.id);

    const cuerpo = JSON.stringify(await leer(partidoId));
    expect(cuerpo).not.toContain("Ana");
    expect(cuerpo).not.toContain("Berta");
    // Los nombres de EQUIPO sí: son los congelados del partido, y públicos.
    expect(cuerpo).toContain("Delfines");
  });

  it("un partido llevado a mano responde 200 con el resultado y sin líneas", async () => {
    const local = await crearEquipo({ nombre: "Delfines" });
    const id = await crearPartido({
      equipoA: local,
      status: "finished",
      setsA: 2,
      setsB: 1,
      winner: "A"
    });

    const historial = await leer(id);
    expect(historial.lineas).toEqual([]);
    expect(historial.totales).toEqual([]);
    expect(historial.partido.sets).toEqual({ A: 2, B: 1 });
  });

  it("un partido terminado se cachea largo; uno en juego, corto", async () => {
    const terminado = await crearPartido({ status: "finished" });
    const jugando = await crearPartido({ status: "live" });

    expect((await pedir(terminado)).headers.get("Cache-Control")).toContain("max-age=300");
    expect((await pedir(jugando)).headers.get("Cache-Control")).toContain("max-age=10");
  });

  it("un partido que no existe da 404", async () => {
    expect((await pedir("no-existe")).status).toBe(404);
  });

  it("sin partido en la URL da 400", async () => {
    expect((await historialGet(ctx(await peticion("/api/historial"), env))).status).toBe(400);
  });
});
