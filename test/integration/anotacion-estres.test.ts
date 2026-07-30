import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { onRequestGet, onRequestPost } from "../../functions/api/anotacion";
import { onRequestPatch as patchPartido } from "../../functions/api/partidos";
import { ctx } from "../helpers/ctx";
import {
  crearAdmin,
  crearEquipo,
  crearPartido,
  enlazarPartidos,
  peticion,
  type EquipoSembrado
} from "../helpers/db";

/*
 * Intentar romper el anotador a propósito.
 *
 * `anotacion.test.ts` comprueba que la anotación hace lo que tiene que hacer.
 * Este fichero es el contrario: busca las formas de dejar el sistema en un
 * estado que no debería poder existir —estadísticas que no cuadran con el
 * marcador, un marcador que desaparece, un cuadro que sube a alguien que ya no
 * ha ganado— y las deja escritas para que no vuelvan.
 *
 * Todo lo de aquí es alcanzable desde la pantalla o desde la URL: nada exige
 * tocar la base a mano.
 */

interface Respuesta {
  partido: { origenMarcador: string; status: string };
  estado: {
    puntos: { A: number; B: number };
    sets: { A: number; B: number };
    setNumero: number;
    historial: { a: number; b: number }[];
    terminado: boolean;
    winner: string | null;
  };
  eventos: { orden: number; tipo: string; jugadorId: number | null; ladoPunto: string | null }[];
  siguienteOrden: number;
  alineacion: { jugador_id: number; lado: string }[];
  marcadorPanel: { puntos: { A: number; B: number }; sets: { A: number; B: number } };
  pendienteDeAdoptar: boolean;
  error?: string;
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> => {
  const respuesta = await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env));
  return (await respuesta.json()) as Respuesta;
};

/** Un set corto para que un partido entero quepa en unas pocas peticiones. */
const RAPIDAS = { partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 } };

async function montar(
  user: UsuarioSesion,
  opciones: {
    reglas?: unknown;
    puntosA?: number;
    puntosB?: number;
    setsA?: number;
    setsB?: number;
    alinear?: boolean;
  } = {}
) {
  const { alinear = true, reglas, ...marcador } = opciones;
  const local: EquipoSembrado = await crearEquipo({ jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }] });
  const visitante: EquipoSembrado = await crearEquipo({ jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }] });

  const partidoId = await crearPartido({
    equipoA: local,
    equipoB: visitante,
    status: "live",
    ...marcador,
    ...(reglas === undefined ? {} : { reglas })
  });

  if (alinear) {
    await anotar(user, partidoId, { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) });
    await anotar(user, partidoId, {
      accion: "alineacion",
      lado: "B",
      jugadorIds: visitante.jugadores.map((j) => j.id)
    });
  }

  return { partidoId, local, visitante };
}

/** Anota leyendo antes el orden esperado, como hace la pantalla. */
async function punto(user: UsuarioSesion, partidoId: string, jugadorId: number, tipo = "remate"): Promise<Response> {
  const { siguienteOrden } = await leer(user, partidoId);
  return anotar(user, partidoId, { accion: "evento", tipo, jugadorId, ordenEsperado: siguienteOrden });
}

const filaPartido = async (id: string) =>
  await env.DB
    .prepare("SELECT status, winner, origen_marcador, points_a, points_b, sets_a, sets_b FROM partidos WHERE id = ?1")
    .bind(id)
    .first<Record<string, unknown>>();

/**
 * La invariante fuerte del sistema, la que ata las estadísticas al marcador:
 * cada punto jugado tiene exactamente una acción detrás, así que la suma de los
 * puntos anotados a los jugadores más los errores cometidos (que dan punto al
 * rival) tiene que ser igual a los puntos que marca el marcador.
 */
async function cuadraElMarcador(user: UsuarioSesion, partidoId: string): Promise<{ fichas: number; jugados: number }> {
  const { estado } = await leer(user, partidoId);
  const jugados =
    estado.historial.reduce((suma, set) => suma + set.a + set.b, 0) + estado.puntos.A + estado.puntos.B;

  const fila = await env.DB
    .prepare("SELECT COALESCE(SUM(puntos), 0) AS puntos, COALESCE(SUM(errores), 0) AS errores FROM estadisticas WHERE partido_id = ?1")
    .bind(partidoId)
    .first<{ puntos: number; errores: number }>();

  return { fichas: (fila?.puntos ?? 0) + (fila?.errores ?? 0), jugados };
}

// ---------------------------------------------------------------------------

