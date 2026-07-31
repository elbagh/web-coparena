import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/api/directo";
import { onRequestPatch as patchPartido } from "../../functions/api/partidos";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, peticion } from "../helpers/db";

/*
 * La versión del directo, mirada desde el otro lado: no «¿cambia cuando tiene
 * que cambiar?» sino «¿qué se queda congelado cuando NO cambia?».
 *
 * El ETag es lo que decide si el espectador recibe cuerpo o un 304. Todo lo que
 * viaja en ese cuerpo y no está en la versión es información que el navegador se
 * queda sin actualizar: la del anterior es la que sigue viendo, indefinidamente.
 * Y en ese cuerpo viaja `siguienteSondeoMs`, que es la válvula de la cuota del
 * día del torneo. Una válvula que no llega a quien sondea no es una válvula.
 */

const pedir = async (etag?: string) =>
  await onRequestGet(
    ctx(await peticion("/api/directo", etag ? { headers: { "If-None-Match": etag } } : {}), env)
  );

const versionActual = async (): Promise<string> => (await pedir()).headers.get("ETag")!;

const ajuste = async (clave: string, valor: string) =>
  await env.DB.prepare("UPDATE ajustes SET valor = ?2 WHERE clave = ?1").bind(clave, valor).run();

describe("la válvula de la cuota llega a quien está sondeando", () => {
  /*
   * Sin nadie jugando la versión es siempre la misma («0 partidos, 0 puntos,
   * sin marca de tiempo»), así que TODO espectador que ya la tenga recibe 304
   * para siempre. Subir la cadencia desde el panel en ese momento —que es justo
   * cuando se prepara la jornada— no llegaba a nadie: seguían pidiendo al ritmo
   * con el que cargaron la página.
   */
  it("cambiar la cadencia cambia la versión aunque no haya nadie jugando", async () => {
    const antes = await versionActual();
    await ajuste("directo_sondeo_lento_ms", "120000");
    const despues = await versionActual();

    expect(despues).not.toBe(antes);
  });

  it("y el modo ahorro también: es el freno de emergencia", async () => {
    const antes = await versionActual();
    await ajuste("directo_modo_ahorro", "1");

    expect(await versionActual()).not.toBe(antes);
  });

  /** El caso que de verdad importa: quien ya tiene la versión vieja recibe cuerpo. */
  it("quien tenía la versión anterior deja de recibir 304", async () => {
    const etag = await versionActual();
    expect((await pedir(etag)).status).toBe(304);

    await ajuste("directo_sondeo_ms", "20000");

    const respuesta = await pedir(etag);
    expect(respuesta.status).toBe(200);
    expect(((await respuesta.json()) as { siguienteSondeoMs: number }).siguienteSondeoMs).toBe(60000);
  });
});

describe("el siguiente partido no se queda congelado", () => {
  /*
   * Con la jornada sin empezar, el cuerpo lleva `siguiente` —lo que pinta el
   * botón apagado de la cabecera— y la versión no lo miraba. Mover la hora del
   * primer partido, o cambiarle el rival, no llegaba a ningún navegador que ya
   * hubiera cargado la página.
   */
  /*
   * Por el endpoint de verdad y no con un UPDATE a pelo: la versión se apoya en
   * `updated_at`, que es la convención de la casa para «esta fila ha cambiado»,
   * y quien la escribe es el panel. Un test que la saltara estaría comprobando
   * una ruta que no existe.
   */
  it("cambiar la hora del próximo partido cambia la versión", async () => {
    const admin = await crearAdmin();
    const a = await crearEquipo();
    const b = await crearEquipo();
    const partidoId = await crearPartido({ equipoA: a, equipoB: b, ronda: "Cuartos" });
    const mover = async (cuando: string) =>
      await patchPartido(
        ctx(
          await peticion(`/api/partidos?id=${partidoId}`, {
            method: "PATCH",
            user: admin,
            json: { scheduledAt: cuando }
          }),
          env
        )
      );

    expect((await mover("2026-08-01T10:00:00Z")).status).toBe(200);
    const antes = await versionActual();

    expect((await mover("2026-08-01T12:30:00Z")).status).toBe(200);
    expect(await versionActual()).not.toBe(antes);
  });

  it("y renombrarle la ronda, también", async () => {
    const admin = await crearAdmin();
    const partidoId = await crearPartido({ equipoA: await crearEquipo(), equipoB: await crearEquipo() });
    await env.DB.prepare("UPDATE partidos SET scheduled_at = '2026-08-01T10:00:00Z' WHERE id = ?1")
      .bind(partidoId)
      .run();
    const antes = await versionActual();

    await patchPartido(
      ctx(
        await peticion(`/api/partidos?id=${partidoId}`, {
          method: "PATCH",
          user: admin,
          json: { ronda: "Semifinal" }
        }),
        env
      )
    );

    expect(await versionActual()).not.toBe(antes);
  });

  it("y que aparezca un partido programado antes que el que había, también", async () => {
    const a = await crearEquipo();
    const b = await crearEquipo();
    const tarde = await crearPartido({ equipoA: a, equipoB: b });
    await env.DB.prepare("UPDATE partidos SET scheduled_at = '2026-08-01T18:00:00Z' WHERE id = ?1")
      .bind(tarde)
      .run();
    const antes = await versionActual();

    const pronto = await crearPartido({ equipoA: b, equipoB: a, ronda: "Semifinal" });
    await env.DB.prepare("UPDATE partidos SET scheduled_at = '2026-08-01T09:00:00Z' WHERE id = ?1")
      .bind(pronto)
      .run();

    expect(await versionActual()).not.toBe(antes);
  });
});

