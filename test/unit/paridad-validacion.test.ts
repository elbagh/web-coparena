import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * public/assets/team-form.js valida en cliente exactamente las mismas reglas que
 * functions/_lib/validacion.ts, pero es una copia a mano: se carga con
 * <script is:inline> y no pasa por el bundler, así que no puede importar nada
 * del servidor. Nada impide que las dos versiones se separen y que el formulario
 * acepte en pantalla algo que el endpoint rechaza (o al revés).
 *
 * Este test no ejecuta la validación de cliente: compara los literales
 * compartidos entre los dos ficheros. Es un detector de deriva.
 *
 * El mensaje de contacto del capitán (MENSAJE_CAPITAN_CONTACTO) vive en CUATRO
 * copias — team-form.js (/inscripcion/), my-team.js (/mi-equipo/),
 * admin/equipos.js (editor de plantilla del panel) y admin/jugadores.js (alta y
 * edición sueltas) — porque las cuatro se cargan con <script is:inline> y
 * ninguna puede importar del servidor. Los avisos de "sin contacto"
 * (AVISO_SIN_MOVIL/CORREO/CONTACTO) solo hacen falta en los dos formularios
 * públicos, team-form.js y my-team.js: el panel no los pinta.
 */

const raiz = path.resolve(import.meta.dirname, "../..");
const servidor = readFileSync(path.join(raiz, "functions/_lib/validacion.ts"), "utf8");
const cliente = readFileSync(path.join(raiz, "public/assets/team-form.js"), "utf8");
const miEquipo = readFileSync(path.join(raiz, "public/assets/my-team.js"), "utf8");
const adminEquipos = readFileSync(path.join(raiz, "public/assets/admin/equipos.js"), "utf8");
const adminJugadores = readFileSync(path.join(raiz, "public/assets/admin/jugadores.js"), "utf8");

const AVISO = "team-form.js ha derivado de validacion.ts: las reglas de cliente y servidor ya no coinciden.";

/** Primer grupo capturado de `patron` en `fuente`, o null. */
function extraer(fuente: string, patron: RegExp): string | null {
  return fuente.match(patron)?.[1]?.trim() ?? null;
}

/** Comprueba que el mismo valor aparece en los dos ficheros. */
function comparar(etiqueta: string, patronServidor: RegExp, patronCliente: RegExp) {
  const enServidor = extraer(servidor, patronServidor);
  const enCliente = extraer(cliente, patronCliente);

  expect(enServidor, `no se ha encontrado ${etiqueta} en validacion.ts`).not.toBeNull();
  expect(enCliente, `no se ha encontrado ${etiqueta} en team-form.js`).not.toBeNull();
  expect(enCliente, `${etiqueta}: ${AVISO}`).toBe(enServidor);
}