describe("un partido terminado no admite más puntos", () => {
  /*
   * `plegarEventos` ignora los puntos que llegan con el partido ya terminado
   * —`aplicarPunto` devuelve el estado tal cual—, pero la sentencia agregada de
   * estadísticas cuenta TODAS las filas del log. Seguir pulsando después del
   * último punto engordaba la ficha de un jugador sin mover el marcador: acababa
   * con más puntos anotados que puntos tuvo el partido.
   */
  it("no deja anotar por encima del final, ni siquiera con permiso de edición", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin, { reglas: RAPIDAS });

    for (let i = 0; i < 5; i += 1) {
      expect((await punto(admin, partidoId, local.jugadores[0]!.id)).status).toBe(201);
    }
    expect((await filaPartido(partidoId))!.status).toBe("finished");

    const despues = await punto(admin, partidoId, local.jugadores[0]!.id);
    expect(despues.status).toBe(409);

    const { fichas, jugados } = await cuadraElMarcador(admin, partidoId);
    expect(jugados).toBe(5);
    expect(fichas).toBe(5);
  });

  it("y el marcador y las fichas siguen cuadrando tras una tanda larga", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montar(admin);
    const gente = [...local.jugadores.map((j) => j.id), ...visitante.jugadores.map((j) => j.id)];
    const tipos = ["remate", "ace", "bloqueo", "error", "defensa"];

    for (let i = 0; i < 40; i += 1) {
      await punto(admin, partidoId, gente[i % gente.length]!, tipos[i % tipos.length]!);
    }

    const { fichas, jugados } = await cuadraElMarcador(admin, partidoId);
    expect(fichas).toBe(jugados);
  });
});

describe("el saldo de apertura no se deshace", () => {
  /*
   * Adoptar un 8–6 escribe un `ajuste` en el log. Deshacerlo borraba esa fila y
   * volvía a plegar un log vacío: el partido pasaba a 0–0 y, como `origen_marcador`
   * se queda en 'eventos', `pendienteDeAdoptar` ya era falso — no había forma de
   * volver a adoptarlo. Un toque en «Deshacer» y los ocho puntos no estaban en
   * ninguna parte. El aviso de `corregirEvento` («suelta y vuelve a adoptar») ya
   * decía que ese evento no se toca; deshacer no lo respetaba.
   */
  it("deshacer no puede borrar un marcador adoptado", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montar(admin, { puntosA: 8, puntosB: 6, setsA: 1, setsB: 1 });

    expect((await anotar(admin, partidoId, { accion: "adoptar" })).status).toBe(201);

    const deshecho = await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: 0 });
    expect(deshecho.status).toBe(409);

    const fila = await filaPartido(partidoId);
    expect(fila!.points_a).toBe(8);
    expect(fila!.points_b).toBe(6);
  });

  /*
   * Deshacer el primer punto anotado DESPUÉS de adoptar sí es legítimo: lo que
   * no se puede tocar es el saldo, no lo que vino encima.
   */
  it("pero sí lo anotado encima de él", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin, { puntosA: 8, puntosB: 6, setsA: 1, setsB: 1 });
    await anotar(admin, partidoId, { accion: "adoptar" });
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const deshecho = await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: 1 });
    expect(deshecho.status).toBe(200);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 8, B: 6 });
  });
});

describe("soltar y volver a anotar", () => {
  /*
   * El cerrojo de `MarcadorSinAdoptar` solo miraba `eventos.length === 0`, así
   * que se saltaba entero por el camino de «soltar»: anotador suelta el partido
   * → el panel corrige el marcador a mano → el anotador vuelve a pulsar y el
   * pliegue del log reescribe las columnas planas y se lleva la corrección por
   * delante. Es exactamente la pérdida silenciosa que el cerrojo existe para
   * impedir, entrando por la otra puerta.
   */
  it("no pisa el marcador que el panel dejó tras soltarlo", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    await punto(admin, partidoId, local.jugadores[0]!.id);
    await punto(admin, partidoId, local.jugadores[0]!.id);
    await anotar(admin, partidoId, { accion: "soltar" });

    const corregido = await patchPartido(
      ctx(
        await peticion(`/api/partidos?id=${partidoId}`, {
          method: "PATCH",
          user: admin,
          json: { pointsA: 15, pointsB: 10 }
        }),
        env
      )
    );
    expect(corregido.status).toBe(200);

    const siguiente = await punto(admin, partidoId, local.jugadores[0]!.id);
    expect(siguiente.status).toBe(409);

    const fila = await filaPartido(partidoId);
    expect(fila!.points_a).toBe(15);
    expect(fila!.points_b).toBe(10);
  });
});