/*
 * El ETag acaba en una cabecera HTTP, y ahí solo cabe ASCII imprimible. Un
 * nombre de equipo con tilde metido en la versión —«Ría», «Areeiros do Ñ»— y el
 * navegador tira un `TypeError` al leer la respuesta: no es que se degrade el
 * marcador, es que se cae el directo entero. En este sitio, con equipos de
 * Porto do Son, eso no es un caso raro: es el caso normal.
 */
describe("la versión cabe en una cabecera", () => {
  const soloAscii = (valor: string) => /^[\x20-\x7E]*$/.test(valor);

  it("con equipos acentuados el ETag sigue siendo ASCII", async () => {
    const a = await crearEquipo({ nombre: "Areeiros da Ría" });
    const b = await crearEquipo({ nombre: "Ñoños do Pozo" });
    const partidoId = await crearPartido({ equipoA: a, equipoB: b, status: "live" });
    await env.DB.prepare("UPDATE partidos SET scheduled_at = '2026-08-01T10:00:00Z' WHERE id = ?1")
      .bind(partidoId)
      .run();
    await crearPartido({ equipoA: b, equipoB: a, ronda: "Semifinal · ida" });

    expect(soloAscii(await versionActual())).toBe(true);
  });

  it("y un ajuste con un valor raro tampoco la saca de ASCII", async () => {
    await ajuste("directo_modo_ahorro", "sí");
    expect(soloAscii(await versionActual())).toBe(true);
  });

  /* Escapar y no limpiar: dos versiones distintas no pueden acabar siendo la misma. */
  it("dos valores raros distintos siguen dando versiones distintas", async () => {
    const { etagDe } = await import("../../functions/_lib/directo");
    expect(etagDe("0-0--Ñ-")).not.toBe(etagDe("0-0--Ç-"));
  });
});

describe("lo que la versión ya hacía bien no se rompe", () => {
  it("dos lecturas seguidas sin cambios dan la misma versión", async () => {
    expect(await versionActual()).toBe(await versionActual());
  });

  it("un punto en un partido en juego sigue cambiándola", async () => {
    const a = await crearEquipo();
    const b = await crearEquipo();
    const partidoId = await crearPartido({ equipoA: a, equipoB: b, status: "live" });

    const antes = await versionActual();
    await env.DB.prepare("UPDATE partidos SET points_a = points_a + 1 WHERE id = ?1").bind(partidoId).run();

    expect(await versionActual()).not.toBe(antes);
  });

  /*
   * La versión se calcula con UNA consulta antes de construir el cuerpo: es lo
   * que permite responder 304 sin leer los partidos. Meterle los ajustes y el
   * siguiente partido no puede convertirla en tres viajes a la base.
   */
  it("sigue siendo una sola consulta", async () => {
    const { versionDirecto } = await import("../../functions/_lib/directo");
    const original = env.DB.prepare.bind(env.DB);
    let consultas = 0;
    const espia = new Proxy(env.DB, {
      get: (objetivo, prop, receptor) =>
        prop === "prepare"
          ? (sql: string) => {
              consultas += 1;
              return original(sql);
            }
          : Reflect.get(objetivo, prop, receptor)
    }) as D1Database;

    await versionDirecto(espia);
    expect(consultas).toBe(1);
  });
});

