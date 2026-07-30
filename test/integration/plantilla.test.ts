import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/api/plantilla";
import { ctx } from "../helpers/ctx";
import { crearAtributos, crearEquipo, crearPartido, fijarNivel, ocultarJugador, peticion } from "../helpers/db";

/*
 * /api/plantilla es el compañero pesado de /api/directo: los nombres, dorsales y
 * metales que el versus necesita para pintar caras. Va aparte y con caché de
 * verdad porque no cambia durante el partido; si viajara en el sondeo serían los
 * mismos nombres repetidos cien veces por minuto en el único endpoint que no
 * puede permitírselo.
 *
 * Lo que más importa aquí es `oculto_publico`: quien ha pedido no salir en el
 * álbum sigue estando en pista, así que sale — pero sin nombre y sin foto.
 */

interface Plantilla {
  partido: { id: string; ronda: string; pista: string | null };
  equipos: {
    A: {
      id: number | null;
      nombre: string;
      jugadores: {
        id: number;
        nombre: string | null;
        apellidos: string | null;
        dorsal: number | null;
        nivel: string;
        media: number | null;
        tieneFoto: boolean;
        esSuplente: boolean;
        oculto: boolean;
      }[];
    };
    B: { nombre: string; jugadores: { id: number }[] };
  };
  error?: string;
}

const pedir = async (partidoId: string) =>
  onRequestGet(ctx(await peticion(`/api/plantilla?partido=${encodeURIComponent(partidoId)}`), env));

const leer = async (partidoId: string): Promise<Plantilla> => (await pedir(partidoId)).json();

describe("la plantilla de un partido", () => {
  it("es pública y se cachea, al revés que el directo", async () => {
    const local = await crearEquipo({ nombre: "Delfines" });
    const id = await crearPartido({ equipoA: local, ronda: "Final", status: "live" });

    const respuesta = await pedir(id);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Cache-Control")).toContain("max-age=300");
    expect(respuesta.headers.get("Cache-Control")).toContain("stale-while-revalidate");
  });

  it("trae los dos equipos, titulares antes que suplentes", async () => {
    const local = await crearEquipo({
      nombre: "Delfines",
      jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }, { nombre: "Celia" }]
    });
    const visitante = await crearEquipo({ nombre: "Gaviotas", jugadores: [{ nombre: "Carla" }] });
    const id = await crearPartido({ equipoA: local, equipoB: visitante, status: "live" });

    const plantilla = await leer(id);
    expect(plantilla.equipos.A.nombre).toBe("Delfines");
    expect(plantilla.equipos.B.nombre).toBe("Gaviotas");
    expect(plantilla.equipos.A.jugadores.map((j) => j.nombre)).toEqual(["Ana", "Berta", "Celia"]);
    expect(plantilla.equipos.A.jugadores.map((j) => j.esSuplente)).toEqual([false, false, true]);
  });

  /*
   * La nota no se guarda en ninguna parte: se calcula con `mediaAtributos` sobre
   * los apartados puntuados, igual que en el álbum. Aquí se comprueba que sale de
   * ahí y no de una segunda copia que un día diría otra cosa.
   */
  it("el metal y la nota son los mismos que enseña el álbum", async () => {
    const local = await crearEquipo({ nombre: "Delfines", jugadores: [{ nombre: "Ana", dorsal: 7 }] });
    const jugador = local.jugadores[0]!;
    await fijarNivel(jugador.id, "oro");
    await crearAtributos(jugador.id, { saque: 80, remate: 60 });
    const id = await crearPartido({ equipoA: local, status: "live" });

    const ficha = (await leer(id)).equipos.A.jugadores[0]!;
    expect(ficha).toMatchObject({ dorsal: 7, nivel: "oro", media: 70 });
  });

  it("sin atributos puntuados no hay nota, y el metal cae a bronce", async () => {
    const local = await crearEquipo({ nombre: "Delfines", jugadores: [{ nombre: "Ana" }] });
    const id = await crearPartido({ equipoA: local, status: "live" });

    expect((await leer(id)).equipos.A.jugadores[0]).toMatchObject({ media: null, nivel: "bronce" });
  });

  /*
   * Quien está oculto **no desaparece**: está en pista y el marcador tiene que
   * cuadrar. Lo que desaparece es quién es.
   */
  it("quien no sale en el álbum sale por su dorsal y sin nombre", async () => {
    const local = await crearEquipo({
      nombre: "Delfines",
      jugadores: [{ nombre: "Ana", dorsal: 7 }, { nombre: "Berta", dorsal: 9 }]
    });
    const escondida = local.jugadores[1]!;
    await fijarNivel(escondida.id, "plata");
    await crearAtributos(escondida.id, { saque: 90 });
    await ocultarJugador(escondida.id);
    const id = await crearPartido({ equipoA: local, status: "live" });

    const fichas = (await leer(id)).equipos.A.jugadores;
    expect(fichas).toHaveLength(2);

    const ficha = fichas.find((j) => j.id === escondida.id)!;
    expect(ficha).toMatchObject({
      nombre: null,
      apellidos: null,
      media: null,
      // `/api/jugadores?foto=N` le responde 404: pedirla sería gastar una
      // petición en un fallo seguro.
      tieneFoto: false,
      oculto: true,
      // El metal se queda: no dice quién es.
      nivel: "plata",
      dorsal: 9
    });
    // Y su nombre no viaja escondido en ningún otro campo.
    expect(JSON.stringify(fichas)).not.toContain("Berta");
  });

  it("un partido sin equipos todavía no se cae", async () => {
    const id = await crearPartido({ ronda: "Final" });
    const plantilla = await leer(id);

    expect(plantilla.equipos.A.jugadores).toEqual([]);
    expect(plantilla.equipos.B.jugadores).toEqual([]);
  });

  it("un partido que no existe da 404", async () => {
    expect((await pedir("no-existe")).status).toBe(404);
  });

  it("sin partido en la URL da 400", async () => {
    expect((await onRequestGet(ctx(await peticion("/api/plantilla"), env))).status).toBe(400);
  });
});