describe("paridad entre team-form.js y validacion.ts", () => {
  it("comparte los límites de plantilla y de foto", () => {
    comparar("MIN_JUGADORES", /MIN_JUGADORES\s*=\s*([^;]+);/, /MIN_JUGADORES\s*=\s*([^;]+);/);
    comparar("MAX_JUGADORES", /MAX_JUGADORES\s*=\s*([^;]+);/, /MAX_JUGADORES\s*=\s*([^;]+);/);
    comparar("MAX_FOTO_BYTES", /MAX_FOTO_BYTES\s*=\s*([^;]+);/, /MAX_FOTO_BYTES\s*=\s*([^;]+);/);
  });

  it("comparte los tipos de imagen admitidos", () => {
    const enServidor = extraer(servidor, /TIPOS_FOTO\s*=\s*new Set\(\[([^\]]+)\]\)/);
    const enCliente = extraer(cliente, /TIPOS_FOTO\s*=\s*\[([^\]]+)\]/);
    expect(enServidor).not.toBeNull();
    expect(enCliente).not.toBeNull();
    expect(enCliente, `TIPOS_FOTO: ${AVISO}`).toBe(enServidor);
  });

  it("comparte el patrón de correo", () => {
    comparar("patrón de email", /EMAIL_PATTERN\s*=\s*(.+);/, /EMAIL_RE\s*=\s*(.+);/);
  });

  it("comparte el patrón de nombre y apellidos", () => {
    comparar("patrón de nombre", /NOMBRE_PATTERN\s*=\s*(.+);/, /NOMBRE_RE\s*=\s*(.+);/);
  });

  it("comparte el patrón de usuario de red social", () => {
    comparar("patrón de handle", /HANDLE_PATTERN\s*=\s*(.+);/, /HANDLE_RE\s*=\s*(.+);/);
  });

  it("comparte el patrón de URL de red social", () => {
    comparar("patrón de URL social", /URL_SOCIAL_PATTERN\s*=\s*(.+);/, /URL_SOCIAL_RE\s*=\s*(.+);/);
  });

  it("comparte el patrón de móvil", () => {
    // En el cliente el patrón va en línea dentro del switch de validarCampo.
    comparar("patrón de móvil", /MOVIL_PATTERN\s*=\s*(.+);/, /!(\/\^\[67\]\\d\{8\}\$\/)\.test\(movilNormalizado/);
  });

  it("comparte la normalización del móvil", () => {
    comparar(
      "normalización de móvil",
      /normalizarTelefono\s*=\s*\(s: string\): string =>\s*s\.(replace[\s\S]*?);/,
      /movilNormalizado\s*=\s*\(v\)\s*=>\s*v\.(replace.*);/
    );
  });

  it("comparte la normalización del correo", () => {
    // El servidor recorta y baja a minúsculas; el cliente hace lo mismo pasando
    // antes por `limpiar`, que además colapsa espacios interiores.
    expect(extraer(servidor, /normalizarEmail\s*=\s*\(s: string\): string =>\s*(.+);/)).toBe(
      "s.trim().toLowerCase()"
    );
    expect(extraer(cliente, /emailNormalizado\s*=\s*\(v\)\s*=>\s*(.+);/), AVISO).toBe(
      "limpiar(v).toLowerCase()"
    );
  });

  it("comparte el mensaje de contacto del capitán", () => {
    comparar(
      "mensaje de contacto del capitán",
      /MENSAJE_CAPITAN_CONTACTO\s*=\s*(.+);/,
      /MENSAJE_CAPITAN_CONTACTO\s*=\s*(.+);/
    );
  });

  it("el mensaje de contacto del capitán no diverge entre los cuatro clientes", () => {
    // team-form.js ya se comparó con el servidor arriba; aquí se comprueba que
    // los otros tres no se han quedado atrás, que es justo lo que le pasó a
    // admin/jugadores.js antes de este test.
    const patron = /MENSAJE_CAPITAN_CONTACTO\s*=\s*(.+);/;
    const enTeamForm = extraer(cliente, patron);
    const enMiEquipo = extraer(miEquipo, patron);
    const enAdminEquipos = extraer(adminEquipos, patron);
    const enAdminJugadores = extraer(adminJugadores, patron);

    expect(enTeamForm, "no se ha encontrado MENSAJE_CAPITAN_CONTACTO en team-form.js").not.toBeNull();
    expect(enMiEquipo, "no se ha encontrado MENSAJE_CAPITAN_CONTACTO en my-team.js").not.toBeNull();
    expect(enAdminEquipos, "no se ha encontrado MENSAJE_CAPITAN_CONTACTO en admin/equipos.js").not.toBeNull();
    expect(enAdminJugadores, "no se ha encontrado MENSAJE_CAPITAN_CONTACTO en admin/jugadores.js").not.toBeNull();

    expect(enMiEquipo, `my-team.js: ${AVISO}`).toBe(enTeamForm);
    expect(enAdminEquipos, `admin/equipos.js: ${AVISO}`).toBe(enTeamForm);
    expect(enAdminJugadores, `admin/jugadores.js: ${AVISO}`).toBe(enTeamForm);
  });

  it("los avisos de «sin contacto» no divergen entre team-form.js y my-team.js", () => {
    // Solo los dos formularios públicos los pintan; el panel no los usa.
    ["AVISO_SIN_MOVIL", "AVISO_SIN_CORREO", "AVISO_SIN_CONTACTO"].forEach((nombre) => {
      const patron = new RegExp(`${nombre}\\s*=\\s*([\\s\\S]+?);`);
      const enTeamForm = extraer(cliente, patron);
      const enMiEquipo = extraer(miEquipo, patron);

      expect(enTeamForm, `no se ha encontrado ${nombre} en team-form.js`).not.toBeNull();
      expect(enMiEquipo, `no se ha encontrado ${nombre} en my-team.js`).not.toBeNull();
      expect(enMiEquipo, `${nombre}: ${AVISO}`).toBe(enTeamForm);
    });
  });
});

