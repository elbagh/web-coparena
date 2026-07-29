import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { onRequestGet, onRequestPatch } from "../../functions/api/admin/usuarios";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import {
  crearAdmin,
  crearEdicion,
  crearEquipo,
  crearRol,
  crearUsuario,
  crearUsuarioConPermisos,
  peticion,
  rolPorClave
} from "../helpers/db";

/*
 * Los candados sobre el rol. Si fallan, el panel puede quedarse sin ningún
 * administrador y recuperarlo exigiría tocar D1 a mano con wrangler; o peor,
 * alguien con permiso para editar cuentas puede ascenderse a sí mismo.
 */

let idAdmin = 0;
beforeEach(async () => {
  idAdmin = await rolPorClave("admin");
});

const esAdmin = async (id: number) =>
  (
    await env.DB
      .prepare(
        "SELECT r.clave FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id WHERE u.id = ?1"
      )
      .bind(id)
      .first<{ clave: string | null }>()
  )?.clave === "admin";

const cuantosAdmins = async () =>
  (
    await env.DB
      .prepare("SELECT COUNT(*) AS n FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.clave = 'admin'")
      .first<{ n: number }>()
  )?.n ?? 0;

async function cambiar(admin: UsuarioSesion, objetivoId: number, cuerpo: Record<string, unknown>) {
  const request = await peticion(`/api/admin/usuarios?id=${objetivoId}`, {
    method: "PATCH",
    user: admin,
    json: cuerpo
  });
  return onRequestPatch(ctx(request, env));
}

describe("nadie se quita a sí mismo el rol de administración", () => {
  it("rechaza la auto-degradación aunque haya más administradores", async () => {
    const admin = await crearAdmin();
    await crearAdmin();

    const respuesta = await cambiar(admin, admin.id, { rolId: null });

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("a ti mismo") });
    expect(await esAdmin(admin.id)).toBe(true);
  });

  it("rechaza la auto-degradación del único administrador que queda", async () => {
    const admin = await crearAdmin();
    expect(await cuantosAdmins()).toBe(1);

    expect((await cambiar(admin, admin.id, { rolId: null })).status).toBe(400);
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
 */
describe("nunca se queda el sistema sin administradores", () => {
  it("degradar a otro administrador solo se permite si queda alguno", async () => {
    const admin = await crearAdmin();
    const otro = await crearAdmin();

    expect((await cambiar(admin, otro.id, { rolId: null })).status).toBe(200);
    expect(await esAdmin(otro.id)).toBe(false);
    expect(await cuantosAdmins()).toBe(1);
  });

  it("tras degradar a todos los demás, el último no puede degradarse", async () => {
    const admin = await crearAdmin();
    const segundo = await crearAdmin();
    const tercero = await crearAdmin();

    await cambiar(admin, segundo.id, { rolId: null });
    await cambiar(admin, tercero.id, { rolId: null });
    expect(await cuantosAdmins()).toBe(1);

    expect((await cambiar(admin, admin.id, { rolId: null })).status).toBe(400);
    expect(await cuantosAdmins()).toBe(1);
  });

  /*
   * Con el booleano is_admin esta rama era inalcanzable: quien pedía el cambio
   * era siempre administrador, así que al contar excluyendo al objetivo siempre
   * quedaba él. Con RBAC ya no: `usuarios.editar` es delegable a alguien que no
   * es admin, y esa persona sí puede intentar degradar al último que queda.
   */
  it("quien no es admin tampoco puede degradar al último administrador", async () => {
    const admin = await crearAdmin();
    const gestor = await crearUsuarioConPermisos(["usuarios.ver", "usuarios.editar"]);

    const respuesta = await cambiar(gestor, admin.id, { rolId: null });

    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("al menos un administrador") });
    expect(await cuantosAdmins()).toBe(1);
  });

  it("promover a un usuario normal funciona", async () => {
    const admin = await crearAdmin();
    const user = await crearUsuario();

    expect((await cambiar(admin, user.id, { rolId: idAdmin })).status).toBe(200);
    expect(await esAdmin(user.id)).toBe(true);
  });

  it("volver a conceder el rol a quien lo perdió funciona", async () => {
    const admin = await crearAdmin();
    const otro = await crearAdmin();

    await cambiar(admin, otro.id, { rolId: null });
    expect((await cambiar(admin, otro.id, { rolId: idAdmin })).status).toBe(200);
    expect(await cuantosAdmins()).toBe(2);
  });
});

/*
 * Sin este candado, delegar `usuarios.editar` sería delegar el acceso total:
 * bastaría con asignarse a uno mismo un rol mejor que el propio.
 */
