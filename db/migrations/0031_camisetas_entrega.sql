-- Migration number: 0031   entrega de camisetas
-- Marca si una reserva ya se ha entregado a su dueño.
--
-- Aditiva y con DEFAULT 0: todo lo que ya existe queda pendiente, y el código
-- que sigue sirviendo tráfico mientras se despliega no ve nada que no conozca.
--
-- Es un booleano y no un `estado TEXT` con CHECK porque los estados son dos.
-- Un tercero exigiría migración de todas formas, y ampliar un CHECK obliga a
-- reconstruir la tabla.

ALTER TABLE camisetas_reservas
  ADD COLUMN entregada INTEGER NOT NULL DEFAULT 0 CHECK (entregada IN (0, 1));
