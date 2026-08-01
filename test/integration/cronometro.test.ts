import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPost } from "../../functions/api/anotacion";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearAdmin, crearEquipo, crearPartido, crearUsuarioConPermisos, peticion } from "../helpers/db";

/*
 * El cronómetro no añade columnas: reinterpreta las dos que ya existen desde la
 * migración 0003.
 *
 *   started_at  inicio del tramo EN CURSO (NULL = parado)
 *   elapsed_ms  acumulado de los tramos ya cerrados
 *
 * Que es exactamente lo que `elapsed()` de public/assets/match-utils.js ya
 * calculaba. Lo que no lo hacía era `sentenciasDerivadas`, que al cerrar el
 * partido tiraba el acumulado.
 */

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

const relojDe = async (partidoId: string) =>
  (await env.DB.prepare("SELECT started_at, elapsed_ms, status FROM partidos WHERE id = ?1").bind(partidoId).first<{
    started_at: string | null;
    elapsed_ms: number;
    status: string;
  }>())!;

const sesion = async () => await cookieSesion(await crearUsuarioConPermisos(["panel.entrar", "partidos.anotar"]));

describe("arrancar y pausar", () => {
  it("arrancar pone el ancla; pausar la recoge en el acumulado", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    expect((await relojDe(partidoId)).started_at).not.toBeNull();

    // Un tramo con duración medible sin dormir el test: se retrasa el ancla.
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 5000).toISOString(), partidoId)
      .run();

    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);
    const parado = await relojDe(partidoId);
    expect(parado.started_at).toBeNull();
    expect(parado.elapsed_ms).toBeGreaterThanOrEqual(5000);
  });

  it("volver a arrancar suma sobre lo acumulado, no lo pisa", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 5000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 3000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);

    expect((await relojDe(partidoId)).elapsed_ms).toBeGreaterThanOrEqual(8000);
  });

  it("pausar dos veces seguidas no resta tiempo", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 4000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);
    const primera = (await relojDe(partidoId)).elapsed_ms;

    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);
    expect((await relojDe(partidoId)).elapsed_ms).toBe(primera);
  });

  it("arrancar dos veces no mueve el ancla: sería regalar tiempo", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "live" });

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    const ancla = (await relojDe(partidoId)).started_at;

    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    expect((await relojDe(partidoId)).started_at).toBe(ancla);
  });

  it("no hay reloj de un partido que no está en directo", async () => {
    const cookie = await sesion();
    const partidoId = await crearPartido({ status: "scheduled" });

    expect((await postear(partidoId, { accion: "cronometro", marcha: true }, cookie)).status).toBe(409);
  });

  /*
   * Mismo cuidado que en registrarEvento/adoptarMarcador (ver
   * anotacion-directo.test.ts): un partido terminado no puede confundirse con
   * uno que aún no se ha publicado. Sin `partidos.editar` un partido `finished`
   * ya se rechaza antes con 403 (ver el guardia de onRequestPost), así que hace
   * falta un admin para llegar hasta el aviso propio de `moverCronometro`.
   */
  it("el cronómetro de un partido terminado dice que terminó, no que le falta ponerse en directo", async () => {
    const cookie = await cookieSesion(await crearAdmin());
    const partidoId = await crearPartido({ status: "finished", winner: "A" });

    const respuesta = await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: string };
    expect(cuerpo.error).toContain("terminado");
    expect(cuerpo.error).not.toContain("Ponlo en directo");
  });
});

describe("la duración final incluye lo acumulado", () => {
  /*
   * El bug: `sentenciasDerivadas` calculaba la duración al cerrar como
   * `ahora − started_at`, tirando `elapsed_ms`. Hoy no se nota porque nada
   * escribe `elapsed_ms` antes del final; en cuanto existe la pausa, todo
   * partido pausado reporta mal su duración. `elapsedOnFinish` de
   * functions/api/partidos.ts ya lo hacía bien: eran dos copias y una mentía.
   */
  it("un partido pausado y reanudado no pierde el tramo anterior al cerrarse", async () => {
    const cookie = await sesion();
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    /*
     * Set corto para cerrar un partido de verdad en pocas peticiones, con el
     * mismo formato de `reglas` (anidado bajo `partido`) y el mismo mínimo de
     * `puntosPorSet` que ya usan anotacion.test.ts y anotacion-directo.test.ts:
     * `normalizarReglas` exige un objeto `{ partido: {...} }` y clamea
     * `puntosPorSet` a un mínimo de 5, así que un valor menor o una forma plana
     * cae entera a las reglas de serie (21 puntos, al mejor de tres) y el
     * partido nunca llega a `finished` con solo un par de puntos.
     */
    const partidoId = await crearPartido({
      equipoA,
      equipoB,
      status: "live",
      reglas: { partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 } }
    });

    await postear(partidoId, { accion: "alineacion", lado: "A", jugadorIds: [equipoA.jugadores[0].id] }, cookie);
    await postear(partidoId, { accion: "alineacion", lado: "B", jugadorIds: [equipoB.jugadores[0].id] }, cookie);

    // Diez segundos ya acumulados y el reloj corriendo desde hace uno.
    await env.DB.prepare("UPDATE partidos SET elapsed_ms = 10000, started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 1000).toISOString(), partidoId)
      .run();

    // Cinco puntos seguidos para A cierran el set único (a 5, con 1 de
    // diferencia) y con él el partido.
    for (let orden = 0; orden < 5; orden += 1) {
      const punto = await postear(
        partidoId,
        { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: orden },
        cookie
      );
      expect(punto.status).toBe(201);
    }

    const fila = await relojDe(partidoId);
    expect(fila.status).toBe("finished");
    expect(fila.elapsed_ms).toBeGreaterThanOrEqual(10000);
  });
});

