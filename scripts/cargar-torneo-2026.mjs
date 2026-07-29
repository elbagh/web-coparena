/*
 * Genera el SQL que deja programado el torneo 2026: fase de grupos con sus tres
 * grupos, el calendario de los 22 partidos, la fase eliminatoria con su cuadro
 * de ocho, y los horarios de las cinco tardes.
 *
 * Lee los ids reales de los equipos de la base a la que apunte, para no
 * inventarlos ni depender del orden de inscripcion.
 *
 *   node scripts/cargar-torneo-2026.mjs --remote > /tmp/torneo.sql
 *   npx wrangler d1 execute DB --remote --file /tmp/torneo.sql
 *
 * El calendario usa el mismo metodo del circulo que `calendarioLiga` en
 * functions/_lib/torneo.ts: uno fijo y los demas rotan. Se replica aqui porque
 * los endpoints de admin necesitan una sesion firmada con el SESSION_SECRET de
 * produccion, que no esta disponible desde fuera del worker.
 * test/integration/torneo-2026.test.ts prueba el mismo montaje contra los
 * endpoints de verdad y da los mismos 6 + 6 + 10.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const destino = process.argv.includes("--remote") ? "--remote" : "--local";
const PISTA = "Pista central";

const consultar = (sql) => {
  const enUnaLinea = sql.replace(/\s+/g, " ").trim();
  const salida = execSync(
    `npx --no-install wrangler d1 execute DB ${destino} --json --command "${enUnaLinea}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(salida.slice(salida.indexOf("[")))[0].results;
};

// --------------------------------------------------------------- reglas ---

const REGLAS_FASE = {
  partido: { sets: 2, puntosPorSet: 15, puntosSetDecisivo: 15, diferencia: 2 },
  clasificacion: {
    puntosVictoria: 3,
    puntosDerrota: 0,
    puntosVictoriaAjustada: 2,
    puntosDerrotaAjustada: 1,
    desempates: ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"]
  }
};

/*
 * El grupo de cinco juega a un set, y con `sets: 1` TODO partido cuenta como
 * resuelto en el set decisivo (setsMaximos vale 1). Sin igualar los valores
 * ajustados a los normales, cada victoria valdria 2 y cada derrota 1 en vez de
 * 3 y 0.
 */
const REGLAS_GRUPO_C = {
  partido: { sets: 1, puntosPorSet: 21, puntosSetDecisivo: 21, diferencia: 2 },
  clasificacion: {
    puntosVictoria: 3,
    puntosDerrota: 0,
    puntosVictoriaAjustada: 3,
    puntosDerrotaAjustada: 0,
    desempates: ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"]
  }
};

const REGLAS_CUADRO = {
  partido: { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 },
  clasificacion: REGLAS_FASE.clasificacion
};

// --------------------------------------------------------------- sorteo ---

const GRUPOS = [
  {
    nombre: "A",
    orden: 0,
    clasifican: null,
    enRepesca: 1,
    reglas: null,
    fecha: "2026-08-01",
    inicio: "16:30",
    huecoMin: 50,
    equipos: ["Calvos de Orion", "Bye Bye Bye", "Free Copa Arena", "Croquetillas de Arena"]
  },
  {
    nombre: "B",
    orden: 1,
    clasifican: null,
    enRepesca: 1,
    reglas: null,
    fecha: "2026-08-02",
    inicio: "16:30",
    huecoMin: 50,
    equipos: ["Limens", "Los Julais", "Segarro", "Deportivo A Silva"]
  },
  {
    nombre: "C",
    orden: 2,
    clasifican: 3,
    enRepesca: 0,
    reglas: REGLAS_GRUPO_C,
    fecha: "2026-08-03",
    inicio: "16:30",
    huecoMin: 30,
    equipos: ["Showtime", "Dosilva", "Kylian dictador", "ONDA BRAVA", "Alejo Mouris"]
  }
];

// ------------------------------------------------------------ utilidades ---