/*
 * Lo mismo con el álbum: players-list.js repite a mano la lista de métricas
 * porque tampoco puede importar del servidor. Si una crece y la otra no, la
 * ficha pública deja de pintar lo que la API devuelve.
 *
 * La lista de **atributos** ya solo está en dos sitios: _lib/perfil.ts y
 * cromo.js, que es quien pinta la rejilla 2×3. Antes estaba copiada cuatro
 * veces en cliente; players-list.js y perfil.js le pasan ahora el objeto crudo
 * de la API y no vuelven a declararla, y eso también se comprueba aquí.
 */

const estadisticasTs = readFileSync(path.join(raiz, "functions/_lib/estadisticas.ts"), "utf8");
const perfilTs = readFileSync(path.join(raiz, "functions/_lib/perfil.ts"), "utf8");
const album = readFileSync(path.join(raiz, "public/assets/players-list.js"), "utf8");
const miZona = readFileSync(path.join(raiz, "public/assets/perfil.js"), "utf8");
const cromo = readFileSync(path.join(raiz, "public/assets/cromo.js"), "utf8");

/** Claves de un array de objetos literales: `{ clave: "puntos", ... }`. */
const claves = (fuente: string, patron: RegExp, campo: string): string[] => {
  const bloque = fuente.match(patron)?.[1] ?? "";
  return [...bloque.matchAll(new RegExp(`${campo}:\\s*"([^"]+)"`, "g"))].map((m) => m[1]!);
};

describe("paridad entre players-list.js y el servidor", () => {
  it("comparte las claves de las métricas", () => {
    const enServidor = claves(estadisticasTs, /METRICAS: Metrica\[\] = \[([\s\S]*?)\];/, "clave");
    const enCliente = claves(album, /METRICAS = \[([\s\S]*?)\];/, "clave");

    expect(enServidor.length).toBeGreaterThan(0);
    expect(enCliente, "players-list.js ha derivado de estadisticas.ts: las métricas ya no coinciden.").toEqual(
      enServidor
    );
  });

});

describe("paridad entre cromo.js y el servidor", () => {
  const PATRON_SERVIDOR = /ATRIBUTOS: Atributo\[\] = \[([\s\S]*?)\];/;
  const PATRON_CROMO = /ATRIBUTOS = \[([\s\S]*?)\];/;
  const AVISO_ATRIBUTOS = "cromo.js ha derivado de perfil.ts: los atributos ya no coinciden.";

  it("comparte las claves de los atributos, en el mismo orden", () => {
    // El orden importa: es el que decide qué cae en cada hueco de la rejilla
    // 2×3 del cromo.
    const enServidor = claves(perfilTs, PATRON_SERVIDOR, "clave");
    const enCromo = claves(cromo, PATRON_CROMO, "clave");

    expect(enServidor.length).toBe(6);
    expect(enCromo, AVISO_ATRIBUTOS).toEqual(enServidor);
  });

  it("comparte las etiquetas y las abreviaturas", () => {
    // Las abreviaturas solo las pinta el cromo, pero el panel enseña las
    // etiquetas que manda el servidor: si divergen, el mismo atributo se llama
    // de dos formas según dónde se mire.
    expect(claves(cromo, PATRON_CROMO, "etiqueta"), AVISO_ATRIBUTOS).toEqual(
      claves(perfilTs, PATRON_SERVIDOR, "etiqueta")
    );
    expect(claves(cromo, PATRON_CROMO, "abrev"), AVISO_ATRIBUTOS).toEqual(
      claves(perfilTs, PATRON_SERVIDOR, "abrev")
    );
  });

  it("comparte los niveles del cromo", () => {
    const lista = (fuente: string) =>
      extraer(fuente, /NIVELES = \[([^\]]+)\]/)
        ?.split(",")
        .map((s) => s.trim().replace(/"/g, ""));

    expect(lista(perfilTs)).toEqual(["bronce", "plata", "oro"]);
    expect(lista(cromo), "cromo.js y perfil.ts ya no coinciden en los niveles.").toEqual(lista(perfilTs));
  });

  it("las páginas ya no repiten la lista de atributos", () => {
    // Estaba copiada cuatro veces en cliente. Si alguien la vuelve a declarar
    // aquí, vuelve la deriva silenciosa que este fichero existe para evitar.
    expect(album, "players-list.js no debe declarar ATRIBUTOS: se la pide a CopaCromo.").not.toMatch(
      /ATRIBUTOS\s*=\s*\[/
    );
    expect(miZona, "perfil.js no debe declarar ATRIBUTOS: se la pide a CopaCromo.").not.toMatch(/ATRIBUTOS\s*=\s*\[/);
  });
});
