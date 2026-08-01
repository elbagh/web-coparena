import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../../functions/api/anotacion";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, peticion, type EquipoSembrado } from "../helpers/db";

/*
 * El reclamo del partido.
 *
 * El UNIQUE(partido_id, orden) impide que un punto pise a otro, pero sólo salta
 * cuando dos anotadores coinciden en el mismo hueco. Si se turnan sin llegar a
 * chocar, los dos anotan el mismo partido y ninguno se entera. Con una sola
 * pista eso no es raro: quien entra en /anotador/ se encuentra el partido en
 * juego arriba de la lista.
 *
 * El reclamo separa a dos personas; el UNIQUE sigue separando a dos pestañas de
 * la misma persona.
 */

interface Respuesta {
  anotador: { id: number | null; nombre: string | null; puedeAnotar: boolean };
  ultimaActividad: string;
  estado: { puntos: { A: number; B: number } };
  siguienteOrden: number;
  error?: string;
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> => {
  const respuesta = await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env));
  return (await respuesta.json()) as Respuesta;
};

/** Un partido con sus dos equipos y sin una sola escritura detrás: sin dueño. */
async function partidoLibre() {
  const local: EquipoSembrado = await crearEquipo({
    nombre: "Delfines",
    jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }]
  });
  const visitante: EquipoSembrado = await crearEquipo({
    nombre: "Gaviotas",
    jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }]
  });
  const partidoId = await crearPartido({ equipoA: local, equipoB: visitante, status: "live" });
  return { partidoId, local, visitante };
}

describe("quién lleva el partido", () => {
  it("un partido sin escrituras no lo lleva nadie, y cualquiera puede anotarlo", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const datos = await leer(admin, partidoId);

    expect(datos.anotador).toEqual({ id: null, nombre: null, puedeAnotar: true });
    expect(datos.ultimaActividad).toBeTruthy();
  });
});

/** Deja el partido reclamado por `user`, con los dos equipos alineados. */
async function montar(user: UsuarioSesion) {
  const { partidoId, local, visitante } = await partidoLibre();
  await anotar(user, partidoId, { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) });
  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "B",
    jugadorIds: visitante.jugadores.map((j) => j.id)
  });
  return { partidoId, local, visitante };
}

describe("la lista de partidos", () => {
  /*
   * `partidosDeHoy` (GET /api/anotacion sin `?partido=`) tenía la misma nota
   * de «lo lleva…» para todo el mundo, dueño incluido: no recibía el usuario
   * que preguntaba, así que no podía distinguirlo. Ana entraba a `/anotador/`
   * y su propia tarjeta —la del partido que ella misma lleva— le decía «Lo
   * lleva Ana Muros», que es justo el aviso que existe para decir lo
   * contrario.
   */
  it("puedeAnotar distingue al dueño del resto en la misma fila", async () => {
    const ana = await crearAdmin({ nombre: "Ana Muros" });
    const berta = await crearAdmin();
    const { partidoId } = await montar(ana);

    const listaDeAna = (
      (await (
        await onRequestGet(ctx(await peticion("/api/anotacion", { user: ana }), env))
      ).json()) as {
        partidos: { id: string; anotador: { id: number; nombre: string; puedeAnotar: boolean } | null }[];
      }
    ).partidos;
    expect(listaDeAna.find((p) => p.id === partidoId)?.anotador?.puedeAnotar).toBe(true);

    const listaDeBerta = (
      (await (
        await onRequestGet(ctx(await peticion("/api/anotacion", { user: berta }), env))
      ).json()) as {
        partidos: { id: string; anotador: { id: number; nombre: string; puedeAnotar: boolean } | null }[];
      }
    ).partidos;
    expect(listaDeBerta.find((p) => p.id === partidoId)?.anotador).toEqual({
      id: ana.id,
      nombre: "Ana Muros",
      puedeAnotar: false
    });
  });
});

