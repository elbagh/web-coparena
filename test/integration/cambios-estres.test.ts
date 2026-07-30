import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { onRequestGet, onRequestPost } from "../../functions/api/anotacion";
import { onRequestGet as getDirecto } from "../../functions/api/directo";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, peticion, type EquipoSembrado } from "../helpers/db";

/*
 * Los cambios de jugador, atacados igual que el resto del anotador.
 *
 * Un cambio no es un punto: vive en su propia tabla, no pliega y no genera
 * estadísticas. Lo único que comparte con el log es el sitio en el historial,
 * y ese anclaje —`tras_orden`, que apunta a un evento que se puede deshacer—
 * es justo por donde se rompe.
 */

interface Respuesta {
  estado: { setNumero: number; puntos: { A: number; B: number }; historial: { a: number; b: number }[] };
  eventos: { orden: number; tipo: string }[];
  siguienteOrden: number;
  alineacion: { jugador_id: number; lado: string; orden: number }[];
  error?: string;
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> =>
  (await (
    await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env))
  ).json()) as Respuesta;

/**
 * Sets cortos: un partido entero cabe en unas pocas peticiones. Cinco puntos es
 * el mínimo que admite `normalizarReglas`; por debajo se recorta a los 21 de
 * serie y los sets no cierran nunca (con `puntosPorSet: 3` este fichero medía
 * otra cosa y no lo decía).
 */
const RAPIDAS = { partido: { sets: 3, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 } };

async function montar(user: UsuarioSesion) {
  // Cuatro por equipo: los dos últimos nacen suplentes (es_suplente = 1).
  const local: EquipoSembrado = await crearEquipo({
    jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }, { nombre: "Sara" }, { nombre: "Tere" }]
  });
  const visitante: EquipoSembrado = await crearEquipo({
    jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }, { nombre: "Uxia" }, { nombre: "Vera" }]
  });
  const partidoId = await crearPartido({
    equipoA: local,
    equipoB: visitante,
    status: "live",
    reglas: RAPIDAS
  });

  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "A",
    jugadorIds: local.jugadores.slice(0, 2).map((j) => j.id)
  });
  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "B",
    jugadorIds: visitante.jugadores.slice(0, 2).map((j) => j.id)
  });

  return { partidoId, local, visitante };
}

async function punto(user: UsuarioSesion, partidoId: string, jugadorId: number, tipo = "remate") {
  const { siguienteOrden } = await leer(user, partidoId);
  return anotar(user, partidoId, { accion: "evento", tipo, jugadorId, ordenEsperado: siguienteOrden });
}

const cambiosDe = async (partidoId: string) =>
  (
    await env.DB
      .prepare(
        "SELECT id, tras_orden, set_numero, entra_jugador_id, sale_jugador_id FROM partido_cambios WHERE partido_id = ?1 ORDER BY id"
      )
      .bind(partidoId)
      .all<{ id: number; tras_orden: number; set_numero: number; entra_jugador_id: number; sale_jugador_id: number }>()
  ).results;