describe("deshacer el punto que cierra el partido no reactiva un ancla vieja", () => {
  /*
   * El fallo: `sentenciasDerivadas` nunca escribía `started_at`, así que al
   * terminar el partido el ancla se quedaba apuntando a antes del cierre. Si
   * luego se deshacía el punto decisivo, el partido volvía a `live` con ESE
   * ancla todavía puesta, y `elapsed()`/`elapsedOnFinish` —que solo miran
   * `status` y `started_at`, nunca si el partido acaba de terminar— sumaban
   * `ahora − esa ancla vieja` sobre un `elapsed_ms` que YA incluía ese mismo
   * tramo: el partido entero contado dos veces, más las horas que estuvo
   * terminado de más. Si encima el anotador pausaba después, `moverCronometro`
   * grababa ese número inflado en la base de datos para siempre.
   */
  it("al terminar el reloj se para; deshacer el punto decisivo no lo reactiva ni duplica el tiempo", async () => {
    // `partidos.editar` además de `partidos.anotar`: deshacer sobre un partido
    // ya `finished` pasa por el guardia de permisos de onRequestPost (rehacer
    // un resultado cerrado ya no es sólo anotar).
    const cookie = await cookieSesion(
      await crearUsuarioConPermisos(["panel.entrar", "partidos.anotar", "partidos.editar"])
    );
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    const partidoId = await crearPartido({
      equipoA,
      equipoB,
      status: "live",
      reglas: { partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 } }
    });

    await postear(partidoId, { accion: "alineacion", lado: "A", jugadorIds: [equipoA.jugadores[0].id] }, cookie);
    await postear(partidoId, { accion: "alineacion", lado: "B", jugadorIds: [equipoB.jugadores[0].id] }, cookie);

    // El reloj lleva 6 segundos corriendo cuando se anota el punto que cierra el set único.
    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 6000).toISOString(), partidoId)
      .run();

    for (let orden = 0; orden < 5; orden += 1) {
      const punto = await postear(
        partidoId,
        { accion: "evento", tipo: "remate", jugadorId: equipoA.jugadores[0].id, ordenEsperado: orden },
        cookie
      );
      expect(punto.status).toBe(201);
    }

    const trasTerminar = await relojDe(partidoId);
    expect(trasTerminar.status).toBe("finished");
    expect(trasTerminar.started_at).toBeNull(); // el reloj se para al cerrar, no queda un ancla vieja
    expect(trasTerminar.elapsed_ms).toBeGreaterThanOrEqual(6000);
    const duracionFinal = trasTerminar.elapsed_ms;

    // Deshacer el punto que cerró el partido (el quinto, orden 4).
    const deshecho = await postear(partidoId, { accion: "deshacer", ordenEsperado: 4 }, cookie);
    expect(deshecho.status).toBe(200);

    const trasDeshacer = await relojDe(partidoId);
    expect(trasDeshacer.status).toBe("live");
    expect(trasDeshacer.started_at).toBeNull(); // parado, no reactivado con el ancla del cierre
    expect(trasDeshacer.elapsed_ms).toBe(duracionFinal); // el acumulado no se toca al deshacer

    // El anotador reanuda: arranca de nuevo y para tras un tramo corto y medible.
    await postear(partidoId, { accion: "cronometro", marcha: true }, cookie);
    await env.DB.prepare("UPDATE partidos SET started_at = ?1 WHERE id = ?2")
      .bind(new Date(Date.now() - 2000).toISOString(), partidoId)
      .run();
    await postear(partidoId, { accion: "cronometro", marcha: false }, cookie);

    const final = await relojDe(partidoId);
    // El total es lo bancado más SOLO el tramo nuevo: nunca el partido entero otra vez.
    expect(final.elapsed_ms).toBeGreaterThanOrEqual(duracionFinal + 2000);
    expect(final.elapsed_ms).toBeLessThan(duracionFinal + 6000);
  });
});
