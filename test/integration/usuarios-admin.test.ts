import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPatch } from "../../functions/api/admin/usuarios";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEdicion, crearEquipo, crearUsuario, peticion } from "../helpers/db";

/*
 * Los candados sobre is_admin. Si fallan, el panel puede quedarse sin ningún
 * administrador y recuperarlo exigiría tocar D1 a mano con wrangler.
 */

const esAdmin = async (id: number) =>
  (await env.DB.prepare("SELECT is_admin FROM usuarios WHERE id = ?1").bind(id).first<{ is_admin: number }>())
    ?.is_admin === 1;

const cuantosAdmins = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE is_admin = 1").first<{ n: number }>())?.n ?? 0;

async function cambiar(admin: UsuarioSesion, objetivoId: number, cuerpo: Record<string, unknown>) {
  const request = await peticion(`/api/admin/usuarios?id=${objetivoId}`, {
    method: "PATCH",
    user: admin,
    json: cuerpo
  });
  return onRequestPatch(ctx(request, env));
}

describe("nadie se quita a sí mismo el permiso", () => {
  it("rechaza la auto-degradación aunque haya más administradores", async () => {
    const admin = await crearAdmin();
    await crearAdmin();

    const respuesta = await cambiar(admin, admin.id, { esAdmin: false });

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("a ti mismo") });
    expect(await esAdmin(admin.id)).toBe(true);
  });

  it("rechaza la auto-degradación del único administrador que queda", async () => {
    const admin = await crearAdmin();
    expect(await cuantosAdmins()).toBe(1);

    expect((await cambiar(admin, admin.id, { esAdmin: false })).status).toBe(400);
    expect(await cuantosAdmins()).toBe(1);
  });

  it("un admin puede cambiarse otros datos de su propia cuenta", async () => {
    const admin = await crearAdmin();

    expect((await cambiar(admin, admin.id, { nombre: "Nombre Nuevo" })).status).toBe(200);
    expect(await esAdmin(admin.id)).toBe(true);
  });
});

/*
 * El invariante real que sostiene el sistema, comprobado por el resultado y no
 * por la rama concreta que lo produce: hagas lo que hagas desde el panel, nunca
 * te quedas sin administradores.
 *
 * Nota sobre la rama 409 ("Tiene que quedar al menos un administrador") de
 * validarCambioDeAdmin: hoy es inalcanzable. requireAdmin garantiza que quien
 * pide es administrador, y el caso "soy yo mismo" ya lo corta el 400 anterior;
 * por tanto, al contar administradores excluyendo al objetivo siempre queda al
 * menos quien hace la petición. Es defensa en profundidad, no una rama viva, y
 * por eso no se testea directamente: un test que la cubriera tendría que
 * falsear el estado de forma imposible en producción.
 */
describe("nunca se queda el sistema sin administradores", () => {
  it("degradar a otro administrador solo se permite si queda alguno", async () => {
    const admin = await crearAdmin();
    const otro = await crearAdmin();

    expect((await cambiar(admin, otro.id, { esAdmin: false })).status).toBe(200);
    expect(await esAdmin(otro.id)).toBe(false);
    expect(await cuantosAdmins()).toBe(1);
  });

  it("tras degradar a todos los demás, el último no puede degradarse", async () => {
    const admin = await crearAdmin();
    const segundo = await crearAdmin();
    const tercero = await crearAdmin();

    await cambiar(admin, segundo.id, { esAdmin: false });
    await cambiar(admin, tercero.id, { esAdmin: false });
    expect(await cuantosAdmins()).toBe(1);

    expect((await cambiar(admin, admin.id, { esAdmin: false })).status).toBe(400);
    expect(await cuantosAdmins()).toBe(1);
  });

  it("promover a un usuario normal funciona", async () => {
    const admin = await crearAdmin();
    const user = await crearUsuario();

    expect((await cambiar(admin, user.id, { esAdmin: true })).status).toBe(200);
    expect(await esAdmin(user.id)).toBe(true);
  });

  it("volver a conceder el permiso a quien lo perdió funciona", async () => {
    const admin = await crearAdmin();
    const otro = await crearAdmin();

    await cambiar(admin, otro.id, { esAdmin: false });
    expect((await cambiar(admin, otro.id, { esAdmin: true })).status).toBe(200);
    expect(await cuantosAdmins()).toBe(2);
  });
});

describe("acceso y validación del endpoint", () => {
  it("un usuario sin permiso no puede tocar cuentas", async () => {
    const user = await crearUsuario();
    const objetivo = await crearUsuario();

    expect((await cambiar(user, objetivo.id, { esAdmin: true })).status).toBe(403);
    expect(await esAdmin(objetivo.id)).toBe(false);
  });

  it("sin sesión responde 401", async () => {
    const objetivo = await crearUsuario();
    const request = await peticion(`/api/admin/usuarios?id=${objetivo.id}`, {
      method: "PATCH",
      json: { esAdmin: true }
    });

    expect((await onRequestPatch(ctx(request, env))).status).toBe(401);
    expect(await esAdmin(objetivo.id)).toBe(false);
  });

  it("responde 404 si la cuenta no existe", async () => {
    const admin = await crearAdmin();
    expect((await cambiar(admin, 99999, { esAdmin: true })).status).toBe(404);
  });

  it("rechaza un id que no es un entero positivo", async () => {
    const admin = await crearAdmin();
    const request = await peticion("/api/admin/usuarios?id=abc", {
      method: "PATCH",
      user: admin,
      json: { esAdmin: true }
    });
    expect((await onRequestPatch(ctx(request, env))).status).toBe(400);
  });

  it("rechaza un nombre de más de 80 caracteres", async () => {
    const admin = await crearAdmin();
    const user = await crearUsuario();

    const respuesta = await cambiar(admin, user.id, { nombre: "N".repeat(81) });
    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.nombre).toBeTruthy();
  });

  it("rechaza una petición sin ningún cambio", async () => {
    const admin = await crearAdmin();
    const user = await crearUsuario();
    expect((await cambiar(admin, user.id, {})).status).toBe(400);
  });
});

describe("GET /api/admin/usuarios: equipo del listado", () => {
  // owner_user_id tenía un índice UNIQUE global: una cuenta era dueña de un
  // equipo para siempre. capitan_jugador_id no lo tiene —la migración 0010
  // habilitó a propósito volver a inscribirse cada edición— así que el
  // listado tiene que elegir el equipo más reciente, no el primero que
  // encuentre.
  it("muestra el equipo más reciente cuando la cuenta ha capitaneado más de uno", async () => {
    const admin = await crearAdmin();
    const capitana = await crearUsuario({ email: "capitana@example.com" });

    const edicionAnterior = await crearEdicion();
    await crearEquipo({
      nombre: "Equipo Viejo",
      jugadores: [{ email: capitana.email }, {}],
      edicionId: edicionAnterior.id
    });
    const reciente = await crearEquipo({
      nombre: "Equipo Nuevo",
      jugadores: [{ email: capitana.email }, {}]
    });

    const respuesta = await onRequestGet(ctx(await peticion("/api/admin/usuarios", { user: admin }), env));
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as {
      usuarios: { id: number; equipoId: number | null; equipoNombre: string | null }[];
    };
    const fila = cuerpo.usuarios.find((u) => u.id === capitana.id);
    expect(fila?.equipoId).toBe(reciente.id);
    expect(fila?.equipoNombre).toBe("Equipo Nuevo");
  });
});
