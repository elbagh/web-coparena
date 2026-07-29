#!/usr/bin/env node
/*
 * Abre una rama y su worktree sin tocar el checkout principal.
 *
 *   npm run rama -- feature/mi-cosa
 *   npm run rama -- mi-cosa          (feature/ por defecto)
 *
 * Existe porque la receta a mano se escribía con `git checkout development &&
 * git pull` en el checkout principal, que es exactamente lo que se pisan dos
 * sesiones abiertas a la vez. Aquí la rama nace de `origin/development` y el
 * principal no se toca: ni checkout, ni pull, ni índice.
 *
 * Además reparte lo que también choca cuando hay varias sesiones: el par de
 * puertos de los servidores de desarrollo y el número de la próxima migración.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ambar,
  escribirSlots,
  existeRef,
  git,
  gitVisible,
  gris,
  leerSlots,
  listarWorktrees,
  morir,
  negrita,
  npmVisible,
  rutaPrincipal,
  verde
} from "./_lib/git.mjs";
import {
  duplicadosDeMigracion,
  normalizarRama,
  puertosDeSlot,
  siguienteNumeroMigracion,
  slotLibre
} from "./_lib/ramas.mjs";

const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("-"));

let destino;
try {
  destino = normalizarRama(argumentos[0]);
} catch (error) {
  morir(error.message, "Prefijos: feature, bugfix, release, hotfix.");
}

const { rama, nombreCorto, base } = destino;
const principal = rutaPrincipal();
const ruta = path.join(principal, ".worktrees", nombreCorto);

// --------------------------------------------------- antes de tocar nada ---

if (existeRef(`refs/heads/${rama}`)) {
  morir(
    `La rama ${rama} ya existe.`,
    "Si es trabajo tuyo de antes y no tiene worktree:",
    `git worktree add .worktrees/${nombreCorto} ${rama}`
  );
}
if (fs.existsSync(ruta)) {
  morir(
    `${path.relative(principal, ruta)} ya existe en disco.`,
    "Si no sale en `git worktree list`, es un directorio huérfano:",
    "npm run ramas:limpiar"
  );
}

console.log(`\n${negrita("1/4")} git fetch origin`);
if (!gitVisible(["fetch", "origin"], principal)) {
  console.log(`${ambar("!")} El fetch ha fallado; sigo con lo que haya en local.`);
}
if (!existeRef(base)) {
  morir(`No encuentro ${base}.`, "¿Está configurado el remoto «origin»? git remote -v");
}

// --------------------------------------------------------- el worktree ---

console.log(`\n${negrita("2/4")} git worktree add ${path.relative(principal, ruta)} -b ${rama} ${base}`);
if (!gitVisible(["worktree", "add", ruta, "-b", rama, base], principal)) {
  morir(
    "git no ha podido crear el worktree.",
    "Si dice «already used by worktree at …», otra sesión tiene esa rama abierta: no la fuerces."
  );
}

console.log(`\n${negrita("3/4")} npm install ${gris("(node_modules no viaja con un worktree)")}`);
if (!npmVisible(["install"], ruta)) {
  console.log(`${ambar("!")} El install ha fallado. Repítelo dentro del worktree antes de trabajar.`);
}

// ------------------------------------------- puertos y número de migración ---

console.log(`\n${negrita("4/4")} reparto de puertos y migración`);
const slots = leerSlots();
const vivos = new Set(listarWorktrees().map((wt) => wt.rama).filter(Boolean));
for (const clave of Object.keys(slots)) {
  if (!vivos.has(clave)) delete slots[clave]; // slot de un worktree que ya no está
}
const slot = slotLibre(Object.values(slots));
if (slot) {
  slots[rama] = slot;
  escribirSlots(slots);
}
const puertos = slot ? puertosDeSlot(slot) : null;

const migraciones = fs.existsSync(path.join(ruta, "db/migrations"))
  ? fs.readdirSync(path.join(ruta, "db/migrations"))
  : [];
const duplicados = duplicadosDeMigracion(migraciones);

console.log(`\n${verde("✓")} ${negrita(rama)} lista.\n`);
console.log(`  worktree   ${ruta}`);
console.log(`  base       ${base} (${git(["rev-parse", "--short", base])})`);
if (puertos) {
  console.log(`  slot ${slot}     npm run dev -- --port ${puertos.astro}`);
  console.log(`             npx wrangler dev --port ${puertos.worker}`);
} else {
  console.log(`  ${ambar("slot")}       sin slot libre: mira qué puertos escuchan antes de arrancar nada`);
}
console.log(`  migración  si añades una, te toca el ${negrita(siguienteNumeroMigracion(migraciones))}`);
if (duplicados.length) {
  const lista = duplicados.map((d) => `${d.numero} (${d.ficheros.join(", ")})`).join("; ");
  console.log(`  ${ambar("ojo")}        ya hay números repetidos en db/migrations: ${lista}`);
}
console.log(`\n${gris("Trabaja ahí dentro:")} cd ${path.relative(process.cwd(), ruta) || "."}`);
console.log(`${gris("Y para integrar, desde el worktree:")} npm run integrar -- -m "qué aporta"\n`);
