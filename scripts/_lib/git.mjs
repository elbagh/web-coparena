/*
 * Lo impuro que comparten scripts/rama.mjs, scripts/integrar.mjs y
 * scripts/limpiar-ramas.mjs: hablar con git, con npm y con el disco. La lógica
 * que se puede probar sin nada de esto está en ./ramas.mjs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Sale por stdout, sin ruido. Lanza si git falla. */
export function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Para preguntas cuya respuesta puede ser «no»: no lanza, informa. */
export function gitPregunta(args, cwd) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd });
  return { ok: r.status === 0, salida: (r.stdout ?? "").trim(), error: (r.stderr ?? "").trim() };
}

/** Para lo que el humano tiene que ver mientras pasa (merge, push, fetch). */
export function gitVisible(args, cwd) {
  const r = spawnSync("git", args, { stdio: "inherit", cwd });
  return r.status === 0;
}

export function npmVisible(args, cwd) {
  // npm.cmd explícito en Windows en vez de shell: true, que con argumentos
  // sueltos los concatena sin escapar (DEP0190 en Node 22).
  const binario = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(binario, args, { stdio: "inherit", cwd });
  return r.status === 0;
}

/**
 * El primer `worktree` del porcelain es siempre el árbol de trabajo principal.
 * Todos los scripts lo necesitan porque los worktrees viven bajo él y porque
 * es el único sitio donde no se puede tocar nada.
 */
export function listarWorktrees() {
  const bloques = git(["worktree", "list", "--porcelain"]).split(/\n\s*\n/);
  return bloques.filter(Boolean).map((bloque, indice) => {
    const lineas = bloque.split("\n").map((l) => l.trim());
    const valor = (clave) => lineas.find((l) => l.startsWith(`${clave} `))?.slice(clave.length + 1);
    const ref = valor("branch");
    return {
      ruta: path.resolve(valor("worktree") ?? ""),
      head: valor("HEAD") ?? null,
      rama: ref ? ref.replace("refs/heads/", "") : null,
      desprendido: lineas.includes("detached"),
      bloqueado: lineas.some((l) => l === "locked" || l.startsWith("locked ")),
      esPrincipal: indice === 0
    };
  });
}

export function rutaPrincipal() {
  return listarWorktrees()[0].ruta;
}

export function rutaActual() {
  return path.resolve(git(["rev-parse", "--show-toplevel"]));
}

export function existeRef(ref) {
  return gitPregunta(["rev-parse", "--verify", "--quiet", ref]).ok;
}

export function esAncestro(a, b) {
  return gitPregunta(["merge-base", "--is-ancestor", a, b]).ok;
}

export function estaSucio(cwd) {
  return gitPregunta(["status", "--porcelain"], cwd).salida.length > 0;
}

/** Los ficheros de db/migrations tal como están en una rama, sin checkout. */
export function migracionesDe(ref) {
  const r = gitPregunta(["ls-tree", "--name-only", ref, "db/migrations/"]);
  return r.ok ? r.salida.split("\n").filter(Boolean).map((f) => path.basename(f)) : [];
}

// ------------------------------------------------------------------ slots ---

/**
 * El reparto de puertos vive dentro de .git (no en el árbol de trabajo, para
 * no salir en `git status` de ningún worktree) y es común a todos ellos.
 */
function ficheroSlots() {
  const comun = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return path.join(comun, "copa-slots.json");
}

export function leerSlots() {
  try {
    return JSON.parse(fs.readFileSync(ficheroSlots(), "utf8"));
  } catch {
    return {};
  }
}

export function escribirSlots(slots) {
  fs.writeFileSync(ficheroSlots(), `${JSON.stringify(slots, null, 2)}\n`, "utf8");
}

// ----------------------------------------------------------------- consola ---

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const ESC = String.fromCharCode(27);
const tinte = (codigo) => (texto) => (COLOR ? `${ESC}[${codigo}m${texto}${ESC}[0m` : texto);
export const negrita = tinte("1");
export const gris = tinte("90");
export const verde = tinte("32");
export const ambar = tinte("33");
export const rojo = tinte("31");

export function morir(mensaje, ...pistas) {
  console.error(`\n${rojo("✗")} ${mensaje}`);
  for (const pista of pistas) console.error(`  ${gris(pista)}`);
  console.error("");
  process.exit(1);
}
