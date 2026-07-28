import { describe, expect, it } from "vitest";
import { idDeQuery, mapJugador, type JugadorRow } from "../../functions/_lib/admin";

const url = (query: string) => new URL(`https://copa.test/api/admin/equipos${query}`);

const fila = (extra: Partial<JugadorRow> = {}): JugadorRow => ({
  id: 3,
  equipo_id: 1,
  nombre: "Ana",
  apellidos: "Pérez",
  telefono: "666111222",
  email: "ana@example.com",
  red_social: "@ana",
  foto_key: null,
  es_suplente: 0,
  orden: 1,
  ...extra
});

describe("idDeQuery", () => {
  it("acepta enteros positivos", () => {
    expect(idDeQuery(url("?id=7"))).toBe(7);
  });

  it("rechaza cero, negativos y decimales", () => {
    expect(idDeQuery(url("?id=0"))).toBeNull();
    expect(idDeQuery(url("?id=-4"))).toBeNull();
    expect(idDeQuery(url("?id=1.5"))).toBeNull();
  });

  it("rechaza lo que no es numérico y el parámetro ausente", () => {
    expect(idDeQuery(url("?id=abc"))).toBeNull();
    expect(idDeQuery(url("?id="))).toBeNull();
    expect(idDeQuery(url(""))).toBeNull();
  });

  it("lee el parámetro que se le indique", () => {
    expect(idDeQuery(url("?equipo=9"), "equipo")).toBe(9);
    expect(idDeQuery(url("?equipo=9"))).toBeNull();
  });
});

describe("mapJugador", () => {
  it("nunca expone la clave de R2, solo si hay foto", () => {
    const conFoto = mapJugador(fila({ foto_key: "equipos/abc/jugador-1.jpg" }));
    expect(conFoto.tieneFoto).toBe(true);
    expect(conFoto).not.toHaveProperty("foto_key");
    expect(JSON.stringify(conFoto)).not.toContain("equipos/abc");

    expect(mapJugador(fila({ foto_key: null })).tieneFoto).toBe(false);
  });

  it("traduce es_suplente a booleano", () => {
    expect(mapJugador(fila({ es_suplente: 1 })).esSuplente).toBe(true);
    expect(mapJugador(fila({ es_suplente: 0 })).esSuplente).toBe(false);
  });

  it("conserva los campos visibles del jugador", () => {
    expect(mapJugador(fila())).toMatchObject({
      id: 3,
      nombre: "Ana",
      apellidos: "Pérez",
      telefono: "666111222",
      email: "ana@example.com",
      redSocial: "@ana",
      orden: 1
    });
  });
});