describe("el cuadro no se queda con un ganador que ya no lo es", () => {
  /** Semifinal enlazada a una final vacía, para ver subir (y bajar) al ganador. */
  async function conCuadro(user: UsuarioSesion) {
    const { partidoId, local, visitante } = await montar(user, { reglas: RAPIDAS });
    const finalId = await crearPartido({ ronda: "Final", vacio: true });
    await enlazarPartidos(partidoId, { ganador: { id: finalId, slot: "A" } });
    return { partidoId, finalId, local, visitante };
  }

  const finalDe = async (id: string) =>
    await env.DB
      .prepare("SELECT equipo_a_id, equipo_a_nombre, origen_equipo_a FROM partidos WHERE id = ?1")
      .bind(id)
      .first<{ equipo_a_id: number | null; equipo_a_nombre: string; origen_equipo_a: string }>();

  /*
   * Deshacer el punto que cerró el partido lo devuelve a `live` y le quita el
   * ganador, pero la final seguía con el equipo ya colocado: el cuadro anunciaba
   * un finalista salido de un partido que, según la base, no había terminado.
   */
  it("deshacer el punto final devuelve la plaza de la final", async () => {
    const admin = await crearAdmin();
    const { partidoId, finalId, local } = await conCuadro(admin);

    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);
    expect((await finalDe(finalId))!.equipo_a_id).toBe(local.id);

    const { eventos } = await leer(admin, partidoId);
    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: eventos[eventos.length - 1]!.orden });

    expect((await filaPartido(partidoId))!.status).toBe("live");
    expect((await finalDe(finalId))!.equipo_a_id).toBe(null);
  });

  /*
   * Corregir un punto antiguo puede cambiar quién ganó. Si la final ya llevaba
   * al otro equipo, tiene que cambiar con él.
   */
  it("corregir el ganador cambia quién sube", async () => {
    const admin = await crearAdmin();
    const { partidoId, finalId, local, visitante } = await conCuadro(admin);

    for (let i = 0; i < 4; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);
    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, visitante.jugadores[0]!.id);
    expect((await finalDe(finalId))!.equipo_a_id).toBe(visitante.id);

    // El primer punto de A no era de A: era un error suyo, o sea punto de B.
    await anotar(admin, partidoId, { accion: "corregir", orden: 0, tipo: "error" });

    const fila = await filaPartido(partidoId);
    expect(fila!.winner).toBe("B");
    expect((await finalDe(finalId))!.equipo_a_id).toBe(visitante.id);
  });

  /*
   * Adoptar un partido que ya venía ganado a mano lo deja `finished` igual que
   * un punto final, y era el único de los cuatro caminos que no propagaba.
   */
  it("adoptar un partido ya ganado propaga como cualquier otro final", async () => {
    const admin = await crearAdmin();
    const { partidoId, finalId, local } = await conCuadro(admin);
    await env.DB.prepare("UPDATE partidos SET sets_a = 1, points_a = 0, points_b = 0 WHERE id = ?1")
      .bind(partidoId)
      .run();

    expect((await anotar(admin, partidoId, { accion: "adoptar" })).status).toBe(201);

    expect((await filaPartido(partidoId))!.status).toBe("finished");
    expect((await finalDe(finalId))!.equipo_a_id).toBe(local.id);
  });

  /*
   * Lo que no puede hacer la vuelta atrás es tocar un cruce que ya está en
   * juego: allí hay gente jugando, y vaciarle un lado a mitad es peor que
   * dejarlo descuadrado.
   */
  it("no vacía una final que ya ha empezado", async () => {
    const admin = await crearAdmin();
    const { partidoId, finalId, local } = await conCuadro(admin);
    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);

    await env.DB.prepare("UPDATE partidos SET status = 'live' WHERE id = ?1").bind(finalId).run();

    const { eventos } = await leer(admin, partidoId);
    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: eventos[eventos.length - 1]!.orden });

    expect((await finalDe(finalId))!.equipo_a_id).toBe(local.id);
  });
});