describe("un cambio no pierde su set porque se deshaga un punto", () => {
  /*
   * `tras_orden` apunta al último evento anterior al cambio, y a propósito NO es
   * clave ajena: ese punto se puede deshacer y el cambio siguió ocurriendo. Pero
   * el recálculo del `set_numero` buscaba ese orden exacto en el mapa de sets y,
   * al no encontrarlo, caía a 1. Resultado: deshaces el último punto —la
   * corrección más común que hay— y un cambio hecho en el tercer set aparece en
   * el historial público como del primero.
   */
  it("deshacer el punto al que está anclado no lo manda al set 1", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    // Diez puntos cierran dos sets; el undécimo ya es del tercero.
    for (let i = 0; i < 11; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);
    expect((await leer(admin, partidoId)).estado.setNumero).toBe(3);

    expect(
      (
        await anotar(admin, partidoId, {
          accion: "cambio",
          entra: local.jugadores[2]!.id,
          sale: local.jugadores[1]!.id
        })
      ).status
    ).toBe(201);
    expect((await cambiosDe(partidoId))[0]!.set_numero).toBe(3);

    const { eventos } = await leer(admin, partidoId);
    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: eventos[eventos.length - 1]!.orden });

    expect((await cambiosDe(partidoId))[0]!.set_numero).toBe(3);
  });

  /*
   * La secuencia que junta las dos cosas: se deshace el punto al que el cambio
   * está anclado —y `tras_orden` queda apuntando a un orden que ya no existe, que
   * el esquema contempla a propósito— y DESPUÉS se corrige uno anterior, que es
   * lo único que dispara el recálculo del `set_numero`. Buscar ese orden exacto
   * en el mapa y caer a 1 al no encontrarlo mandaba un cambio del tercer set al
   * primero, en el historial que ve el público.
   */
  it("aunque su ancla ya no exista cuando algo dispara el recálculo", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    for (let i = 0; i < 11; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);
    await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });

    // El ancla desaparece...
    const { eventos } = await leer(admin, partidoId);
    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: eventos[eventos.length - 1]!.orden });
    // ...y ahora una corrección cualquiera recalcula los sets de todo.
    await anotar(admin, partidoId, { accion: "corregir", orden: 0, tipo: "ace" });

    expect((await cambiosDe(partidoId))[0]!.set_numero).toBe(3);
  });

  /* Un cambio antes del primer punto sí es del set 1, y ahí `tras_orden` es -1. */
  it("uno hecho antes de empezar se queda en el set 1", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });

    const [cambio] = await cambiosDe(partidoId);
    expect(cambio!.tras_orden).toBe(-1);
    expect(cambio!.set_numero).toBe(1);
  });

  /*
   * Y corregir un punto antiguo sí puede mover a un cambio de set, porque mueve
   * la frontera: eso es correcto y tiene que seguir pasando.
   */
  it("pero corregir sí lo recoloca cuando de verdad cambia de set", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montar(admin);

    // 5–0: cierra el primer set. El cambio cae ya en el segundo.
    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);
    await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });
    expect((await cambiosDe(partidoId))[0]!.set_numero).toBe(2);

    // El quinto punto era en realidad una defensa: no puntuaba, así que el set
    // nunca se cerró y el cambio pasa a ser del primero.
    await anotar(admin, partidoId, { accion: "corregir", orden: 4, tipo: "defensa" });

    expect((await leer(admin, partidoId)).estado.setNumero).toBe(1);
    expect((await cambiosDe(partidoId))[0]!.set_numero).toBe(1);
  });
});

describe("el cambio no descuadra lo que ya estaba cuadrado", () => {
  /** Puntos y errores de las fichas contra los puntos que marca el marcador. */
  async function cuadra(user: UsuarioSesion, partidoId: string) {
    const { estado } = await leer(user, partidoId);
    const jugados =
      estado.historial.reduce((s, set) => s + set.a + set.b, 0) + estado.puntos.A + estado.puntos.B;
    const fila = await env.DB
      .prepare(
        "SELECT COALESCE(SUM(puntos), 0) AS p, COALESCE(SUM(errores), 0) AS e FROM estadisticas WHERE partido_id = ?1"
      )
      .bind(partidoId)
      .first<{ p: number; e: number }>();
    return { fichas: (fila?.p ?? 0) + (fila?.e ?? 0), jugados };
  }

  it("quien entra suma a su ficha y el marcador sigue cuadrando", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    await punto(admin, partidoId, local.jugadores[0]!.id);
    await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });
    await punto(admin, partidoId, local.jugadores[2]!.id);

    const ficha = await env.DB
      .prepare("SELECT puntos FROM estadisticas WHERE jugador_id = ?1 AND partido_id = ?2")
      .bind(local.jugadores[2]!.id, partidoId)
      .first<{ puntos: number }>();
    expect(ficha!.puntos).toBe(1);

    const { fichas, jugados } = await cuadra(admin, partidoId);
    expect(fichas).toBe(jugados);
  });

  /*
   * Deshacer un cambio devuelve a quien salió, pero los puntos que metió quien
   * entró siguen siendo suyos: ocurrieron.
   */
  it("deshacer el cambio no borra lo que anotó quien entró", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });
    await punto(admin, partidoId, local.jugadores[2]!.id);
    await anotar(admin, partidoId, { accion: "cambio-deshacer" });

    const ficha = await env.DB
      .prepare("SELECT puntos FROM estadisticas WHERE jugador_id = ?1 AND partido_id = ?2")
      .bind(local.jugadores[2]!.id, partidoId)
      .first<{ puntos: number }>();
    expect(ficha!.puntos).toBe(1);

    const { fichas, jugados } = await cuadra(admin, partidoId);
    expect(fichas).toBe(jugados);
  });
});

