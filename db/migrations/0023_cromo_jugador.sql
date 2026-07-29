-- Migration number: 0023 	 el cromo pasa a ser del jugador
--
-- Apodo, dorsal, posicion, mano y lema vivian en `perfiles`, colgando de la
-- cuenta de Google. Eso significaba que solo los tenia quien habia iniciado
-- sesion y entrado en Mi zona a rellenarlos, y que la organizacion no podia
-- ponerselos a nadie: la mayoria de los cromos del album salian con la mitad de
-- los huecos vacios y no habia forma de arreglarlo desde el panel.
--
-- Son caracteristicas de la persona que juega, asi que pasan a ser columnas de
-- `jugadores`. Es el mismo movimiento que hizo la 0009 con los atributos y por
-- los mismos dos motivos: ahora los pone tambien la organizacion, y al ir por
-- jugador la ficha puede cambiar de una edicion a otra (la de 2025 conserva la
-- posicion que se jugaba en 2025).
--
-- `nivel` es el metal del cromo (bronce/plata/oro) que elige la organizacion.
-- Sin CHECK, igual que el resto de `jugadores`: anadir un cuarto nivel obligaria
-- a reconstruir la tabla, y reconstruirla se llevaria por delante `estadisticas`,
-- `jugador_atributos` y `partido_eventos` por sus ON DELETE CASCADE. La lista
-- valida vive en functions/_lib/perfil.ts.
--
-- NOTA: aqui NO se borra nada de `perfiles`. El despliegue aplica las
-- migraciones ANTES de subir el codigo, asi que el codigo viejo sigue sirviendo
-- trafico haciendo SELECT de esas columnas en api/perfil.ts, api/jugadores.ts,
-- _lib/eventos.ts y api/admin/usuarios.ts: borrarlas ahora tumbaria Mi zona, el
-- album y el anotador durante toda la ventana. Se retiran en una migracion
-- posterior, cuando produccion ya lleve una version que no las lee. Es la misma
-- cautela que con `usuarios.is_admin`. `perfiles` sobrevive con `avatar_key`,
-- que sigue colgando de la cuenta y no se mueve.

ALTER TABLE jugadores ADD COLUMN apodo TEXT;
ALTER TABLE jugadores ADD COLUMN dorsal INTEGER;
ALTER TABLE jugadores ADD COLUMN posicion TEXT;
ALTER TABLE jugadores ADD COLUMN mano TEXT;
ALTER TABLE jugadores ADD COLUMN lema TEXT;
ALTER TABLE jugadores ADD COLUMN nivel TEXT NOT NULL DEFAULT 'bronce';

-- Rescate de lo que cada cual se habia puesto en Mi zona, cruzando por correo:
-- el mismo enlace que usaba la consulta del album. `usuarios.email` no es unico
-- (lo unico unico es `google_sub`), de ahi el ORDER BY ... LIMIT 1; sin el, dos
-- cuentas con el mismo correo darian un resultado arbitrario.
--
-- Esto copia la misma ficha a todas las ediciones de esa persona, porque es el
-- unico dato que existe. A partir de aqui cada edicion puede divergir, que es
-- justo lo que se busca.
UPDATE jugadores AS j
   SET apodo    = p.apodo,
       dorsal   = p.dorsal,
       posicion = p.posicion,
       mano     = p.mano,
       lema     = p.lema
  FROM perfiles p
 WHERE p.usuario_id = (
         SELECT u.id FROM usuarios u
          WHERE LOWER(TRIM(u.email)) = j.email_normalizado
          ORDER BY u.id ASC LIMIT 1
       );

-- Los atributos pasan de 1-5 (cinco pips) a 1-99 (cromo tipo FIFA)
-- multiplicando por 20. El 5 daria 100, que se sale del rango: se capa a 99.
--
-- Seis sentencias explicitas en vez de reconstruir el objeto con json_each y
-- json_group_object: si esa subconsulta devolviera NULL para una fila rara,
-- escribiria NULL en una columna NOT NULL y tumbaria la migracion entera. Asi
-- cada atributo es independiente y una clave rara no puede con las demas.
--
-- json_valid() delante no es cosmetico: json_extract sobre JSON malformado
-- lanza y aborta. Y el BETWEEN 1 AND 5 hace la sentencia idempotente, para que
-- reejecutar el fichero no vuelva a multiplicar un 80. MIN(a,b) con dos
-- argumentos es la funcion escalar, no el agregado.
UPDATE jugador_atributos
   SET atributos = json_set(atributos, '$.saque', MIN(json_extract(atributos, '$.saque') * 20, 99))
 WHERE json_valid(atributos) AND json_extract(atributos, '$.saque') BETWEEN 1 AND 5;

UPDATE jugador_atributos
   SET atributos = json_set(atributos, '$.remate', MIN(json_extract(atributos, '$.remate') * 20, 99))
 WHERE json_valid(atributos) AND json_extract(atributos, '$.remate') BETWEEN 1 AND 5;

UPDATE jugador_atributos
   SET atributos = json_set(atributos, '$.bloqueo', MIN(json_extract(atributos, '$.bloqueo') * 20, 99))
 WHERE json_valid(atributos) AND json_extract(atributos, '$.bloqueo') BETWEEN 1 AND 5;

UPDATE jugador_atributos
   SET atributos = json_set(atributos, '$.defensa', MIN(json_extract(atributos, '$.defensa') * 20, 99))
 WHERE json_valid(atributos) AND json_extract(atributos, '$.defensa') BETWEEN 1 AND 5;

UPDATE jugador_atributos
   SET atributos = json_set(atributos, '$.recepcion', MIN(json_extract(atributos, '$.recepcion') * 20, 99))
 WHERE json_valid(atributos) AND json_extract(atributos, '$.recepcion') BETWEEN 1 AND 5;

UPDATE jugador_atributos
   SET atributos = json_set(atributos, '$.colocacion', MIN(json_extract(atributos, '$.colocacion') * 20, 99))
 WHERE json_valid(atributos) AND json_extract(atributos, '$.colocacion') BETWEEN 1 AND 5;