describe("dos anotadores pulsando a la vez", () => {
  /*
   * El UNIQUE(partido_id, orden) es todo el control de concurrencia que hay.
   * Una ráfaga simultánea con el mismo orden esperado tiene que dejar
   * exactamente un punto, y las estadísticas tienen que seguir cuadrando: si el
   * batch no fuera transaccional, quedaría el marcador de uno con el log del
   * otro.
   */
  it("ocho peticiones con el mismo orden dejan un solo punto", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    const respuestas = await Promise.all(
      Array.from({ length: 8 }, () =>
        anotar(admin, partidoId, {
          accion: "evento",
          tipo: "remate",
          jugadorId: local.jugadores[0]!.id,
          ordenEsperado: 0
        })
      )
    );

    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
    expect(respuestas.filter((r) => r.status === 409)).toHaveLength(7);

    const { eventos, estado } = await leer(admin, partidoId);
    expect(eventos).toHaveLength(1);
    expect(estado.puntos).toEqual({ A: 1, B: 0 });

    const { fichas, jugados } = await cuadraElMarcador(admin, partidoId);
    expect(fichas).toBe(jugados);
  });

  /*
   * Y una ráfaga en la que cada uno lee su propio orden antes de mandar: es lo
   * que hacen dos móviles anotando el mismo partido sin saberlo. Da igual
   * cuántas pasen; lo que no puede pasar es que el log y las fichas discrepen.
   */
  it("una ráfaga desordenada nunca descuadra el log", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montar(admin);
    const gente = [...local.jugadores.map((j) => j.id), ...visitante.jugadores.map((j) => j.id)];

    for (let ronda = 0; ronda < 4; ronda += 1) {
      await Promise.all(
        gente.map((jugadorId) => punto(admin, partidoId, jugadorId, ronda % 2 === 0 ? "remate" : "error"))
      );
    }

    const { eventos } = await leer(admin, partidoId);
    const ordenes = eventos.map((e) => e.orden);
    expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
    expect(new Set(ordenes).size).toBe(ordenes.length);

    const { fichas, jugados } = await cuadraElMarcador(admin, partidoId);
    expect(fichas).toBe(jugados);
  });
});

describe("entradas hostiles", () => {
  it("un orden esperado absurdo no revienta: da conflicto", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    for (const ordenEsperado of [999999, Number.MAX_SAFE_INTEGER]) {
      const respuesta = await anotar(admin, partidoId, {
        accion: "evento",
        tipo: "remate",
        jugadorId: local.jugadores[0]!.id,
        ordenEsperado
      });
      expect(respuesta.status).toBe(409);
    }

    for (const ordenEsperado of [-1, 1.5, "cero", null, {}]) {
      const respuesta = await anotar(admin, partidoId, {
        accion: "evento",
        tipo: "remate",
        jugadorId: local.jugadores[0]!.id,
        ordenEsperado
      });
      expect(respuesta.status).toBe(400);
    }
  });

  it("el lado del punto lo pone el servidor, se mande lo que se mande", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    await anotar(admin, partidoId, {
      accion: "evento",
      tipo: "remate",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0,
      // Todo esto es ruido: el servidor lo calcula.
      ladoPunto: "B",
      ladoJugador: "B",
      puntos_a: 99
    });

    const { eventos, estado } = await leer(admin, partidoId);
    expect(eventos[0]!.ladoPunto).toBe("A");
    expect(estado.puntos).toEqual({ A: 1, B: 0 });
  });

  it("un tipo inventado no entra ni como evento ni como corrección", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);

    const inventado = await anotar(admin, partidoId, {
      accion: "evento",
      tipo: "manotazo",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });
    expect(inventado.status).toBe(400);

    await punto(admin, partidoId, local.jugadores[0]!.id);
    const corregido = await anotar(admin, partidoId, { accion: "corregir", orden: 0, tipo: "ajuste" });
    expect(corregido.status).toBe(409);
  });

  /*
   * Una alineación con cientos de ids es lo que manda un cliente roto o alguien
   * probando. D1 corta a 100 parámetros por consulta, así que el `IN (...)`
   * construido a pelo devolvía un 500 —error del servidor por una petición mal
   * formada—. Tiene que ser un 400 que diga qué pasa.
   */
  it("una alineación imposible se rechaza con 400, no con un 500", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montar(admin, { alinear: false });

    const respuesta = await anotar(admin, partidoId, {
      accion: "alineacion",
      lado: "A",
      jugadorIds: Array.from({ length: 300 }, (_, i) => i + 1)
    });

    expect(respuesta.status).toBe(400);
    // Y el mensaje es para una persona, no el del motor: el catch-all devolvía
    // «D1_ERROR: variable number must be between ?1 and ?100…» con un 409.
    expect((await respuesta.json()).error).not.toContain("D1_ERROR");
  });

  it("un partido que no existe da 404 en todas las acciones", async () => {
    const admin = await crearAdmin();
    for (const accion of ["evento", "deshacer", "corregir", "adoptar", "soltar", "alineacion"]) {
      const respuesta = await anotar(admin, "no-existe", { accion, ordenEsperado: 0, orden: 0 });
      expect(respuesta.status).toBe(404);
    }
  });

  /*
   * El cuerpo puede llegar sin ser JSON (un proxy, un cliente roto). No puede
   * salir un 500 por eso.
   */
  it("un cuerpo que no es JSON no tumba el endpoint", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montar(admin);
    const respuesta = await onRequestPost(
      ctx(
        await peticion(`/api/anotacion?partido=${partidoId}`, {
          method: "POST",
          user: admin,
          body: "esto no es json",
          headers: { "Content-Type": "application/json" }
        }),
        env
      )
    );
    expect(respuesta.status).toBe(400);
  });
});

