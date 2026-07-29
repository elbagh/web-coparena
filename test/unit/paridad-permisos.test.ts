import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAVES_PERMISO, ROLES_SISTEMA, ROL_ADMIN } from "../../functions/_lib/permisos";

/*
 * Una migración no puede importar de functions/, así que la semilla de roles de
 * 0013_roles.sql repite a mano lo que declara ROLES_SISTEMA. Este test es lo que
 * convierte «mantenlos en sintonía» en una regla exigible, igual que hace
 * paridad-validacion.test.ts con las reglas del formulario.
 */

const sql = readFileSync(
  fileURLToPath(new URL("../../db/migrations/0013_roles.sql", import.meta.url)),
  "utf8"
);

/** Los permisos que la migración concede a un rol, por su clave. */
function permisosSembrados(clave: string): string[] {
  const patron = new RegExp(`\\(SELECT id FROM roles WHERE clave = '${clave}'\\), '([^']+)'\\)`, "g");
  return [...sql.matchAll(patron)].map((coincidencia) => coincidencia[1]!);
}

describe("la semilla de roles va a la par que el código", () => {
  it("siembra exactamente los roles declarados", () => {
    for (const rol of ROLES_SISTEMA) {
      expect(sql, `falta el rol ${rol.clave} en la migración`).toContain(`('${rol.clave}',`);
    }

    const sembrados = [...sql.matchAll(/^\s*\('([a-z0-9-]+)', '/gm)].map((c) => c[1]!);
    expect(sembrados.sort()).toEqual(ROLES_SISTEMA.map((rol) => rol.clave).sort());
  });

  it("marca como de sistema los mismos que el código", () => {
    for (const rol of ROLES_SISTEMA) {
      const linea = sql.split("\n").find((l) => l.includes(`('${rol.clave}',`));
      expect(linea, `no encuentro la línea de ${rol.clave}`).toBeTruthy();
      expect(linea!.trimEnd().endsWith(rol.esSistema ? "1)," : "0),") || linea!.trimEnd().endsWith(rol.esSistema ? "1);" : "0);")).toBe(
        true
      );
    }
  });

  it("concede a cada rol la misma lista de permisos", () => {
    for (const rol of ROLES_SISTEMA) {
      if (rol.permisos === "todos") continue;
      expect(permisosSembrados(rol.clave).sort(), `los permisos de ${rol.clave} han divergido`).toEqual(
        [...rol.permisos].sort()
      );
    }
  });

  /*
   * Es el invariante que sostiene todo el diseño: si el rol de administración
   * tuviera filas, un administrador podría quitarse `roles.editar` y dejar el
   * sistema sin nadie capaz de repartir permisos.
   */
  it("no siembra ni una fila de permisos para el rol de administración", () => {
    expect(permisosSembrados(ROL_ADMIN)).toEqual([]);
  });

  it("no siembra permisos que no existan en el catálogo", () => {
    const todos = [...sql.matchAll(/, '([a-z_]+\.[a-z_]+)'\)/g)].map((c) => c[1]!);
    expect(todos.length).toBeGreaterThan(0);
    for (const permiso of todos) {
      expect(CLAVES_PERMISO.has(permiso), `la migración concede ${permiso}, que no está en el catálogo`).toBe(true);
    }
  });
});
