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
 */

const raiz = path.resolve(import.meta.dirname, "../..");
const servidor = readFileSync(path.join(raiz, "functions/_lib/validacion.ts"), "utf8");
const cliente = readFileSync(path.join(raiz, "public/assets/team-form.js"), "utf8");

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
});

/*
 * Lo mismo con el álbum: players-list.js repite a mano la lista de métricas y la
 * de atributos porque tampoco puede importar del servidor. Si una crece y la
 * otra no, la ficha pública deja de pintar lo que la API devuelve.
 */

const estadisticasTs = readFileSync(path.join(raiz, "functions/_lib/estadisticas.ts"), "utf8");
const perfilTs = readFileSync(path.join(raiz, "functions/_lib/perfil.ts"), "utf8");
const album = readFileSync(path.join(raiz, "public/assets/players-list.js"), "utf8");
const miZona = readFileSync(path.join(raiz, "public/assets/perfil.js"), "utf8");

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

  it("comparte las claves de los atributos", () => {
    const enServidor = extraer(perfilTs, /ATRIBUTOS = \[([^\]]+)\]/)
      ?.split(",")
      .map((s) => s.trim().replace(/"/g, ""));
    const enAlbum = claves(album, /ATRIBUTOS = \[([\s\S]*?)\];/, "key");
    const enMiZona = claves(miZona, /ATRIBUTOS = \[([\s\S]*?)\];/, "key");

    expect(enServidor).not.toBeNull();
    expect(enAlbum, "players-list.js ha derivado de perfil.ts: los atributos ya no coinciden.").toEqual(enServidor);
    expect(enMiZona, "perfil.js ha derivado de perfil.ts: los atributos ya no coinciden.").toEqual(enServidor);
  });
});
