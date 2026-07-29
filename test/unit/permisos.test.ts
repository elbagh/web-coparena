import { describe, expect, it } from "vitest";
import {
  ACCIONES,
  CLAVES_PERMISO,
  PERMISOS,
  RECURSOS,
  ROLES_SISTEMA,
  ROL_ADMIN,
  permisosPublicos,
  sinRol,
  tieneAlguno,
  tienePermiso,
  type ContextoPermisos
} from "../../functions/_lib/permisos";

const contexto = (permisos: string[], extra: Partial<ContextoPermisos> = {}): ContextoPermisos => ({
  usuarioId: 1,
  rolId: 7,
  rolClave: "prueba",
  rolNombre: "Prueba",
  esAdmin: false,
  permisos: new Set(permisos),
  ...extra
});

describe("forma del catálogo", () => {
  it("toda clave es recurso.accion, y ambos existen", () => {
    for (const permiso of PERMISOS) {
      expect(permiso.clave).toBe(`${permiso.recurso}.${permiso.accion}`);
      expect(RECURSOS).toHaveProperty(permiso.recurso);
      expect(ACCIONES).toHaveProperty(permiso.accion);
    }
  });

  it("no hay claves repetidas", () => {
    expect(CLAVES_PERMISO.size).toBe(PERMISOS.length);
  });

  it("toda definición trae las dos etiquetas que pinta la pantalla de roles", () => {
    for (const permiso of PERMISOS) {
      expect(permiso.recursoEtiqueta.length).toBeGreaterThan(0);
      expect(permiso.etiqueta.length).toBeGreaterThan(0);
    }
  });

  // Son los que citan el código y las migraciones: si desaparecen, hay endpoints
  // apuntando a un permiso que nadie puede tener.
  it("incluye los permisos que usan los endpoints", () => {
    for (const clave of ["panel.entrar", "equipos.editar", "usuarios.ver_como", "roles.editar", "partidos.borrar"]) {
      expect(CLAVES_PERMISO.has(clave)).toBe(true);
    }
  });

  /*
   * GET /api/partidos es público: lo lee la portada sin sesión. Un
   * `partidos.ver` no guardaría nada y solo confundiría en la pantalla de roles.
   */
  it("no ofrece un permiso de lectura para algo que es público", () => {
    expect(CLAVES_PERMISO.has("partidos.ver")).toBe(false);
  });
});

describe("tienePermiso", () => {
  it("una cuenta sin rol no tiene ninguno", () => {
    const vacio = sinRol(42);
    expect(vacio.rolId).toBeNull();
    expect(vacio.esAdmin).toBe(false);
    for (const clave of CLAVES_PERMISO) expect(tienePermiso(vacio, clave)).toBe(false);
  });

  it("distingue permisos del mismo recurso", () => {
    const ctx = contexto(["equipos.ver"]);
    expect(tienePermiso(ctx, "equipos.ver")).toBe(true);
    expect(tienePermiso(ctx, "equipos.editar")).toBe(false);
    expect(tienePermiso(ctx, "equipos.borrar")).toBe(false);
  });

  it("tieneAlguno basta con uno", () => {
    const ctx = contexto(["camisetas.ver"]);
    expect(tieneAlguno(ctx, ["equipos.ver", "camisetas.ver"])).toBe(true);
    expect(tieneAlguno(ctx, ["equipos.ver", "usuarios.ver"])).toBe(false);
    expect(tieneAlguno(ctx, [])).toBe(false);
  });
});

describe("permisosPublicos", () => {
  it("saca claves y rol, nunca el id interno", () => {
    const salida = permisosPublicos(contexto(["equipos.ver", "camisetas.ver"]));
    expect(salida).toEqual({
      rol: "prueba",
      rolNombre: "Prueba",
      esAdmin: false,
      permisos: ["camisetas.ver", "equipos.ver"]
    });
    expect(salida).not.toHaveProperty("rolId");
    expect(salida).not.toHaveProperty("usuarioId");
  });

  it("una cuenta sin rol sale con la lista vacía", () => {
    expect(permisosPublicos(sinRol(3))).toEqual({ rol: null, rolNombre: null, esAdmin: false, permisos: [] });
  });
});

describe("roles de sistema", () => {
  it("solo `admin` es de sistema, y sus permisos son implícitos", () => {
    const admin = ROLES_SISTEMA.find((rol) => rol.clave === ROL_ADMIN);
    expect(admin?.esSistema).toBe(true);
    expect(admin?.permisos).toBe("todos");

    for (const rol of ROLES_SISTEMA.filter((r) => r.clave !== ROL_ADMIN)) {
      expect(rol.esSistema).toBe(false);
      expect(Array.isArray(rol.permisos)).toBe(true);
    }
  });

  it("los permisos que siembran existen en el catálogo", () => {
    for (const rol of ROLES_SISTEMA) {
      if (rol.permisos === "todos") continue;
      for (const permiso of rol.permisos) {
        expect(CLAVES_PERMISO.has(permiso), `${rol.clave} concede ${permiso}, que no existe`).toBe(true);
      }
    }
  });

  // Si «organización» llevara esto, delegarlo sería delegar el sistema entero.
  it("«organización» no toca cuentas ni roles", () => {
    const organizacion = ROLES_SISTEMA.find((rol) => rol.clave === "organizacion");
    const permisos = organizacion?.permisos as string[];
    expect(permisos.some((p) => p.startsWith("usuarios."))).toBe(false);
    expect(permisos.some((p) => p.startsWith("roles."))).toBe(false);
  });
});