/*
 * Lo que cuesta anotar un punto no puede depender de cuántos van anotados.
 *
 * Se mide en consultas y no en milisegundos: el reloj depende de la máquina y
 * de quién más esté compilando, y un test que a veces pasa no defiende nada.
 * Las dos cosas que se fueron de las manos aquí crecían las dos con el log:
 * `leerEstado` leía el log dos veces (una para los eventos y otra para los
 * nombres) y se llamaba dos veces por escritura (la escritura lo calculaba, se
 * tiraba, y la respuesta lo recalculaba). Con un partido largo eso es leer
 * cuatro veces el log entero para mover un número.
 */
describe("anotar el punto 200 cuesta lo mismo que anotar el segundo", () => {
  /** Cuenta las consultas que se preparan durante una llamada. */
  async function consultasDe(fn: (env: typeof globalThis extends never ? never : Env) => Promise<unknown>) {
    let consultas = 0;
    const preparar = env.DB.prepare.bind(env.DB);
    const espia = new Proxy(env.DB, {
      get: (objetivo, prop, receptor) =>
        prop === "prepare"
          ? (sql: string) => {
              consultas += 1;
              return preparar(sql);
            }
          : Reflect.get(objetivo, prop, receptor)
    }) as D1Database;

    await fn({ ...env, DB: espia } as Env);
    return consultas;
  }

  type Env = typeof env;

  it("el número de consultas por punto no crece con el log", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin, {
      // Sets larguísimos: el partido no se acaba y el log crece sin límite.
      reglas: { partido: { sets: 3, puntosPorSet: 99, puntosSetDecisivo: 99, diferencia: 2 } }
    });

    const anotarEn = async (orden: number, entorno: Env) =>
      await onRequestPost(
        ctx(
          await peticion(`/api/anotacion?partido=${partidoId}`, {
            method: "POST",
            user: admin,
            json: { accion: "evento", tipo: "defensa", jugadorId: local.jugadores[0]!.id, ordenEsperado: orden }
          }),
          entorno
        )
      );

    const pronto = await consultasDe((entorno) => anotarEn(0, entorno));
    for (let i = 1; i < 60; i += 1) await anotarEn(i, env);
    const tarde = await consultasDe((entorno) => anotarEn(60, entorno));

    expect(tarde).toBe(pronto);
  });

  it("leer el estado es una sola consulta, no una por cada cosa que pinta", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montar(admin);
    for (let i = 0; i < 3; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);

    const { leerEstado } = await import("../../functions/_lib/eventos");
    const partido = (await env.DB
      .prepare(
        `SELECT id, status, origen_marcador, equipo_a_id, equipo_b_id, points_a, points_b,
                sets_a, sets_b, reglas, started_at, elapsed_ms FROM partidos WHERE id = ?1`
      )
      .bind(partidoId)
      .first())!;

    const consultas = await consultasDe(async (entorno) => await leerEstado(entorno.DB, partido as never));
    expect(consultas).toBe(1);
  });

  /*
   * Y el estado que devuelve la escritura tiene que ser el mismo que el de una
   * lectura limpia: pasarlo a la respuesta en vez de recalcularlo solo vale si
   * son indistinguibles.
   */
  it("el estado que devuelve anotar es idéntico al que devuelve leer", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montar(admin);
    const gente = [...local.jugadores.map((j) => j.id), ...visitante.jugadores.map((j) => j.id)];

    for (let i = 0; i < 12; i += 1) {
      await punto(admin, partidoId, gente[i % gente.length]!, i % 3 === 0 ? "error" : "remate");
    }
    const trasAnotar = (await (await punto(admin, partidoId, gente[0]!)).json()) as Respuesta;
    const leido = await leer(admin, partidoId);

    expect(trasAnotar.estado).toEqual(leido.estado);
    expect(trasAnotar.eventos).toEqual(leido.eventos);
    expect(trasAnotar.siguienteOrden).toBe(leido.siguienteOrden);
  });
});
