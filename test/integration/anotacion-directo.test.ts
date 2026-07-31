import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost, onRequestGet } from "../../functions/api/anotacion";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearEquipo, crearPartido, crearUsuarioConPermisos, peticion } from "../helpers/db";

/*
 * El agujero que esto cierra: `sentenciasDerivadas` escribe `status = 'live'` en
 * cada pliegue, así que el PRIMER punto publicaba el partido —portada, chip de
 * la cabecera y /directo/ para todo el que entrara— sin que nadie lo decidiera y
 * sin forma de volver atrás desde el anotador.
 *
 * Por eso no basta con comprobar que la petición da 409: hay que comprobar que
 * el partido NO se publicó, que es el daño de verdad.
 */

const anotador = () => crearUsuarioConPermisos(["panel.entrar", "partidos.anotar"]);

async function postear(partidoId: string, cuerpo: Record<string, unknown>, cookie: string) {
  return await onRequestPost(
    ctx(
      await peticion(`/api/anotacion?partido=${partidoId}`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo)
      }),
      env
    )
  );
}

const estadoDe = async (partidoId: string) =>
  (await env.DB.prepare("SELECT status, started_at, elapsed_ms FROM partidos WHERE id = ?1").bind(partidoId).first<{
    status: string;
    started_at: string | null;
    elapsed_ms: number;
  }>())!;

/** Un partido programado con dos equipos y su gente ya en pista. */
async function partidoListo() {
  const usuario = await anotador();
  const cookie = await cookieSesion(usuario);
  const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
  const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
  const partidoId = await crearPartido({ equipoA, equipoB, status: "scheduled" });

  await postear(partidoId, { accion: "alineacion", lado: "A", jugadorIds: [equipoA.jugadores[0].id] }, cookie);
  await postear(partidoId, { accion: "alineacion", lado: "B", jugadorIds: [equipoB.jugadores[0].id] }, cookie);

  return { cookie, equipoA, equipoB, partidoId };
}

describe("no se anota sobre un partido que no está en directo", () => {
  it("anotar un punto responde 409 y NO publica el partido", async () => {
    const { cookie, equipoA, partidoId } = await partidoListo();

    const respuesta = await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );

    expect(respuesta.status).toBe(409);
    expect((await estadoDe(partidoId)).status).toBe("scheduled");
    const eventos = await env.DB.prepare("SELECT COUNT(*) AS n FROM partido_eventos WHERE partido_id = ?1")
      .bind(partidoId)
      .first<{ n: number }>();
    expect(eventos!.n).toBe(0);
  });

  /*
   * La otra puerta al mismo agujero: adoptar escribe por el pliegue, así que un
   * partido `scheduled` con puntos puestos a mano desde el panel se publicaría
   * igual sin que nadie lo decidiera.
   */
  it("adoptar un marcador de a mano también responde 409 y no publica", async () => {
    const usuario = await anotador();
    const cookie = await cookieSesion(usuario);
    const partidoId = await crearPartido({ status: "scheduled", puntosA: 8, puntosB: 6 });

    const respuesta = await postear(partidoId, { accion: "adoptar" }, cookie);

    expect(respuesta.status).toBe(409);
    expect((await estadoDe(partidoId)).status).toBe("scheduled");
  });

  it("fijar la alineación SÍ se puede antes del pitido: es preparación", async () => {
    const { partidoId } = await partidoListo();
    const filas = await env.DB.prepare("SELECT COUNT(*) AS n FROM partido_alineacion WHERE partido_id = ?1")
      .bind(partidoId)
      .first<{ n: number }>();

    expect(filas!.n).toBe(2);
    expect((await estadoDe(partidoId)).status).toBe("scheduled");
  });
});

describe("poner en directo", () => {
  it("publica el partido y deja anotar, con solo partidos.anotar", async () => {
    const { cookie, equipoA, partidoId } = await partidoListo();

    const abrir = await postear(partidoId, { accion: "directo" }, cookie);
    expect(abrir.status).toBe(200);
    expect((await estadoDe(partidoId)).status).toBe("live");

    const punto = await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );
    expect(punto.status).toBe(201);
  });

  /* Los dos gestos están separados: publicar no arranca el reloj. */
  it("no toca el cronómetro", async () => {
    const { cookie, partidoId } = await partidoListo();
    await postear(partidoId, { accion: "directo" }, cookie);

    const fila = await estadoDe(partidoId);
    expect(fila.started_at).toBeNull();
    expect(fila.elapsed_ms).toBe(0);
  });

  it("un partido ya en directo responde 409", async () => {
    const { cookie, partidoId } = await partidoListo();
    await postear(partidoId, { accion: "directo" }, cookie);

    expect((await postear(partidoId, { accion: "directo" }, cookie)).status).toBe(409);
  });

  it("un partido terminado no se reabre por aquí", async () => {
    const usuario = await anotador();
    const cookie = await cookieSesion(usuario);
    const partidoId = await crearPartido({ status: "finished", winner: "A" });

    // Sin `partidos.editar`, un partido terminado ya se rechaza antes.
    expect((await postear(partidoId, { accion: "directo" }, cookie)).status).toBe(403);
  });
});

describe("las reparaciones no se bloquean", () => {
  /*
   * Deshacer y corregir actúan sobre un log que solo pudo existir estando en
   * directo. Bloquearlas dejaría atrapado justo a quien tiene que arreglar algo.
   */
  it("deshacer sigue funcionando después de sacar el partido del directo", async () => {
    const { cookie, equipoA, partidoId } = await partidoListo();
    await postear(partidoId, { accion: "directo" }, cookie);
    await postear(
      partidoId,
      { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: 0 },
      cookie
    );

    await env.DB.prepare("UPDATE partidos SET status = 'scheduled' WHERE id = ?1").bind(partidoId).run();

    const respuesta = await postear(partidoId, { accion: "deshacer", ordenEsperado: 0 }, cookie);
    expect(respuesta.status).toBe(200);
  });
});
