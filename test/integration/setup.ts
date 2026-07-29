import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll } from "vitest";
import { ROLES_SISTEMA } from "../../functions/_lib/permisos";

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
  // partidos antes que las fases: apunta a ellas con fase_id y grupo_id.
  "partidos",
  "torneo_grupo_equipos",
  "torneo_grupos",
  "torneo_fases",
  "ajustes",
  "camisetas_reservas",
  "perfiles",
  "equipos",
  // usuarios antes que roles: usuarios.rol_id apunta a roles.
  "usuarios",
  "rol_permisos",
  "roles",
  "ediciones"
];

afterEach(async () => {
  await env.DB.batch(TABLAS.map((tabla) => env.DB.prepare(`DELETE FROM ${tabla}`)));

  // La edición viva la siembra la migración 0006; al vaciar la tabla hay que
  // reponerla, porque media aplicación la da por hecha.
  await env.DB
    .prepare("INSERT INTO ediciones (anio, nombre, estado, es_actual) VALUES (2026, 'Copa Arena 2026', 'en_juego', 1)")
    .run();

  /*
   * Los roles de sistema los siembra la migración 0013, así que hay que
   * reponerlos igual. Se derivan de ROLES_SISTEMA en vez de repetirse a mano:
   * sin esto, el crearAdmin del siguiente test no encontraría el rol y toda la
   * suite del panel pasaría a 403 de golpe.
   *
   * El batch de D1 es secuencial, de modo que cada rol ya existe cuando entran
   * sus permisos por subconsulta sobre la clave.
   */
  // Los ajustes del directo también los siembra su migración (0018). Sin
  // reponerlos, `leerAjustes` caería a sus valores por defecto y un test sobre
  // la cadencia pasaría o fallaría según el orden.
  await env.DB
    .prepare(
      `INSERT INTO ajustes (clave, valor) VALUES
         ('directo_sondeo_ms', '3000'),
         ('directo_sondeo_lento_ms', '60000'),
         ('directo_modo_ahorro', '0')`
    )
    .run();

  await env.DB.batch(
    ROLES_SISTEMA.flatMap((rol) => [
      env.DB
        .prepare("INSERT INTO roles (clave, nombre, descripcion, es_sistema) VALUES (?1, ?2, ?3, ?4)")
        .bind(rol.clave, rol.nombre, rol.descripcion, rol.esSistema ? 1 : 0),
      ...(rol.permisos === "todos"
        ? []
        : rol.permisos.map((permiso) =>
            env.DB
              .prepare("INSERT INTO rol_permisos (rol_id, permiso) SELECT id, ?2 FROM roles WHERE clave = ?1")
              .bind(rol.clave, permiso)
          ))
    ])
  );

  // R2 no tiene transacciones: se vacía listando.
  const objetos = await env.FOTOS.list();
  if (objetos.objects.length > 0) {
    await env.FOTOS.delete(objetos.objects.map((o) => o.key));
  }
});
