import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll } from "vitest";

// El esquema se crea una sola vez.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/*
 * A partir de la versión 0.18 del pool (la del salto a Vitest 4) ya no existe el
 * `isolatedStorage` que deshacía las escrituras de cada test, así que el estado
 * se limpia aquí a mano. No es opcional: los índices UNIQUE de equipos y
 * jugadores son globales, de modo que sin esto dos tests que siembren el mismo
 * equipo se pisarían y la suite pasaría o fallaría según el orden.
 *
 * Hijos antes que padres, por las claves ajenas.
 */
const TABLAS = [
  "estadisticas",
  "jugador_atributos",
  "jugadores",
  "partidos",
  "camisetas_reservas",
  "perfiles",
  "equipos",
  "usuarios",
  "ediciones"
];

afterEach(async () => {
  await env.DB.batch(TABLAS.map((tabla) => env.DB.prepare(`DELETE FROM ${tabla}`)));

  // La edición viva la siembra la migración 0006; al vaciar la tabla hay que
  // reponerla, porque media aplicación la da por hecha.
  await env.DB
    .prepare("INSERT INTO ediciones (anio, nombre, estado, es_actual) VALUES (2026, 'Copa Arena 2026', 'en_juego', 1)")
    .run();

  // R2 no tiene transacciones: se vacía listando.
  const objetos = await env.FOTOS.list();
  if (objetos.objects.length > 0) {
    await env.FOTOS.delete(objetos.objects.map((o) => o.key));
  }
});
