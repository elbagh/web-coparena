-- Migration number: 0032 	 el error no forzado vuelve al anotador
-- La 0028 quito el tipo `error` porque era generico: no decia si la pelota se
-- habia ido fuera, si el saque se habia fallado o si alguien habia tocado dos
-- veces, y con el se colaba cualquier punto sin autor. Vuelve con nombre y con
-- significado: `error_no_forzado` es una accion de una persona concreta que
-- regala el punto al rival, igual que el saque fallado. Los dos guardan los DOS
-- lados en la fila, y por eso `lado_punto` sigue siendo lo unico que dice quien
-- se llevo el punto.
--
-- Hay que reconstruir la tabla porque SQLite no sabe alterar un CHECK. El riesgo
-- esta acotado y es el mismo que asumio la 0028: NINGUNA tabla apunta a
-- `partido_eventos` con clave ajena. `partido_cambios.tras_orden` no lo es a
-- proposito (el punto al que se anclo un cambio se puede deshacer, y el cambio
-- siguio ocurriendo) y `estadisticas.partido_id` cuelga de `partidos`. Lo unico
-- que hay que rehacer son sus dos indices, incluido el UNIQUE que serializa a
-- dos anotadores.
--
-- Aqui NO hay mapeo de filas: el CHECK solo se ensancha, asi que la copia es
-- literal y ningun marcador se mueve. Eso la hace re-ejecutable sin condiciones,
-- que es mas de lo que podia decir la 0028: D1 manda el fichero como una sola
-- consulta multi-sentencia y sin transaccion, y si algo falla a mitad lo anterior
-- queda aplicado y la migracion sin registrar. El siguiente intento la corre
-- entera y llega al mismo sitio.
--
-- AUN ASI, aplicarla con un partido EN JUEGO puede perder filas del log de ese
-- partido si D1 corta entre el DROP y el RENAME. Se aplica entre partidos.

DROP TABLE IF EXISTS partido_eventos_nueva;
CREATE TABLE partido_eventos_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL,
  set_numero INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('punto', 'ace', 'saque_fallado', 'error_no_forzado', 'bloqueo', 'chilena', 'ajuste')),
  lado_jugador TEXT CHECK (lado_jugador IN ('A', 'B')),
  jugador_id INTEGER REFERENCES jugadores(id) ON DELETE CASCADE,
  lado_punto TEXT CHECK (lado_punto IN ('A', 'B')),
  puntos_a INTEGER,
  puntos_b INTEGER,
  sets_a INTEGER,
  sets_b INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO partido_eventos_nueva (
  id, partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto,
  puntos_a, puntos_b, sets_a, sets_b, usuario_id, created_at
)
SELECT id, partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto,
       puntos_a, puntos_b, sets_a, sets_b, usuario_id, created_at
FROM partido_eventos;

DROP TABLE IF EXISTS partido_eventos;
ALTER TABLE partido_eventos_nueva RENAME TO partido_eventos;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partido_eventos_orden ON partido_eventos (partido_id, orden);
CREATE INDEX IF NOT EXISTS idx_partido_eventos_jugador ON partido_eventos (jugador_id);

-- `estadisticas.errores` NO se crea: ya existe. Es una de las tres columnas que
-- la 0028 dejo vivas y sin leer (`remates`, `defensas`, `errores`) para que el
-- codigo viejo pudiera seguir escribiendolas los segundos que tarda un
-- despliegue. `errores` se reutiliza; las otras dos siguen muertas y caeran en
-- su propia migracion.
--
-- Se pone a cero porque lo que arrastra son cifras del `error` viejo, el que la
-- 0028 tradujo a `saque_fallado` en el log. Esas acciones YA cuentan como saques
-- fallados en la ficha de quien las hizo: sacar ahora la columna al album sin
-- vaciarla seria contar dos veces la misma accion. Desde aqui solo la escribe el
-- pliegue, con `PATCH /api/anotacion?partido=ID` como via de recalculo.
UPDATE estadisticas SET errores = 0;