describe("el reclamo", () => {
  it("la primera escritura reclama el partido", async () => {
    const ana = await crearAdmin();
    const { partidoId, local } = await partidoLibre();

    await anotar(ana, partidoId, { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) });

    const datos = await leer(ana, partidoId);
    expect(datos.anotador.id).toBe(ana.id);
    expect(datos.anotador.puedeAnotar).toBe(true);
  });

  it("el GET no reclama nada", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId } = await partidoLibre();

    await leer(ana, partidoId);
    await leer(berta, partidoId);

    expect((await leer(ana, partidoId)).anotador.id).toBeNull();
  });

  it("un segundo anotador recibe 409 y el marcador no se mueve", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);
    await anotar(ana, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });

    const respuesta = await anotar(berta, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[1]!.id,
      ordenEsperado: 1
    });

    expect(respuesta.status).toBe(409);
    expect((await leer(ana, partidoId)).estado.puntos).toEqual({ A: 1, B: 0 });
  });

  it("el 409 dice quién lo lleva", async () => {
    const ana = await crearAdmin({ nombre: "Ana Muros" });
    const berta = await crearAdmin();
    const { partidoId } = await montar(ana);

    const respuesta = await anotar(berta, partidoId, { accion: "alineacion", lado: "A", jugadorIds: [] });
    const cuerpo = (await respuesta.json()) as { error: string; anotador: { id: number; nombre: string } };

    expect(respuesta.status).toBe(409);
    expect(cuerpo.anotador).toEqual({ id: ana.id, nombre: "Ana Muros" });
    expect(cuerpo.error).toContain("Ana Muros");
  });

  it("para quien no lo lleva, puedeAnotar es false", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId } = await montar(ana);

    expect((await leer(berta, partidoId)).anotador.puedeAnotar).toBe(false);
  });

  /*
   * La carrera de verdad: dos peticiones sobre un partido que no lleva nadie.
   * Con un SELECT y un if las dos pasarían. Lo que las separa es que la
   * condición viaja dentro del UPDATE y la evalúa D1.
   */
  it("dos escrituras a la vez sobre un partido libre: sólo una entra", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const respuestas = await Promise.all([
      anotar(ana, partidoId, { accion: "alineacion", lado: "A", jugadorIds: [] }),
      anotar(berta, partidoId, { accion: "alineacion", lado: "A", jugadorIds: [] })
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);

    const dueño = (await leer(ana, partidoId)).anotador.id;
    expect([ana.id, berta.id]).toContain(dueño);
  });

  /*
   * La puerta va antes del switch, así que cubre todas las acciones de
   * escritura. Ponerla en cada función de _lib sería repetirla siete veces y
   * olvidarla en la octava.
   */
  it("la puerta cubre todas las acciones de escritura", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);
    await anotar(ana, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });

    const acciones = [
      { accion: "evento", tipo: "punto", jugadorId: local.jugadores[0]!.id, ordenEsperado: 1 },
      { accion: "deshacer", ordenEsperado: 0 },
      { accion: "corregir", orden: 0, jugadorId: local.jugadores[1]!.id, ordenEsperado: 1 },
      { accion: "alineacion", lado: "A", jugadorIds: [] },
      { accion: "cambio", entra: local.jugadores[1]!.id, sale: local.jugadores[0]!.id },
      { accion: "cambio-deshacer" },
      { accion: "adoptar" },
      { accion: "soltar" }
    ];

    for (const cuerpo of acciones) {
      const respuesta = await anotar(berta, partidoId, cuerpo);
      expect(respuesta.status, `la acción ${cuerpo.accion} no está protegida`).toBe(409);

      /*
       * El estado no basta como prueba. Varias de estas acciones responden 409
       * por su cuenta aunque la puerta no exista: `adoptar` dice «ya tiene
       * anotación», `cambio-deshacer` dice «no hay ningún cambio». Lo que sólo
       * pone la puerta es el campo `anotador`, así que es lo que se comprueba.
       */
      const cuerpoJson = (await respuesta.json()) as { anotador?: { id: number } };
      expect(cuerpoJson.anotador?.id, `la acción ${cuerpo.accion} no pasa por la puerta`).toBe(ana.id);
    }
  });
});

