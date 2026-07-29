import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  onRequestDelete,
  onRequestGet,
  onRequestPatch,
  onRequestPost
} from "../../functions/api/admin/roles";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { CLAVES_PERMISO } from "../../functions/_lib/permisos";
import { ctx } from "../helpers/ctx";
import { asignarRol, crearAdmin, crearRol, crearUsuario, crearUsuarioConPermisos, peticion, rolPorClave } from "../helpers/db";

interface RolPublico {
  id: number;
  clave: string;
  nombre: string;
  esSistema: boolean;
  usuarios: number;
  permisos: string[];
}

const listar = async (user: UsuarioSesion): Promise<RolPublico[]> => {
  const respuesta = await onRequestGet(ctx(await peticion("/api/admin/roles", { user }), env));
  return ((await respuesta.json()) as { roles: RolPublico[] }).roles;
};

const crear = async (user: UsuarioSesion, cuerpo: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion("/api/admin/roles", { method: "POST", user, json: cuerpo }), env));

const editar = async (user: UsuarioSesion, id: number, cuerpo: Record<string, unknown>) =>
  onRequestPatch(ctx(await peticion(`/api/admin/roles?id=${id}`, { method: "PATCH", user, json: cuerpo }), env));

const borrar = async (user: UsuarioSesion, id: number) =>
  onRequestDelete(ctx(await peticion(`/api/admin/roles?id=${id}`, { method: "DELETE", user }), env));

const permisosDe = async (rolId: number) => {
  const { results } = await env.DB
    .prepare("SELECT permiso FROM rol_permisos WHERE rol_id = ?1 ORDER BY permiso")
    .bind(rolId)
    .all<{ permiso: string }>();
  return results.map((f) => f.permiso);
};

describe("GET /api/admin/roles", () => {
  it("exige el permiso roles.ver", async () => {
    const sinNada = await crearUsuario();
    const respuesta = await onRequestGet(ctx(await peticion("/api/admin/roles", { user: sinNada }), env));
    expect(respuesta.status).toBe(403);
  });

  it("trae el catálogo entero para pintar la pantalla", async () => {
    const admin = await crearAdmin();
    const respuesta = await onRequestGet(ctx(await peticion("/api/admin/roles", { user: admin }), env));
    const cuerpo = (await respuesta.json()) as { catalogo: { clave: string }[] };

    expect(cuerpo.catalogo.map((p) => p.clave).sort()).toEqual([...CLAVES_PERMISO].sort());
  });

  // Sus permisos son implícitos: no hay filas que listar, pero la pantalla tiene
  // que enseñarlos todos marcados igualmente.
  it("el rol de administración sale con el catálogo entero y marcado como de sistema", async () => {
    const admin = await crearAdmin();
    const roles = await listar(admin);
    const rolAdmin = roles.find((r) => r.clave === "admin")!;

    expect(rolAdmin.esSistema).toBe(true);
    expect(rolAdmin.permisos.sort()).toEqual([...CLAVES_PERMISO].sort());
    expect(await permisosDe(rolAdmin.id)).toEqual([]);
  });

  it("cuenta cuántas cuentas lleva cada rol", async () => {
    const admin = await crearAdmin();
    await crearUsuario({ rol: "organizacion" });
    await crearUsuario({ rol: "organizacion" });

    const roles = await listar(admin);
    expect(roles.find((r) => r.clave === "admin")!.usuarios).toBe(1);
    expect(roles.find((r) => r.clave === "organizacion")!.usuarios).toBe(2);
  });
});

describe("crear roles", () => {
  it("crea uno con sus permisos", async () => {
    const admin = await crearAdmin();
    const respuesta = await crear(admin, {
      clave: "arbitros",
      nombre: "Árbitros",
      descripcion: "Solo consulta",
      permisos: ["panel.entrar", "equipos.ver"]
    });

    expect(respuesta.status).toBe(201);
    const rol = (await listar(admin)).find((r) => r.clave === "arbitros")!;
    expect(rol.nombre).toBe("Árbitros");
    expect(rol.esSistema).toBe(false);
    expect(rol.permisos.sort()).toEqual(["equipos.ver", "panel.entrar"]);
  });

  it("rechaza una clave repetida", async () => {
    const admin = await crearAdmin();
    await crear(admin, { clave: "arbitros", nombre: "Árbitros", permisos: [] });

    const repe = await crear(admin, { clave: "arbitros", nombre: "Otros", permisos: [] });
    expect(repe.status).toBe(409);
  });

  it("rechaza la clave reservada del rol de sistema", async () => {
    const admin = await crearAdmin();
    const respuesta = await crear(admin, { clave: "admin", nombre: "Falso admin", permisos: [] });

    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.clave).toBeTruthy();
  });

  it("rechaza un permiso que no existe", async () => {
    const admin = await crearAdmin();
    const respuesta = await crear(admin, {
      clave: "raros",
      nombre: "Raros",
      permisos: ["equipos.ver", "inventado.editar"]
    });

    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.permisos).toContain(
      "inventado.editar"
    );
  });

  it("rechaza una clave con mayúsculas o espacios", async () => {
    const admin = await crearAdmin();
    expect((await crear(admin, { clave: "Con Espacios", nombre: "X", permisos: [] })).status).toBe(400);
  });
});