describe("las siglas viajan y mueven la versión", () => {
  /*
   * `equipos.siglas` se edita desde el panel, pero `updated_at` vive en
   * `partidos`: sin meterlas en la versión, corregir unas siglas durante el
   * torneo no le llega a NADIE —todos siguen con su 304 y el cuerpo viejo—.
   * Es el mismo fallo que ya documentan los ajustes y el próximo partido.
   */
  it("editar las siglas de un equipo cambia la versión", async () => {
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    await crearPartido({ equipoA, equipoB, status: "live" });

    const antes = await versionActual();
    await env.DB.prepare("UPDATE equipos SET siglas = 'OST' WHERE id = ?1").bind(equipoA.id).run();

    expect(await versionActual()).not.toBe(antes);
  });

  it("quien tenía la versión anterior recibe cuerpo, no un 304", async () => {
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    await crearPartido({ equipoA, equipoB, status: "live" });

    const etag = await versionActual();
    expect((await pedir(etag)).status).toBe(304);

    await env.DB.prepare("UPDATE equipos SET siglas = 'OST' WHERE id = ?1").bind(equipoA.id).run();
    expect((await pedir(etag)).status).toBe(200);
  });

  /*
   * hex() sin delimitador concatena bytes, no siglas: "ABC"+"D" y "AB"+"CD" dan
   * el mismo hex "41424344" porque el reparto entre equipos se pierde al pegar
   * los dos hex seguidos. Dos estados distintos —de verdad alcanzables, la
   * columna no tiene más límite que 2-4 caracteres— acaban en la misma versión,
   * y quien ya tenía la vieja se queda con un 304 y el chip sin corregir.
   */
  it("dos repartos distintos de las mismas siglas no colisionan en la versión", async () => {
    const equipoA = await crearEquipo();
    const equipoB = await crearEquipo();
    await crearPartido({ equipoA, equipoB, status: "live" });

    await env.DB.prepare("UPDATE equipos SET siglas = 'ABC' WHERE id = ?1").bind(equipoA.id).run();
    await env.DB.prepare("UPDATE equipos SET siglas = 'D' WHERE id = ?1").bind(equipoB.id).run();
    const primera = await versionActual();

    await env.DB.prepare("UPDATE equipos SET siglas = 'AB' WHERE id = ?1").bind(equipoA.id).run();
    await env.DB.prepare("UPDATE equipos SET siglas = 'CD' WHERE id = ?1").bind(equipoB.id).run();

    expect(await versionActual()).not.toBe(primera);
  });

  /*
   * La versión acaba en una cabecera HTTP, y ahí solo cabe ASCII imprimible: una
   * sigla con tilde metida en crudo tira un TypeError al leer la respuesta y deja
   * el directo entero caído. Por eso van en hex().
   *
   * Se comprueba la versión en crudo —sin pasar por `pedir()`— porque el ETag de
   * la respuesta va por `etagDe`, que YA escapa cualquier cosa no ASCII con
   * `encodeURIComponent` como resguardo. Comprobar solo el ETag dejaría pasar
   * este test aunque `hex()` desapareciera del todo: el resguardo lo taparía.
   */
  it("una sigla con tilde no rompe la cabecera: la versión ya es ASCII antes del resguardo de etagDe", async () => {
    const equipoA = await crearEquipo({ nombre: "Ría de Muros" });
    const equipoB = await crearEquipo({ nombre: "Ñoras" });
    await crearPartido({ equipoA, equipoB, status: "live" });
    await env.DB.prepare("UPDATE equipos SET siglas = 'RÍA' WHERE id = ?1").bind(equipoA.id).run();
    await env.DB.prepare("UPDATE equipos SET siglas = 'ÑOR' WHERE id = ?1").bind(equipoB.id).run();

    const { versionDirecto } = await import("../../functions/_lib/directo");
    expect(await versionDirecto(env.DB)).toMatch(/^[\x20-\x7E]*$/);

    const respuesta = await pedir();
    expect(respuesta.headers.get("ETag")).toMatch(/^[\x20-\x7E]*$/);
    expect(respuesta.status).toBe(200);
  });

  it("arrancar el cronómetro también mueve la versión", async () => {
    const partidoId = await crearPartido({ status: "live" });
    const antes = await versionActual();

    await env.DB
      .prepare("UPDATE partidos SET started_at = ?1, log_version = log_version + 1, updated_at = ?1 WHERE id = ?2")
      .bind(new Date().toISOString(), partidoId)
      .run();

    expect(await versionActual()).not.toBe(antes);
  });
});

describe("el cuerpo del directo lleva siglas", () => {
  it("las guardadas mandan sobre las derivadas", async () => {
    const equipoA = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    const equipoB = await crearEquipo({ nombre: "Os Pulpos" });
    await crearPartido({ equipoA, equipoB, status: "live" });
    await env.DB.prepare("UPDATE equipos SET siglas = 'ODP' WHERE id = ?1").bind(equipoA.id).run();

    const cuerpo = (await (await pedir()).json()) as {
      partidos: { teams: { A: { siglas: string }; B: { siglas: string } } }[];
    };

    expect(cuerpo.partidos[0]!.teams.A.siglas).toBe("ODP");
    expect(cuerpo.partidos[0]!.teams.B.siglas).toBe("PUL");
  });

  it("un hueco del cuadro sin equipo también sale con siglas", async () => {
    await crearPartido({ status: "live" });

    const cuerpo = (await (await pedir()).json()) as {
      partidos: { teams: { A: { siglas: string } } }[];
    };

    // El helper pone «Equipo A» de nombre congelado cuando no hay equipo.
    expect(cuerpo.partidos[0]!.teams.A.siglas).toBe("EQU");
  });
});
