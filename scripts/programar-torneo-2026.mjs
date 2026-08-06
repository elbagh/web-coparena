/*
 * Genera el SQL de horarios y pista del torneo 2026.
 *
 * No inventa ids: los lee de la base, porque `generarLiga` y `generarCuadro`
 * crean los partidos con UUID. Asi el mismo fichero vale en local y en
 * produccion sin editar nada a mano, y se puede revisar antes de aplicarlo.
 *
 *   node scripts/programar-torneo-2026.mjs --local  > db/seeds/torneo-2026.sql
 *   node scripts/programar-torneo-2026.mjs --remote > db/seeds/torneo-2026.sql
 *   npx wrangler d1 execute DB --local --file db/seeds/torneo-2026.sql
 *
 * Los huecos salen de una sola pista y de empezar a las 16:30 (grupos) y a las
 * 17:00 (eliminatoria):
 *   - Grupos A, B y C: 6 partidos al mejor de 3 a 15 -> 50 min por hueco.
 *   - Eliminatoria: 4 partidos al mejor de 3 a 21/21/15 -> 60 min.
 * Ninguna tarde pasa de las 21:30.
 */
import { execSync } from "node:child_process";

const destino = process.argv.includes("--remote") ? "--remote" : "--local";
const PISTA = "Pista central";

/*
 * La consulta va en UNA linea y entre comillas dobles. Con execFileSync y
 * shell:true los argumentos no se citan, y wrangler recibia el SQL troceado en
 * palabras ("Unknown arguments: p.id, FROM, partidos"). Dentro del SQL solo se
 * usan comillas simples, asi que las dobles de fuera no chocan con nada.
 */
const consultar = (sql) => {
  const enUnaLinea = sql.replace(/\s+/g, " ").trim();
  const salida = execSync(
    `npx --no-install wrangler d1 execute DB ${destino} --json --command "${enUnaLinea}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  // wrangler puede colar avisos antes del JSON: se corta desde el primer corchete.
  const json = salida.slice(salida.indexOf("["));
  return JSON.parse(json)[0].results;
};

const TARDES = [
  { grupo: "A", fecha: "2026-08-01", inicio: "16:30", huecoMin: 50 },
  { grupo: "B", fecha: "2026-08-02", inicio: "16:30", huecoMin: 50 },
  { grupo: "C", fecha: "2026-08-06", inicio: "16:30", huecoMin: 50 }
];

const dosDigitos = (n) => String(n).padStart(2, "0");

const conHueco = (fecha, inicio, minutos, indice) => {
  const base = new Date(`${fecha}T${inicio}:00`);
  base.setMinutes(base.getMinutes() + minutos * indice);
  return `${fecha}T${dosDigitos(base.getHours())}:${dosDigitos(base.getMinutes())}`;
};

const lineas = [
  "-- Horarios y pista del torneo 2026. Generado por scripts/programar-torneo-2026.mjs.",
  "-- Una sola pista: los partidos van en serie, en el orden que dio el calendario.",
  "--",
  `-- GENERADO CONTRA: ${destino}  (${new Date().toISOString()})`,
  "-- Los ids son los de ESA base. Aplicarlo en otro entorno no da error: no",
  "-- coincide ningun id y no actualiza nada, que es peor que fallar. Regenera",
  "-- el fichero contra el entorno donde lo vayas a aplicar.",
  ""
];

let total = 0;

const emitir = (partidos, fecha, inicio, huecoMin, titulo) => {
  lineas.push(`-- ${titulo} — ${fecha}, ${partidos.length} partidos`);
  partidos.forEach((partido, indice) => {
    const cuando = conHueco(fecha, inicio, huecoMin, indice);
    lineas.push(`UPDATE partidos SET scheduled_at = '${cuando}', pista = '${PISTA}' WHERE id = '${partido.id}';`);
    total += 1;
  });
  lineas.push("");
};

for (const tarde of TARDES) {
  const partidos = consultar(
    `SELECT p.id FROM partidos p
       JOIN torneo_grupos g ON g.id = p.grupo_id
       JOIN torneo_fases f ON f.id = g.fase_id
      WHERE g.nombre = '${tarde.grupo}' AND f.clave = 'grupos'
      ORDER BY p.sort_order ASC`
  );
  emitir(partidos, tarde.fecha, tarde.inicio, tarde.huecoMin, `Grupo ${tarde.grupo}`);
}

/*
 * El cuadro. El domingo el orden importa y no es el de `posicion`: el partido
 * por el tercer puesto necesita las dos semifinales cerradas, y la final va la
 * ultima. Con una sola pista, ordenarlos asi ya lo garantiza.
 */
const cuadro = consultar(
  `SELECT p.id, p.ronda, p.ronda_orden, p.posicion FROM partidos p
     JOIN torneo_fases f ON f.id = p.fase_id
    WHERE f.clave = 'cuadro'
    ORDER BY p.ronda_orden ASC, p.posicion ASC`
);

emitir(
  cuadro.filter((p) => p.ronda_orden === 0),
  "2026-08-08",
  "17:00",
  60,
  "Cuartos de final"
);

const resto = cuadro.filter((p) => p.ronda_orden > 0);
emitir(
  [
    ...resto.filter((p) => p.ronda === "Semifinales"),
    ...resto.filter((p) => p.ronda === "Tercer puesto"),
    ...resto.filter((p) => p.ronda === "Final")
  ],
  "2026-08-09",
  "17:00",
  60,
  "Semifinales, tercer puesto y final"
);

lineas.push(`-- ${total} partidos con hora asignada.`);
console.log(lineas.join("\n"));
