#!/usr/bin/env node
/*
 * Publica la rama del worktree actual en `development` sin que `development`
 * esté hecho checkout en ningún sitio.
 *
 *   npm run integrar -- -m "qué aporta la rama"
 *   npm run integrar -- --sin-verificar     (solo si acabas de pasar verify)
 *
 * Los conflictos se resuelven donde son tuyos (tu worktree, mergeando
 * origin/development hacia dentro) y verify se pasa **después** de ese merge.
 * El commit de merge se hace luego en un worktree desprendido: al no reclamar
 * la rama, no choca con el checkout principal, que sigue en `development` y
 * sigue siendo de nadie.
 *
 * Si otra sesión integra mientras corría verify, el push sale rechazado por
 * non-fast-forward y el ciclo se repite entero — volver a mergear y volver a
 * verificar — porque publicar una combinación que nadie verificó es justo lo
 * que esto viene a evitar. Nunca hay `push --force`.
 */
import path from "node:path";
import {
  ambar,
  escribirSlots,
  estaSucio,
  git,
  gitPregunta,
  gitVisible,
  gris,
  leerSlots,
  migracionesDe,
  morir,
  negrita,
  npmVisible,
  rutaActual,
  rutaPrincipal,
  verde
} from "./_lib/git.mjs";
import { PROTEGIDAS, colisionesDeMigracion } from "./_lib/ramas.mjs";

const CICLOS_MAX = 2;
const argv = process.argv.slice(2);
const bandera = (nombre) => argv.includes(nombre);
const valor = (...alias) => {
  const i = argv.findIndex((a) => alias.includes(a));
  return i >= 0 ? argv[i + 1] : undefined;
};

const worktree = rutaActual();
const principal = rutaPrincipal();
const rama = git(["rev-parse", "--abbrev-ref", "HEAD"], worktree);
const nombreCorto = rama.split("/").pop();
const tmp = path.join(principal, ".worktrees", `_merge-${nombreCorto}`);

// --------------------------------------------------- antes de tocar nada ---

if (worktree === principal) {
  morir(
    "Estás en el checkout principal, y ahí no se integra nada.",
    "Trabaja en tu worktree: npm run rama -- feature/mi-cosa"
  );
}
if (rama === "HEAD" || PROTEGIDAS.includes(rama)) {
  morir(`HEAD está en «${rama}»: esto se lanza desde una rama de trabajo.`);
}
if (estaSucio(worktree)) {
  morir("Tienes cambios sin commitear.", "Commitea (o guarda) antes de integrar: git status");
}

const mensajeDado = valor("-m", "--mensaje");
const descripcion = mensajeDado ?? git(["log", "-1", "--pretty=%s", rama], worktree);
const mensajeMerge = `Merge ${rama} into development: ${descripcion}`;
const sinVerificar = bandera("--sin-verificar");

console.log(`\n${negrita(rama)} → development`);
console.log(`${gris("mensaje:")} ${mensajeMerge}\n`);

// ------------------------------------------------------------- el ciclo ---

function limpiarTmp() {
  if (gitPregunta(["worktree", "remove", "--force", tmp], principal).ok) return;
  gitPregunta(["worktree", "prune"], principal);
}

/** Devuelve "ok", "rechazado" (otra sesión llegó antes) o mata el proceso. */
function ciclo(numero) {
  console.log(`${negrita(`Ciclo ${numero}`)} ${gris("fetch → merge → verify → push")}`);

  if (!gitVisible(["fetch", "origin"], worktree)) {
    morir("No he podido hacer fetch de origin.", "Sin remoto no se puede integrar sin pisar a nadie.");
  }

  // El número de migración se comprueba ANTES del merge: después los dos
  // ficheros conviven y el duplicado ya está dentro (pasó con 0003 y con 0022).
  const choques = colisionesDeMigracion(migracionesDe(rama), migracionesDe("origin/development"));
  if (choques.length) {
    morir(
      "Choque de números de migración con development:",
      ...choques.map((c) => `${c.numero}: tú ${c.mias.join(", ")} — development ${c.otras.join(", ")}`),
      "Renumera la tuya (nunca la que ya está en development) y vuelve a lanzarlo."
    );
  }

  if (!gitVisible(["merge", "origin/development"], worktree)) {
    morir(
      "El merge de origin/development ha dado conflictos.",
      "Resuélvelos aquí, en tu worktree — es donde son tuyos — y vuelve a lanzarlo.",
      "Para deshacerlo: git merge --abort"
    );
  }

  if (sinVerificar) {
    console.log(`\n${ambar("!")} Saltando npm run verify por --sin-verificar.\n`);
  } else {
    console.log(`\n${gris("npm run verify (build + tipos + los tres proyectos de test)")}\n`);
    if (!npmVisible(["run", "verify"], worktree)) {
      morir("verify no está verde. No se integra nada rojo.");
    }
  }

  if (!gitVisible(["push", "-u", "origin", rama], worktree)) {
    morir(`No he podido subir ${rama} a origin.`);
  }

  limpiarTmp();
  if (!gitVisible(["worktree", "add", "--detach", tmp, "origin/development"], principal)) {
    morir("No he podido crear el worktree desprendido para el merge.");
  }

  if (!gitVisible(["-C", tmp, "merge", "--no-ff", rama, "-m", mensajeMerge], principal)) {
    limpiarTmp();
    morir(
      "El merge sobre development ha dado conflictos, lo que significa que development se ha movido.",
      "Vuelve a lanzar `npm run integrar`: reintegra y vuelve a verificar."
    );
  }

  if (gitVisible(["-C", tmp, "push", "origin", "HEAD:development"], principal)) {
    limpiarTmp();
    return "ok";
  }

  limpiarTmp();
  return "rechazado";
}

let resultado = "rechazado";
for (let numero = 1; numero <= CICLOS_MAX && resultado === "rechazado"; numero += 1) {
  resultado = ciclo(numero);
  if (resultado === "rechazado") {
    console.log(
      `\n${ambar("!")} Push rechazado: otra sesión ha integrado mientras verificábamos.` +
        `${numero < CICLOS_MAX ? " Repito el ciclo entero.\n" : "\n"}`
    );
  }
}
if (resultado !== "ok") {
  morir(
    `Sigue habiendo carrera después de ${CICLOS_MAX} ciclos.`,
    "Espera a que la otra sesión termine y vuelve a lanzarlo. Nunca con --force."
  );
}

// -------------------------------------------------------------- después ---

// La única orden permitida en el checkout principal: no puede perder nada
// (árbol limpio, solo fast-forward) y deja su vista al día.
if (!gitVisible(["-C", principal, "pull", "--ff-only"], principal)) {
  console.log(`${ambar("!")} El checkout principal no ha podido adelantarse; no es grave, es solo su vista.`);
}

const slots = leerSlots();
if (slots[rama]) {
  delete slots[rama];
  escribirSlots(slots);
}

console.log(`\n${verde("✓")} ${rama} está en development.\n`);
console.log(`  ${gris("cuando termines con el worktree:")} npm run ramas:limpiar -- --aplicar`);
if (rama.startsWith("hotfix/")) {
  console.log(`  ${ambar("hotfix:")} esto solo ha entrado en development. main sigue sin el parche.`);
}
console.log(`  ${gris("promover a main es otra cosa, y se pregunta antes.")}\n`);
