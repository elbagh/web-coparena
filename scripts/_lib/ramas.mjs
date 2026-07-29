/*
 * Lógica pura del trabajo en paralelo: varias sesiones (o varias terminales)
 * abiertas a la vez sobre este repo, cada una en su worktree.
 *
 * Vive aparte de los scripts que la usan para que
 * test/unit/ramas-paralelas.test.ts pueda probarla sin tocar git ni el disco:
 * todo lo de aquí recibe datos y devuelve datos. Los scripts se quedan con lo
 * que no se puede probar así — llamar a git, instalar, borrar.
 */
import path from "node:path";

export const PREFIJOS = ["feature", "bugfix", "release", "hotfix"];
export const PROTEGIDAS = ["main", "development"];

/**
 * El slot 0 es el checkout principal: es el par de puertos que fija
 * .claude/launch.json, y el pane de preview lee ese fichero y no el del
 * worktree. Cada worktree se queda con un slot ≥ 1 para no chocar con él.
 */
export const PUERTOS_BASE = { astro: 4321, worker: 8788 };
export const SALTO_PUERTOS = 10;
export const SLOTS_MAX = 8;

/** Un nombre corto es un segmento: sin barras, sin espacios, sin mayúsculas. */
const NOMBRE_VALIDO = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Acepta `feature/mi-cosa` o `mi-cosa` (feature/ por defecto) y devuelve todo
 * lo que hace falta para crear el worktree. La base sale del prefijo: un
 * hotfix parchea producción, así que nace de `main`; todo lo demás de
 * `development`.
 */
export function normalizarRama(entrada) {
  const limpio = String(entrada ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!limpio) throw new Error("Falta el nombre de la rama: npm run rama -- feature/mi-cosa");

  const partes = limpio.split("/");
  if (partes.length > 2) {
    throw new Error(`«${limpio}» tiene barras de más: usa <prefijo>/<nombre-corto>.`);
  }

  const prefijo = partes.length === 2 ? partes[0] : "feature";
  const nombreCorto = partes.length === 2 ? partes[1] : partes[0];

  if (!PREFIJOS.includes(prefijo)) {
    throw new Error(`Prefijo «${prefijo}» desconocido. Usa uno de: ${PREFIJOS.join(", ")}.`);
  }
  if (!NOMBRE_VALIDO.test(nombreCorto)) {
    throw new Error(
      `«${nombreCorto}» no vale como nombre corto: minúsculas, números, punto, guion y guion bajo.`
    );
  }

  return {
    rama: `${prefijo}/${nombreCorto}`,
    prefijo,
    nombreCorto,
    base: prefijo === "hotfix" ? "origin/main" : "origin/development"
  };
}

// ------------------------------------------------------------ migraciones ---

/** Agrupa `0022_algo.sql` por su número: Map("0022" → ["0022_algo.sql", …]). */
export function migracionesPorNumero(nombres) {
  const porNumero = new Map();
  for (const nombre of nombres) {
    const numero = /^(\d{4})_/.exec(path.basename(nombre))?.[1];
    if (!numero) continue;
    if (!porNumero.has(numero)) porNumero.set(numero, []);
    porNumero.get(numero).push(path.basename(nombre));
  }
  return porNumero;
}

/**
 * Dos migraciones con el mismo número es el accidente clásico de trabajar en
 * paralelo: dos sesiones cogen «el siguiente» a la vez. Ya pasó dos veces aquí
 * (0003 y 0022), y el orden de aplicación es la diferencia entre desplegar y
 * tirar el login.
 */
export function duplicadosDeMigracion(nombres) {
  return [...migracionesPorNumero(nombres)]
    .filter(([, ficheros]) => ficheros.length > 1)
    .map(([numero, ficheros]) => ({ numero, ficheros: [...ficheros].sort() }))
    .sort((a, b) => a.numero.localeCompare(b.numero));
}

export function siguienteNumeroMigracion(nombres) {
  const numeros = [...migracionesPorNumero(nombres).keys()].map(Number);
  const siguiente = numeros.length ? Math.max(...numeros) + 1 : 1;
  return String(siguiente).padStart(4, "0");
}