const esc = (s) => String(s).replace(/'/g, "''");
const dosDigitos = (n) => String(n).padStart(2, "0");

const conHueco = (fecha, inicio, minutos, indice) => {
  const base = new Date(`${fecha}T${inicio}:00`);
  base.setMinutes(base.getMinutes() + minutos * indice);
  return `${fecha}T${dosDigitos(base.getHours())}:${dosDigitos(base.getMinutes())}`;
};

/** Todos contra todos por el metodo del circulo. Reparte los descansos. */
function calendarioLiga(indices) {
  const lista = [...indices];
  if (lista.length < 2) return [];
  if (lista.length % 2 === 1) lista.push(null);
  const n = lista.length;
  const fijo = lista[0];
  const rotan = lista.slice(1);
  const cruces = [];
  for (let jornada = 0; jornada < n - 1; jornada += 1) {
    const ronda = [fijo, ...rotan];
    for (let i = 0; i < n / 2; i += 1) {
      const a = ronda[i];
      const b = ronda[n - 1 - i];
      if (a !== null && b !== null) cruces.push({ jornada: jornada + 1, a, b });
    }
    rotan.unshift(rotan.pop());
  }
  return cruces;
}

// ------------------------------------------------------------------ ids ---

const edicion = consultar("SELECT id FROM ediciones WHERE es_actual = 1")[0];
if (!edicion) throw new Error("No hay ninguna edicion en juego.");

const equipos = consultar(
  `SELECT id, nombre FROM equipos WHERE edicion_id = ${edicion.id}`
);
const idDe = new Map(equipos.map((e) => [e.nombre, e.id]));

for (const grupo of GRUPOS) {
  for (const nombre of grupo.equipos) {
    if (!idDe.has(nombre)) throw new Error(`No existe el equipo «${nombre}» en la edicion actual.`);
  }
}
const enElSorteo = GRUPOS.flatMap((g) => g.equipos);
if (enElSorteo.length !== equipos.length) {
  throw new Error(`El sorteo tiene ${enElSorteo.length} equipos y la edicion ${equipos.length}.`);
}

// ------------------------------------------------------------------ SQL ---

const out = [
  "-- Torneo 2026: fase de grupos, calendario, cuadro de ocho y horarios.",
  "-- Generado por scripts/cargar-torneo-2026.mjs. Los ids de equipo son los de",
  `-- la base ${destino}; no reutilizar este fichero en otro entorno.`,
  ""
];

const FASE_GRUPOS = 1;
const FASE_CUADRO = 2;

out.push(
  `INSERT INTO torneo_fases (id, edicion_id, clave, nombre, tipo, orden, reglas, clasifican, repesca)`,
  `VALUES (${FASE_GRUPOS}, ${edicion.id}, 'grupos', 'Fase de grupos', 'grupos', 0, '${esc(JSON.stringify(REGLAS_FASE))}', 2, 1);`,
  ""
);

let grupoId = 0;
let sortOrder = 0;

for (const grupo of GRUPOS) {
  grupoId += 1;
  const reglasCol = grupo.reglas === null ? "NULL" : `'${esc(JSON.stringify(grupo.reglas))}'`;
  const cupoCol = grupo.clasifican === null ? "NULL" : String(grupo.clasifican);

  out.push(`-- Grupo ${grupo.nombre} — ${grupo.fecha}`);
  out.push(
    `INSERT INTO torneo_grupos (id, fase_id, nombre, orden, reglas, clasifican, en_repesca) ` +
      `VALUES (${grupoId}, ${FASE_GRUPOS}, '${esc(grupo.nombre)}', ${grupo.orden}, ${reglasCol}, ${cupoCol}, ${grupo.enRepesca});`
  );
  grupo.equipos.forEach((nombre, i) => {
    out.push(
      `INSERT INTO torneo_grupo_equipos (grupo_id, fase_id, equipo_id, orden) ` +
        `VALUES (${grupoId}, ${FASE_GRUPOS}, ${idDe.get(nombre)}, ${i});`
    );
  });

  const reglasPartido = JSON.stringify(grupo.reglas ?? REGLAS_FASE);
  const cruces = calendarioLiga(grupo.equipos.map((_, i) => i));

  cruces.forEach((cruce, indice) => {
    const a = grupo.equipos[cruce.a];
    const b = grupo.equipos[cruce.b];
    out.push(
      `INSERT INTO partidos (id, ronda, equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre, ` +
        `scheduled_at, pista, status, sort_order, edicion_id, fase_id, grupo_id, reglas, ` +
        `origen_equipo_a, origen_equipo_b) VALUES ('${randomUUID()}', ` +
        `'${esc(grupo.nombre)} · jornada ${cruce.jornada}', ${idDe.get(a)}, ${idDe.get(b)}, ` +
        `'${esc(a)}', '${esc(b)}', '${conHueco(grupo.fecha, grupo.inicio, grupo.huecoMin, indice)}', ` +
        `'${esc(PISTA)}', 'scheduled', ${sortOrder}, ${edicion.id}, ${FASE_GRUPOS}, ${grupoId}, ` +
        `'${esc(reglasPartido)}', 'sorteo', 'sorteo');`
    );
    sortOrder += 1;
  });
  out.push("");
}

// El cuadro. Se inserta la ULTIMA ronda primero: siguiente_partido_id es una
// clave ajena a la propia tabla y una semifinal no puede apuntar a una final
// que todavia no existe.
out.push(
  `INSERT INTO torneo_fases (id, edicion_id, clave, nombre, tipo, orden, reglas, clasifican, repesca)`,
  `VALUES (${FASE_CUADRO}, ${edicion.id}, 'cuadro', 'Eliminatoria', 'eliminatoria', 1, '${esc(JSON.stringify(REGLAS_CUADRO))}', 0, 0);`,
  ""
);

const idFinal = randomUUID();
const idTercero = randomUUID();
const idSemis = [randomUUID(), randomUUID()];
const idCuartos = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

const hueco = (partido) =>
  `'${conHueco(partido.fecha, "17:00", 60, partido.indice)}', '${esc(PISTA)}'`;

const insertarCuadro = (id, ronda, rondaOrden, posicion, sort, siguiente, slot, perdedor, slotPerdedor, cuando) =>
  `INSERT INTO partidos (id, ronda, equipo_a_nombre, equipo_b_nombre, scheduled_at, pista, status, ` +
  `sort_order, edicion_id, fase_id, ronda_orden, posicion, siguiente_partido_id, siguiente_slot, ` +
  `perdedor_partido_id, perdedor_slot, reglas, origen_equipo_a, origen_equipo_b) VALUES ` +
  `('${id}', '${esc(ronda)}', '', '', ${cuando}, 'scheduled', ${sort}, ${edicion.id}, ${FASE_CUADRO}, ` +
  `${rondaOrden}, ${posicion}, ${siguiente ? `'${siguiente}'` : "NULL"}, ${slot ? `'${slot}'` : "NULL"}, ` +
  `${perdedor ? `'${perdedor}'` : "NULL"}, ${slotPerdedor ? `'${slotPerdedor}'` : "NULL"}, ` +
  `'${esc(JSON.stringify(REGLAS_CUADRO))}', 'progresion', 'progresion');`;

out.push("-- Domingo 09/08: dos semis, tercer puesto y final, en ese orden.");
// sort_order sigue el orden de plantillaCuadro: cuartos 0-3, semis 4-5, final 6, 3.er puesto 7.
out.push(insertarCuadro(idFinal, "Final", 2, 0, 6, null, null, null, null, hueco({ fecha: "2026-08-09", indice: 3 })));
out.push(insertarCuadro(idTercero, "Tercer puesto", 2, 1, 7, null, null, null, null, hueco({ fecha: "2026-08-09", indice: 2 })));
idSemis.forEach((id, p) =>
  out.push(
    insertarCuadro(id, "Semifinales", 1, p, 4 + p, idFinal, p === 0 ? "A" : "B", idTercero, p === 0 ? "A" : "B",
      hueco({ fecha: "2026-08-09", indice: p }))
  )
);

out.push("", "-- Sabado 08/08: los cuatro cuartos.");
idCuartos.forEach((id, p) =>
  out.push(
    insertarCuadro(id, "Cuartos de final", 0, p, p, idSemis[Math.floor(p / 2)], p % 2 === 0 ? "A" : "B", null, null,
      hueco({ fecha: "2026-08-08", indice: p }))
  )
);

out.push("", `-- ${sortOrder} partidos de grupos + 8 de cuadro = ${sortOrder + 8}.`);
console.log(out.join("\n"));
