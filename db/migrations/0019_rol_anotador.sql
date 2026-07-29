-- Migration number: 0019 	 el rol de anotador
-- Va en su propia migracion y no en la 0013 porque aquella ya esta aplicada en
-- produccion: una migracion registrada no se reescribe, se anade otra.
--
-- El rol se siembra ahora y no antes porque hasta ahora no habia nada que
-- anotar: crearlo en la 0013 habria sido crear un rol que no podia hacer
-- absolutamente nada.
--
-- Replicado a mano desde ROLES_SISTEMA en functions/_lib/permisos.ts, igual que
-- la 0013. test/unit/paridad-permisos.test.ts lee TODAS las migraciones, asi que
-- da igual en cual este el INSERT mientras la lista coincida.

INSERT OR IGNORE INTO roles (clave, nombre, descripcion, es_sistema) VALUES
  ('anotador', 'Anotador', 'Lleva el marcador de los partidos en directo. No toca el cuadro ni las cuentas.', 0);

INSERT OR IGNORE INTO rol_permisos (rol_id, permiso) VALUES
  ((SELECT id FROM roles WHERE clave = 'anotador'), 'panel.entrar'),
  ((SELECT id FROM roles WHERE clave = 'anotador'), 'jugadores.ver'),
  ((SELECT id FROM roles WHERE clave = 'anotador'), 'torneo.ver'),
  ((SELECT id FROM roles WHERE clave = 'anotador'), 'partidos.anotar');