/**
 * Choques entre lo que trae mi rama y lo que ya hay en development: mismo
 * número, fichero distinto. El nombre idéntico no cuenta — esa migración es la
 * misma en los dos lados. Se comprueba **antes** de mergear, porque después
 * los dos ficheros conviven y el número duplicado ya está dentro.
 */
export function colisionesDeMigracion(mias, suyas) {
  const suyasPorNumero = migracionesPorNumero(suyas);
  const choques = [];
  for (const [numero, ficheros] of migracionesPorNumero(mias)) {
    const otras = (suyasPorNumero.get(numero) ?? []).filter((f) => !ficheros.includes(f));
    if (otras.length) choques.push({ numero, mias: [...ficheros].sort(), otras: [...otras].sort() });
  }
  return choques.sort((a, b) => a.numero.localeCompare(b.numero));
}

// ---------------------------------------------------------------- puertos ---

export function puertosDeSlot(slot) {
  return {
    astro: PUERTOS_BASE.astro + SALTO_PUERTOS * slot,
    worker: PUERTOS_BASE.worker + SALTO_PUERTOS * slot
  };
}

/** El menor slot ≥ 1 que no tenga ya dueño, o null si están todos cogidos. */
export function slotLibre(ocupados) {
  const tomados = new Set(ocupados.map(Number));
  for (let slot = 1; slot <= SLOTS_MAX; slot += 1) {
    if (!tomados.has(slot)) return slot;
  }
  return null;
}

// -------------------------------------------------------------- worktrees ---

/** Windows: rutas insensibles a mayúsculas y con las dos barras mezcladas. */
export function mismaRuta(a, b) {
  const normal = (r) => path.resolve(String(r)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normal(a) === normal(b);
}

/**
 * Un directorio dentro de .worktrees/ que git no reconoce **no es un
 * worktree**: es lo que queda cuando alguien lo borra con `rm -rf` en vez de
 * `git worktree remove`. Sin el fichero `.git` que lo apunta, cualquier
 * comando de git lanzado ahí sube por el árbol y opera sobre el checkout
 * principal — una sesión creyéndose aislada, escribiendo justo donde no debe.
 */
export function clasificarWorktrees({ registrados, enDisco }) {
  const worktrees = [];
  const huerfanos = [];
  for (const ruta of enDisco) {
    if (registrados.some((registrado) => mismaRuta(registrado, ruta))) worktrees.push(ruta);
    else huerfanos.push(ruta);
  }
  return { worktrees, huerfanos };
}

/**
 * Decide qué worktrees se pueden retirar. `integrada` = su rama ya está en
 * development; `enSincronia` = coincide con su rama remota (es el caso de un
 * `.worktrees/promote-main` olvidado: no está «integrado» en development y sin
 * embargo no tiene nada que perder).
 *
 * Nunca se retira el checkout principal, ni el worktree desde el que se está
 * trabajando, ni uno con cambios sin commitear. Y un worktree de otra sesión
 * puede estar vivo aunque su rama ya esté mergeada: por eso el script informa
 * y solo actúa con `--aplicar`.
 */
export function retirables(worktrees) {
  const aRetirar = [];
  const retenidas = [];
  for (const wt of worktrees) {
    const motivo = wt.esPrincipal
      ? "es el checkout principal"
      : wt.esActual
        ? "es el worktree desde el que estás trabajando"
        : wt.bloqueado
          ? "está bloqueado (git worktree lock)"
          : wt.sucio
            ? "tiene cambios sin commitear"
            : !wt.integrada && !wt.enSincronia
              ? "su rama no está integrada en development"
              : null;
    if (motivo) retenidas.push({ ...wt, motivo });
    else aRetirar.push(wt);
  }
  return { retirables: aRetirar, retenidas };
}

/**
 * Ramas locales ya integradas y sin worktree que las sostenga. `main` y
 * `development` no se borran nunca, y tampoco la rama en la que estás.
 */
export function ramasBorrables({ ramas, conWorktree, actual }) {
  const ocupadas = new Set(conWorktree);
  return ramas
    .filter((rama) => rama.integrada)
    .map((rama) => rama.nombre)
    .filter((nombre) => !PROTEGIDAS.includes(nombre) && !ocupadas.has(nombre) && nombre !== actual)
    .sort();
}