describe("el relevo", () => {
  it("tras el relevo anota el nuevo y el anterior recibe 409", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);

    const relevo = await anotar(berta, partidoId, { accion: "relevo" });
    expect(relevo.status).toBe(200);
    expect(((await relevo.json()) as Respuesta).anotador.id).toBe(berta.id);

    const suyo = await anotar(berta, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[0]!.id,
      ordenEsperado: 0
    });
    expect(suyo.status).toBe(201);

    const delViejo = await anotar(ana, partidoId, {
      accion: "evento",
      tipo: "punto",
      jugadorId: local.jugadores[1]!.id,
      ordenEsperado: 1
    });
    expect(delViejo.status).toBe(409);
  });

  /*
   * Siempre disponible y nunca falla. Si al anterior anotador se le acabó la
   * batería, el siguiente tiene que poder entrar sin llamar a nadie: por eso el
   * reclamo es blando y no un cerrojo.
   */
  it("el relevo de un partido que no lleva nadie también vale", async () => {
    const ana = await crearAdmin();
    const { partidoId } = await partidoLibre();

    const respuesta = await anotar(ana, partidoId, { accion: "relevo" });

    expect(respuesta.status).toBe(200);
    expect((await leer(ana, partidoId)).anotador.id).toBe(ana.id);
  });

  it("soltar libera el partido, y después lo anota otro sin relevo", async () => {
    const ana = await crearAdmin();
    const berta = await crearAdmin();
    const { partidoId, local } = await montar(ana);

    expect((await anotar(ana, partidoId, { accion: "soltar" })).status).toBe(200);
    expect((await leer(berta, partidoId)).anotador.id).toBeNull();

    const respuesta = await anotar(berta, partidoId, {
      accion: "alineacion",
      lado: "A",
      jugadorIds: local.jugadores.map((j) => j.id)
    });
    expect(respuesta.status).toBe(200);
    expect((await leer(berta, partidoId)).anotador.id).toBe(berta.id);
  });
});

/*
 * `soltarAnotacion` pone `anotador_usuario_id` a NULL. Eso abre una ventana
 * estrecha en `asegurarReclamo`: si el CAS de reclamar pierde justo cuando
 * quien lo llevaba lo acaba de soltar, la relectura ve el partido libre y,
 * sin un segundo intento, la petición seguiría adelante sin haberlo
 * reclamado de verdad — el partido quedaría escribiéndose sin dueño en la
 * base.
 *
 * Reproducir esa ventana con dos peticiones reales y una carrera de verdad
 * sería no determinista. En su lugar se fuerza aquí: se intercepta sólo la
 * primera consulta del CAS para que informe de que perdió (0 filas), sin
 * llegar a ejecutarse — así el partido queda libre de verdad en la base,
 * igual que si alguien lo hubiera soltado justo antes de la relectura.
 */
describe("la ventana entre perder el CAS y releer", () => {
  /** Hace que la primera consulta del CAS de reclamo informe de que perdió, sin tocar la base. */
  function conPrimerCasFallido(db: D1Database): D1Database {
    const preparar = db.prepare.bind(db);
    let interceptado = false;
    return new Proxy(db, {
      get: (objetivo, prop, receptor) => {
        if (prop !== "prepare") return Reflect.get(objetivo, prop, receptor);
        return (sql: string) => {
          if (interceptado || !sql.includes("AND anotador_usuario_id IS NULL")) return preparar(sql);
          interceptado = true;
          return {
            bind: () => ({
              run: async () =>
                ({
                  success: true,
                  results: [],
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: 0,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0
                  }
                }) as unknown as D1Result
            })
          } as unknown as D1PreparedStatement;
        };
      }
    }) as D1Database;
  }

  it("reintenta el CAS y reclama de verdad en vez de seguir sin dueño", async () => {
    const berta = await crearAdmin();
    const { partidoId, local } = await partidoLibre();

    const entorno = { ...env, DB: conPrimerCasFallido(env.DB) };
    const respuesta = await onRequestPost(
      ctx(
        await peticion(`/api/anotacion?partido=${partidoId}`, {
          method: "POST",
          user: berta,
          json: { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) }
        }),
        entorno
      )
    );

    // La primera consulta del CAS «perdió»: si no hubiera reintento, esto
    // sería un 409 contra un dueño fantasma, o pasaría sin haber reclamado
    // nada. Con el reintento, la segunda consulta sí es real y reclama.
    expect(respuesta.status).toBe(200);
    expect((await leer(berta, partidoId)).anotador.id).toBe(berta.id);
  });
});
