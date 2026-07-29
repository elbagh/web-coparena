#!/usr/bin/env node
/*
 * Inventario y limpieza de lo que dejan varias sesiones trabajando en paralelo.
 *
 *   npm run ramas:limpiar                          (solo informa)
 *   npm run ramas:limpiar -- --aplicar             (retira worktrees y ramas)
 *   npm run ramas:limpiar -- --aplicar --huerfanos (borra también los directorios sin git)
 *   npm run ramas:limpiar -- --aplicar --remotas   (borra también la rama en origin)
 *
 * Informa por defecto porque un worktree de otra sesión puede estar vivo
 * aunque su rama ya esté mergeada, y porque nadie debería borrar el trabajo de
 * otro sin mirarlo. Lo que sí se hace siempre es `git worktree prune`, que solo
 * quita registros de directorios que ya no existen.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ambar,
  escribirSlots,
  esAncestro,
  estaSucio,
  existeRef,
  git,
  gitPregunta,
  gitVisible,
  gris,
  leerSlots,
  listarWorktrees,
  negrita,
  rutaActual,
  rutaPrincipal,
  verde
} from "./_lib/git.mjs";
import { PROTEGIDAS, clasificarWorktrees, mismaRuta, ramasBorrables, retirables } from "./_lib/ramas.mjs";

const argv = process.argv.slice(2);
const aplicar = argv.includes("--aplicar");
const conHuerfanos = argv.includes("--huerfanos");
const conRemotas = argv.includes("--remotas");

const principal = rutaPrincipal();
const actual = rutaActual();

gitPregunta(["worktree", "prune"], principal);
if (!gitVisible(["fetch", "origin", "--prune"], principal)) {
  console.log(`${ambar("!")} Sin fetch: lo que sigue se calcula con lo que hay en local.\n`);
}

const DEV = existeRef("origin/development") ? "origin/development" : "development";
const MAIN = existeRef("origin/main") ? "origin/main" : "main";

// ----------------------------------------------------------- inventario ---

const worktrees = listarWorktrees().map((wt) => {
  const enSincronia = wt.rama
    ? existeRef(`origin/${wt.rama}`) &&
      git(["rev-parse", wt.rama]) === git(["rev-parse", `origin/${wt.rama}`])
    : esAncestro(wt.head, MAIN);
  return {
    ...wt,
    esActual: mismaRuta(wt.ruta, actual),
    sucio: estaSucio(wt.ruta),
    integrada: esAncestro(wt.rama ?? wt.head, DEV),
    enSincronia
  };
});

const { retirables: aRetirar, retenidas } = retirables(worktrees);

const registrados = worktrees.map((wt) => wt.ruta);
const enDisco = [path.join(principal, ".worktrees"), path.join(principal, ".claude", "worktrees")]
  .filter((dir) => fs.existsSync(dir))
  .flatMap((dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
  );
const { huerfanos } = clasificarWorktrees({ registrados, enDisco });

const ramasLocales = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  .split("\n")
  .filter(Boolean)
  .map((nombre) => ({
    nombre,
    integrada: esAncestro(nombre, DEV),
    enMain: esAncestro(nombre, MAIN)
  }));
const borrables = ramasBorrables({
  ramas: ramasLocales,
  conWorktree: worktrees.map((wt) => wt.rama).filter(Boolean),
  actual: worktrees.find((wt) => wt.esActual)?.rama ?? null
});
const soloEnMain = ramasLocales
  .filter((r) => !r.integrada && r.enMain && !PROTEGIDAS.includes(r.nombre))
  .map((r) => r.nombre);

// ------------------------------------------------------------- informe ---

const rel = (ruta) => path.relative(principal, ruta).replace(/\\/g, "/") || ".";

console.log(negrita("\nWorktrees"));
for (const wt of retenidas) {
  console.log(`  ${gris("·")} ${rel(wt.ruta)} ${gris(`[${wt.rama ?? wt.head?.slice(0, 7)}] — ${wt.motivo}`)}`);
}
for (const wt of aRetirar) {
  console.log(`  ${ambar("→")} ${rel(wt.ruta)} ${gris(`[${wt.rama ?? wt.head?.slice(0, 7)}] — retirable`)}`);
}
if (!worktrees.length) console.log(`  ${gris("ninguno")}`);

if (huerfanos.length) {
  console.log(negrita("\nDirectorios que no son worktrees"));
  console.log(
    `  ${gris("git no los conoce: cualquier orden lanzada ahí opera sobre el checkout principal.")}`
  );
  for (const ruta of huerfanos) console.log(`  ${ambar("→")} ${rel(ruta)}`);
}

if (borrables.length) {
  console.log(negrita("\nRamas locales ya integradas en development y sin worktree"));
  console.log(`  ${borrables.join("\n  ")}`);
}
if (soloEnMain.length) {
  console.log(negrita("\nRamas integradas en main pero no en development"));
  console.log(`  ${gris("no las borro yo: `git branch -d` las rechaza y `-D` es tu decisión.")}`);
  console.log(`  ${soloEnMain.join("\n  ")}`);
}

if (!aplicar) {
  const pendiente = aRetirar.length + borrables.length + (conHuerfanos ? huerfanos.length : 0);
  console.log(
    pendiente
      ? `\n${gris("Nada tocado. Para hacerlo:")} npm run ramas:limpiar -- --aplicar\n`
      : `\n${verde("✓")} Nada que limpiar.\n`
  );
  process.exit(0);
}

// ------------------------------------------------------------- aplicar ---

const slots = leerSlots();
console.log(negrita("\nAplicando"));

for (const wt of aRetirar) {
  const quitado = gitPregunta(["worktree", "remove", wt.ruta], principal);
  if (!quitado.ok) {
    console.log(`  ${ambar("!")} ${rel(wt.ruta)}: ${quitado.error.split("\n")[0]}`);
    continue;
  }
  console.log(`  ${verde("✓")} worktree ${rel(wt.ruta)}`);
  if (wt.rama) delete slots[wt.rama];
}
gitPregunta(["worktree", "prune"], principal);

for (const rama of ramasBorrables({
  ramas: ramasLocales,
  conWorktree: listarWorktrees().map((wt) => wt.rama).filter(Boolean),
  actual: worktrees.find((wt) => wt.esActual)?.rama ?? null
})) {
  const borrada = gitPregunta(["branch", "-d", rama], principal);
  console.log(
    borrada.ok
      ? `  ${verde("✓")} rama ${rama}`
      : `  ${ambar("!")} rama ${rama}: ${borrada.error.split("\n")[0]}`
  );
  if (borrada.ok) delete slots[rama];
  if (borrada.ok && conRemotas && existeRef(`refs/remotes/origin/${rama}`)) {
    const remota = gitPregunta(["push", "origin", "--delete", rama], principal);
    console.log(remota.ok ? `  ${verde("✓")} origin/${rama}` : `  ${ambar("!")} origin/${rama}`);
  }
}

if (conHuerfanos) {
  for (const ruta of huerfanos) {
    fs.rmSync(ruta, { recursive: true, force: true });
    console.log(`  ${verde("✓")} directorio ${rel(ruta)}`);
  }
} else if (huerfanos.length) {
  console.log(`  ${gris("los directorios huérfanos siguen ahí; añade --huerfanos para borrarlos.")}`);
}

escribirSlots(slots);
console.log("");