describe("nadie reparte permisos que no tiene", () => {
  it("quien no es admin no puede conceder el rol de administración", async () => {
    await crearAdmin();
    const gestor = await crearUsuarioConPermisos(["usuarios.ver", "usuarios.editar"]);
    const victima = await crearUsuario();

    const respuesta = await cambiar(gestor, victima.id, { rolId: idAdmin });

    expect(respuesta.status).toBe(403);
    expect(await esAdmin(victima.id)).toBe(false);
  });

  it("quien no es admin no puede asignar un rol con permisos fuera de su alcance", async () => {
    await crearAdmin();
    const gestor = await crearUsuarioConPermisos(["usuarios.ver", "usuarios.editar"]);
    const objetivo = await crearUsuario();
    const rolPotente = await crearRol("rol-potente", ["equipos.borrar", "roles.editar"]);

    const respuesta = await cambiar(gestor, objetivo.id, { rolId: rolPotente });

    expect(respuesta.status).toBe(403);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("no tienes") });
  });

  it("sí puede asignar un rol contenido en el suyo", async () => {
    await crearAdmin();
    const gestor = await crearUsuarioConPermisos(["usuarios.ver", "usuarios.editar", "equipos.ver"]);
    const objetivo = await crearUsuario();
    const rolMenor = await crearRol("rol-menor", ["equipos.ver"]);

    expect((await cambiar(gestor, objetivo.id, { rolId: rolMenor })).status).toBe(200);
  });

  it("un admin puede asignar cualquier rol", async () => {
    const admin = await crearAdmin();
    const objetivo = await crearUsuario();
    const rolPotente = await crearRol("rol-potente-2", ["roles.editar", "ediciones.borrar"]);

    expect((await cambiar(admin, objetivo.id, { rolId: rolPotente })).status).toBe(200);
  });
});

describe("acceso y validación del endpoint", () => {
  it("una cuenta sin rol no puede tocar cuentas", async () => {
    const user = await crearUsuario();
    const objetivo = await crearUsuario();

    expect((await cambiar(user, objetivo.id, { rolId: idAdmin })).status).toBe(403);
    expect(await esAdmin(objetivo.id)).toBe(false);
  });

  it("sin sesión responde 401", async () => {
    const objetivo = await crearUsuario();
    const request = await peticion(`/api/admin/usuarios?id=${objetivo.id}`, {
      method: "PATCH",
      json: { rolId: idAdmin }
    });

    expect((await onRequestPatch(ctx(request, env))).status).toBe(401);
    expect(await esAdmin(objetivo.id)).toBe(false);
  });

  it("responde 404 si la cuenta no existe", async () => {
    const admin = await crearAdmin();
    expect((await cambiar(admin, 99999, { rolId: idAdmin })).status).toBe(404);
  });

  it("rechaza un id que no es un entero positivo", async () => {
    const admin = await crearAdmin();
    const request = await peticion("/api/admin/usuarios?id=abc", {
      method: "PATCH",
      user: admin,
      json: { rolId: idAdmin }
    });
    expect((await onRequestPatch(ctx(request, env))).status).toBe(400);
  });

  it("rechaza un rol que no existe", async () => {
    const admin = await crearAdmin();
    const user = await crearUsuario();

    const respuesta = await cambiar(admin, user.id, { rolId: 99999 });
    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.rolId).toBeTruthy();
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

describe("GET /api/admin/usuarios", () => {
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

  // El desplegable de rol se pinta con esta lista: sin ella habría que pedir
  // además `roles.ver` solo para poder editar una cuenta.
  it("trae la lista de roles para el desplegable", async () => {
    const admin = await crearAdmin();
    const respuesta = await onRequestGet(ctx(await peticion("/api/admin/usuarios", { user: admin }), env));

    const cuerpo = (await respuesta.json()) as { roles: { clave: string }[] };
    expect(cuerpo.roles.map((r) => r.clave)).toEqual(expect.arrayContaining(["admin", "organizacion"]));
  });

  it("expone el rol de cada cuenta", async () => {
    const admin = await crearAdmin();
    const sinRol = await crearUsuario();

    const respuesta = await onRequestGet(ctx(await peticion("/api/admin/usuarios", { user: admin }), env));
    const cuerpo = (await respuesta.json()) as {
      usuarios: { id: number; rolClave: string | null; esAdmin: boolean }[];
    };

    expect(cuerpo.usuarios.find((u) => u.id === admin.id)).toMatchObject({ rolClave: "admin", esAdmin: true });
    expect(cuerpo.usuarios.find((u) => u.id === sinRol.id)).toMatchObject({ rolClave: null, esAdmin: false });
  });
});
