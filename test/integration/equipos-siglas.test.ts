import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPatch } from "../../functions/api/admin/equipos";
import { onRequestGet as resumenAdmin } from "../../functions/api/admin/index";
import { ctx } from "../helpers/ctx";
import { cookieSesion, crearAdmin, crearEquipo, peticion } from "../helpers/db";

/*
 * Las siglas las cura la organización, no el equipo que se apunta: por eso van
 * en el panel y NO en /inscripcion/. Sirven para deshacer un choque —«Os Pulpos»
 * y «Os Percebes» derivan las mismas— que el chip de la cabecera no sabría
 * explicar.
 *
 * Viajan como campo multipart SUELTO, no dentro de `payload`: ese JSON pasa por
 * `validarRegistro`, que comparten /inscripcion/ y /mi-equipo/ y que ata
 * `paridad-validacion.test.ts` a cuatro scripts de cliente.
 */

/**
 * El editor del panel: multipart con `payload` más los campos sueltos.
 *
 * Dos ajustes sobre el borrador original de este test, los dos porque
 * `validarRegistro` es más estricta de lo que parece a primera vista:
 *  - `capitan` no tiene valor por defecto (a propósito: adivinar el jugador 0
 *    podría cambiar el mando de un equipo sin que nadie lo pidiera), así que
 *    hay que decir quién lo es. Aquí es el índice 0, el único con móvil y
 *    correo.
 *  - los nombres no pueden llevar dígitos (`NOMBRE_PATTERN` es solo letras),
 *    así que "Jugador0"/"Jugador1" quedaría rechazado por el propio nombre en
 *    vez de probar las siglas. Se usan letras (A, B…) en su lugar.
 */
async function guardar(equipo: { id: number; nombre: string; jugadores: { id: number }[] }, siglas?: string) {
  const admin = await crearAdmin();
  const fd = new FormData();
  fd.append(
    "payload",
    JSON.stringify({
      equipo: equipo.nombre,
      capitan: 0,
      jugadores: equipo.jugadores.map((jugador, i) => ({
        id: jugador.id,
        nombre: `Jugador${String.fromCharCode(65 + i)}`,
        apellidos: "Apellido",
        telefono: i === 0 ? "600000000" : "",
        email: i === 0 ? `j${i}.${equipo.id}@ejemplo.com` : ""
      }))
    })
  );
  if (siglas !== undefined) fd.append("siglas", siglas);

  return await onRequestPatch(
    ctx(
      await peticion(`/api/admin/equipos?id=${equipo.id}`, {
        method: "PATCH",
        headers: { Cookie: await cookieSesion(admin) },
        body: fd
      }),
      env
    )
  );
}

const siglasDe = async (equipoId: number) =>
  (await env.DB.prepare("SELECT siglas FROM equipos WHERE id = ?1").bind(equipoId).first<{ siglas: string | null }>())!
    .siglas;

describe("siglas desde el panel", () => {
  it("se guardan en mayúsculas", async () => {
    const equipo = await crearEquipo({ nombre: "Ostreiros do Pozo" });

    expect((await guardar(equipo, "odp")).status).toBe(200);
    expect(await siglasDe(equipo.id)).toBe("ODP");
  });

  it("vaciarlas devuelve a la derivación automática", async () => {
    const equipo = await crearEquipo({ nombre: "Ostreiros do Pozo" });
    await guardar(equipo, "ODP");

    expect((await guardar(equipo, "")).status).toBe(200);
    expect(await siglasDe(equipo.id)).toBeNull();
  });

  it("menos de dos o más de cuatro caracteres se rechaza", async () => {
    const equipo = await crearEquipo({ nombre: "Ostreiros do Pozo" });

    expect((await guardar(equipo, "O")).status).toBe(400);
    expect((await guardar(equipo, "OSTRE")).status).toBe(400);
    expect(await siglasDe(equipo.id)).toBeNull();
  });

  /*
   * El editor de plantilla se guarda entero cada vez. Si no mandar el campo
   * borrase las siglas, cualquier cambio de plantilla las perdería en silencio
   * —el mismo tipo de fallo que el UPDATE de `equipo-editor.ts` evita con las
   * columnas del cromo—.
   */
  it("guardar la plantilla sin mandar el campo no las borra", async () => {
    const equipo = await crearEquipo({ nombre: "Os Pulpos" });
    await guardar(equipo, "PUL");

    await guardar(equipo);
    expect(await siglasDe(equipo.id)).toBe("PUL");
  });

  it("el equipo cargado las devuelve", async () => {
    const equipo = await crearEquipo({ nombre: "Os Pulpos" });
    const respuesta = await guardar(equipo, "PUL");
    const cuerpo = (await respuesta.json()) as { equipo: { siglas: string | null } };

    expect(cuerpo.equipo.siglas).toBe("PUL");
  });

  /*
   * El botón «Editar» de la tabla abre el editor con la fila que ya tiene en
   * memoria, la del listado de `GET /api/admin` — no vuelve a pedir la ficha
   * completa. Si ese listado no lleva `siglas`, reabrir el editor tras guardar
   * enseña el campo vacío aunque la base de datos sí las tenga: parece que no
   * se guardaron.
   */
  it("el listado del panel también las lleva", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ nombre: "Os Pulpos" });
    await guardar(equipo, "PUL");

    const respuesta = await resumenAdmin(
      ctx(await peticion("/api/admin", { method: "GET", headers: { Cookie: await cookieSesion(admin) } }), env)
    );
    const cuerpo = (await respuesta.json()) as { equipos: { id: number; siglas: string | null }[] };
    const fila = cuerpo.equipos.find((e) => e.id === equipo.id);

    expect(fila?.siglas).toBe("PUL");
  });
});