describe("editar y borrar roles", () => {
  it("reescribe nombre y permisos", async () => {
    const admin = await crearAdmin();
    const id = await crearRol("arbitros", ["equipos.ver", "camisetas.ver"]);

    const respuesta = await editar(admin, id, { nombre: "Árbitros de pista", permisos: ["equipos.ver"] });
    expect(respuesta.status).toBe(200);
    expect(await permisosDe(id)).toEqual(["equipos.ver"]);
  });

  it("borra un rol que no lleva nadie", async () => {
    const admin = await crearAdmin();
    const id = await crearRol("arbitros", []);

    expect((await borrar(admin, id)).status).toBe(200);
    expect((await listar(admin)).some((r) => r.clave === "arbitros")).toBe(false);
  });

  // La clave ajena de usuarios.rol_id no lleva ON DELETE: sin esta comprobación
  // el borrado reventaría con un error de base ilegible.
  it("no borra un rol que alguien lleva puesto, y dice cuántos", async () => {
    const admin = await crearAdmin();
    const id = await crearRol("arbitros", []);
    const user = await crearUsuario();
    await asignarRol(user.id, "arbitros");

    const respuesta = await borrar(admin, id);
    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("1 cuenta") });
    expect((await listar(admin)).some((r) => r.clave === "arbitros")).toBe(true);
  });

  it("responde 404 sobre un rol que ya no existe", async () => {
    const admin = await crearAdmin();
    expect((await editar(admin, 99999, { nombre: "X", permisos: [] })).status).toBe(404);
    expect((await borrar(admin, 99999)).status).toBe(404);
  });
});

/*
 * El candado que sostiene todo el diseño: si el rol de administración se pudiera
 * editar, un administrador podría quitarse `roles.editar` y dejar el sistema sin
 * nadie capaz de repartir permisos. Recuperarlo exigiría wrangler a mano.
 */
describe("el rol de administración es intocable", () => {
  it("no se puede editar", async () => {
    const admin = await crearAdmin();
    const id = await rolPorClave("admin");

    const respuesta = await editar(admin, id, { nombre: "Admin recortado", permisos: ["equipos.ver"] });
    expect(respuesta.status).toBe(409);
    expect(await permisosDe(id)).toEqual([]);
  });

  it("no se puede borrar", async () => {
    const admin = await crearAdmin();
    const id = await rolPorClave("admin");

    expect((await borrar(admin, id)).status).toBe(409);
    expect((await listar(admin)).some((r) => r.clave === "admin")).toBe(true);
  });

  it("sigue abriendo todo después de intentarlo", async () => {
    const admin = await crearAdmin();
    const id = await rolPorClave("admin");
    await editar(admin, id, { nombre: "Admin recortado", permisos: [] });

    const roles = await listar(admin);
    expect(roles.find((r) => r.clave === "admin")!.permisos.sort()).toEqual([...CLAVES_PERMISO].sort());
  });
});

/*
 * Sin esto, delegar `roles.editar` sería delegar el acceso total: bastaría con
 * crear un rol con todos los permisos y ponérselo a uno mismo.
 */
describe("nadie reparte permisos que no tiene", () => {
  it("no puede crear un rol con permisos fuera de su alcance", async () => {
    const gestor = await crearUsuarioConPermisos(["roles.ver", "roles.editar", "equipos.ver"]);

    const respuesta = await crear(gestor, {
      clave: "potente",
      nombre: "Potente",
      permisos: ["equipos.ver", "usuarios.editar"]
    });

    expect(respuesta.status).toBe(403);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.permisos).toContain(
      "usuarios.editar"
    );
  });

  it("sí puede crear uno contenido en el suyo", async () => {
    const gestor = await crearUsuarioConPermisos(["roles.ver", "roles.editar", "equipos.ver"]);

    expect(
      (await crear(gestor, { clave: "menor", nombre: "Menor", permisos: ["equipos.ver"] })).status
    ).toBe(201);
  });

  it("no puede tocar un rol que ya tiene permisos fuera de su alcance", async () => {
    const gestor = await crearUsuarioConPermisos(["roles.ver", "roles.editar", "equipos.ver"]);
    const id = await crearRol("potente", ["usuarios.editar"]);

    const respuesta = await editar(gestor, id, { nombre: "Inofensivo", permisos: ["equipos.ver"] });
    expect(respuesta.status).toBe(403);
    expect(await permisosDe(id)).toEqual(["usuarios.editar"]);
  });

  it("un admin sí puede con todo", async () => {
    const admin = await crearAdmin();
    const id = await crearRol("potente", ["usuarios.editar"]);

    expect((await editar(admin, id, { nombre: "Potente", permisos: ["roles.editar"] })).status).toBe(200);
    expect(await permisosDe(id)).toEqual(["roles.editar"]);
  });
});

describe("las escrituras exigen roles.editar", () => {
  it("con roles.ver a secas no se crea, ni se edita, ni se borra", async () => {
    const mirón = await crearUsuarioConPermisos(["roles.ver"]);
    const id = await crearRol("arbitros", []);

    expect((await crear(mirón, { clave: "x", nombre: "X", permisos: [] })).status).toBe(403);
    expect((await editar(mirón, id, { nombre: "X", permisos: [] })).status).toBe(403);
    expect((await borrar(mirón, id)).status).toBe(403);
  });

  it("sin sesión responde 401", async () => {
    const request = await peticion("/api/admin/roles", { method: "POST", json: { clave: "x", nombre: "X" } });
    expect((await onRequestPost(ctx(request, env))).status).toBe(401);
  });
});
