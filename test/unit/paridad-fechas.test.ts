import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Las fechas del torneo viven una sola vez, en `event.phases` de
 * src/data/event.ts. Casi todo deriva de ahí: el Hero, la portada,
 * /torneo/premios/, el JSON-LD y —desde este cambio— la descripción de
 * src/data/seo.ts, que es la que Google enseña.
 *
 * El correo de confirmación NO puede derivarlas. Vive en functions/, que nunca
 * importa de src/ (son dos objetivos de compilación distintos), así que lleva
 * las fechas escritas a mano. Es la misma situación que la validación de
 * cliente, y se cierra igual: comparando los literales.
 *
 * No es un detalle de estilo. Ese correo se manda a CADA equipo que se inscribe,
 * y durante meses anunció «del 31 de julio al 2 de agosto y fase final del 7 al
 * 9 de agosto» — fechas que ya no existían en ninguna otra parte del sitio ni en
 * el calendario real de `partidos`. Una copia a mano que nadie compara es una
 * copia que se queda vieja, y ésta se queda vieja delante de los participantes.
 */

const raiz = path.resolve(import.meta.dirname, "../..");
const eventTs = readFileSync(path.join(raiz, "src/data/event.ts"), "utf8");
const gmailTs = readFileSync(path.join(raiz, "functions/_lib/gmail.ts"), "utf8");

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

/** Las fases tal y como las declara event.ts, leídas del fichero como texto. */
function fasesDeEventTs(): { startISO: string; endISO: string }[] {
  const bloque = eventTs.match(/phases:\s*\[([\s\S]*?)\]/);
  if (!bloque) throw new Error("No encuentro `phases` en src/data/event.ts.");

  const fases = [...bloque[1]!.matchAll(
    /startISO:\s*"(\d{4}-\d{2}-\d{2})",\s*endISO:\s*"(\d{4}-\d{2}-\d{2})"/g
  )].map((m) => ({ startISO: m[1]!, endISO: m[2]! }));

  if (fases.length === 0) throw new Error("`phases` no declara ninguna fecha ISO.");
  return fases;
}

/** «del 1 al 3 de agosto» — el mismo formato que usa el correo. */
const rango = (fase: { startISO: string; endISO: string }): string => {
  const dia = (iso: string) => Number(iso.slice(8, 10));
  const mes = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
  return mes(fase.startISO) === mes(fase.endISO)
    ? `del ${dia(fase.startISO)} al ${dia(fase.endISO)} de ${mes(fase.endISO)}`
    : `del ${dia(fase.startISO)} de ${mes(fase.startISO)} al ${dia(fase.endISO)} de ${mes(fase.endISO)}`;
};

describe("las fechas del correo de confirmación siguen a event.phases", () => {
  it("event.ts declara las dos fases con sus fechas ISO", () => {
    const fases = fasesDeEventTs();
    expect(fases).toHaveLength(2);
  });

  it("el correo anuncia las fechas que declara event.ts", () => {
    const [grupos, final] = fasesDeEventTs();
    const esperado = `- Fechas: fase de grupos ${rango(grupos!)} y fase final ${rango(final!)}, en la Playa O Pozo (Porto do Son).`;

    expect(
      gmailTs,
      "functions/_lib/gmail.ts ha derivado de src/data/event.ts: el correo que reciben " +
        "los equipos anuncia unas fechas y el sitio otras.\n" +
        `Esperaba esta línea:\n${esperado}`
    ).toContain(esperado);
  });

  /*
   * El fallo que esto existe para impedir, escrito como test: que alguien mueva
   * el calendario en event.ts y el correo se quede con las fechas viejas.
   */
  it("detecta la deriva si event.ts cambia y el correo no", () => {
    const [grupos, final] = fasesDeEventTs();
    const otroCalendario = { startISO: "2027-07-15", endISO: "2027-07-17" };

    expect(rango(otroCalendario)).toBe("del 15 al 17 de julio");
    expect(gmailTs).not.toContain(rango(otroCalendario));
    // Y el de verdad sí está, para que el test anterior no pase por vacío.
    expect(gmailTs).toContain(rango(grupos!));
    expect(gmailTs).toContain(rango(final!));
  });

  /*
   * Un rango a caballo entre dos meses se escribe entero, porque «del 31 al 2 de
   * agosto» no dice nada. Es el caso que tuvo el torneo antes de moverse.
   */
  it("un rango entre dos meses nombra los dos", () => {
    expect(rango({ startISO: "2026-07-31", endISO: "2026-08-02" })).toBe(
      "del 31 de julio al 2 de agosto"
    );
  });
});
