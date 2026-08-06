import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { avisoTorneo } from "../../src/data/event";

/*
 * El aviso de /torneo/ que explica por qué la tabla de un grupo no se lee como
 * de costumbre.
 *
 * Va en el marcado estático del .astro y no en torneo-page.js a propósito: el
 * aviso explica una tabla que pinta JavaScript desde /api/torneo, así que si se
 * mudara al script desaparecería exactamente cuando la API falla y no hay
 * tabla ninguna — el momento en el que alguien más lo necesita. Este test lee
 * el fichero para que no se pueda mudar sin enterarse.
 */

const PAGINA = readFileSync(path.join(process.cwd(), "src/pages/torneo/index.astro"), "utf8");
const SCRIPT = readFileSync(path.join(process.cwd(), "public/assets/torneo-page.js"), "utf8");

describe("el aviso de /torneo/", () => {
  it("vive en el marcado de la página, no en su script", () => {
    expect(PAGINA).toContain("torneo-aviso");
    expect(PAGINA).toContain("avisoTorneo");
    expect(SCRIPT).not.toContain("torneo-aviso");
  });

  it("saca el texto de event.ts y no lo repite escrito en la página", () => {
    expect(PAGINA).toContain('from "../../data/event"');
    expect(PAGINA).not.toContain(avisoTorneo.titulo);
    expect(PAGINA).not.toContain(avisoTorneo.parrafos[0]);
  });

  /*
   * Las dos fichas repiten los colores que llevarán esas filas en la tabla del
   * grupo, para reconocerlas al llegar. Si los nombres dejan de coincidir con
   * los de la base, el aviso deja de señalar a nadie.
   */
  it("nombra a los dos equipos que cambian de estado", () => {
    expect(avisoTorneo.equipos.fuera).toBe("Limens");
    expect(avisoTorneo.equipos.dentro).toBe("Croquetillas de Arena");
    expect(PAGINA).toContain("torneo-aviso-ficha is-retirado");
    expect(PAGINA).toContain("torneo-aviso-ficha is-directo");
  });
});