describe("cambios hostiles", () => {
  it("no se cuela alguien del otro equipo", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montar(admin);

    const respuesta = await anotar(admin, partidoId, {
      accion: "cambio",
      entra: visitante.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });

    expect(respuesta.status).toBe(400);
    expect((await leer(admin, partidoId)).alineacion.map((f) => f.jugador_id)).not.toContain(
      visitante.jugadores[2]!.id
    );
  });

  it("un doble toque no mete al mismo suplente dos veces", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);
    const cuerpo = { accion: "cambio", entra: local.jugadores[2]!.id, sale: local.jugadores[1]!.id };

    const respuestas = await Promise.all([
      anotar(admin, partidoId, cuerpo),
      anotar(admin, partidoId, cuerpo),
      anotar(admin, partidoId, cuerpo)
    ]);

    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await cambiosDe(partidoId)).toHaveLength(1);

    // Y la pista sigue teniendo dos personas, no tres ni una.
    const enPista = (await leer(admin, partidoId)).alineacion.filter((f) => f.lado === "A");
    expect(enPista).toHaveLength(2);
  });

  it("nadie se sustituye a sí mismo", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    const respuesta = await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[0]!.id,
      sale: local.jugadores[0]!.id
    });

    expect(respuesta.status).toBe(409);
    expect(await cambiosDe(partidoId)).toHaveLength(0);
  });

  it("deshacer sin nada que deshacer lo dice, no revienta", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montar(admin);

    const respuesta = await anotar(admin, partidoId, { accion: "cambio-deshacer" });
    expect(respuesta.status).toBe(409);
    expect(((await respuesta.json()) as { error: string }).error).toContain("cambio");
  });
});

/*
 * El presupuesto de peticiones del directo es una decisión de diseño, y el
 * tamaño del cuerpo es la otra mitad: lo pide todo el mundo a la vez. Desde que
 * lleva el historial, conviene tener escrito cuánto ocupa lo peor que puede
 * pasar — un partido largo con muchos cambios — para que crezca a propósito y no
 * por descuido.
 */
describe("el cuerpo del directo sigue siendo pequeño", () => {
  it("con un partido largo y sus cambios no se dispara", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montar(admin);
    const gente = [...local.jugadores.slice(0, 2), ...visitante.jugadores.slice(0, 2)].map((j) => j.id);

    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, gente[i % gente.length]!, "defensa");
    await anotar(admin, partidoId, {
      accion: "cambio",
      entra: local.jugadores[2]!.id,
      sale: local.jugadores[1]!.id
    });
    for (let i = 0; i < 40; i += 1) await punto(admin, partidoId, gente[i % gente.length]!, "defensa");

    const respuesta = await getDirecto(ctx(await peticion("/api/directo"), env));
    const bytes = new TextEncoder().encode(await respuesta.text()).length;

    // Con ~100 espectadores sondeando, cada KB de más son ~100 KB por ronda.
    expect(bytes).toBeLessThan(8000);
  });
});
