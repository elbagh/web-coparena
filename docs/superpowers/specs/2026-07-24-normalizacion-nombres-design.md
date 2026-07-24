# Normalización de nombres y ocultación del segundo apellido

## Objetivo

1. Los nombres y apellidos de jugadores guardados en `jugadores` (columnas `nombre`, `apellidos`) deben quedar en Proper Case (`IAGO` → `Iago`), tanto los ya existentes en base de datos como los de altas/ediciones futuras. Cuando el nombre o apellido coincide con una entrada conocida de un diccionario de nombres/apellidos españoles-gallegos frecuentes, se restituye también la tilde correcta (`Garcia` → `García`). Fuera del diccionario, no se inventan tildes.
2. En cualquier vista donde se muestre el nombre de un participante a terceros, solo se enseña Nombre + primer apellido, nunca el segundo apellido — salvo al propio dueño de esos datos (panel admin y "Mi equipo").

## Fuera de alcance

- El nombre del equipo (`equipos.nombre`): puede ser una marca/apodo intencionadamente en mayúsculas, no se toca.
- `usuarios.nombre`: viene de Google OAuth, no de este formulario de inscripción.
- La columna `nombre_completo_normalizado` (y `telefono_normalizado`, `email_normalizado`): su lógica de minúsculas + sin tildes (`normalizarTexto`) no cambia; añadir tildes visuales no afecta a la unicidad porque esas columnas ya las eliminan.

## Diseño

### 1. Módulo `functions/_lib/nombres.ts` (nuevo)

- `capitalizarPropio(texto: string): string` — separa `texto` por espacios; por cada palabra:
  - si coincide (comparando en minúsculas y sin tildes) con una entrada de un diccionario estático embebido de nombres/apellidos españoles-gallegos frecuentes, se sustituye por la forma acentuada canónica del diccionario;
  - si no, se aplica Proper Case simple: primera letra en mayúscula (también tras cada guion o apóstrofo interno, p. ej. `O'DONNELL` → `O'Donnell`, `JOSE-MARIA` → `Jose-Maria`), el resto en minúsculas. No se inventan tildes fuera del diccionario.
- `primerApellido(apellidos: string): string` — devuelve el primer token (separado por espacio) de la cadena de apellidos.
- El diccionario (~100-150 entradas) vive embebido en el propio archivo, sin llamadas externas ni dependencias de red.

### 2. Altas y ediciones (evita que el problema reaparezca)

- En `functions/_lib/validacion.ts`, dentro de `validarRegistro`, se aplica `capitalizarPropio` a `nombre` y `apellidos` inmediatamente después de `limpiar(...)`, antes de validarlos y de construir `nombreCompletoNormalizado`.
- Como tanto `functions/api/equipos.ts` (alta) como `functions/api/mi-equipo.ts` (edición) pasan por `validarRegistro`, un único cambio cubre ambos flujos. No hace falta duplicar esta lógica en el JS de cliente (`team-form.js`): la normalización final la decide el servidor al guardar.

### 3. Backfill de los datos ya existentes

- Nueva acción de admin: `POST /api/admin?type=normalizar-nombres` en `functions/api/admin.ts`, protegida por `requireAdmin` igual que el resto del panel.
- Implementación: lee todas las filas de `jugadores` (`id`, `nombre`, `apellidos`), calcula la versión normalizada con `capitalizarPropio`, y hace `UPDATE` en batch (`env.DB.batch`) solo de las filas cuyo valor cambia. Responde `{ ok: true, actualizados: N }`.
- UI: botón "Normalizar nombres" en el panel admin (`admin.astro` + `admin.js`) con una confirmación simple antes de ejecutar, que refresca el listado al terminar.
- Al ejecutarse dentro del propio Worker, funciona igual contra D1 local (`wrangler pages dev`) o contra producción, sin scripts sueltos ni acceso manual a la base de datos. Es idempotente: se puede volver a pulsar sin efectos secundarios (las filas ya normalizadas no cambian).

### 4. Mostrar solo Nombre + primer apellido a terceros

- Único punto que hoy expone nombres de jugadores a alguien que no sea el propio dueño: `GET /api/equipos` (listado público de `functions/api/equipos.ts`). Ahí se trunca `apellidos` con `primerApellido` antes de construir la respuesta JSON — el recorte ocurre en el servidor, así el segundo apellido nunca sale de la API pública, no es solo un ocultamiento visual en el cliente.
- `GET /api/admin` (panel admin) y `GET /api/mi-equipo` ("Mi equipo") **no cambian**: siguen devolviendo `apellidos` completos. Decisión confirmada: el admin los necesita operativamente (verificar identidad el día del evento) y el dueño del equipo ya conoce/gestionó esos datos al darlos de alta.
- No existen más superficies con nombres de jugadores individuales: competición/partidos (`partidos.ts`, `competicion.astro`, `admin-matches.js`) solo usan nombres de equipo; `me.ts` solo expone nombre de equipo y recuento de jugadores.

## Archivos afectados

- `functions/_lib/nombres.ts` (nuevo)
- `functions/_lib/validacion.ts` (aplica `capitalizarPropio` en `validarRegistro`)
- `functions/api/equipos.ts` (trunca `apellidos` con `primerApellido` en la respuesta pública `GET`)
- `functions/api/admin.ts` (nueva acción `normalizar-nombres`)
- `src/pages/admin.astro` + `public/assets/admin.js` (botón de normalización)

## Verificación

- `npm run build` (astro check + build) sin errores de tipos.
- `npx wrangler pages dev dist --port 8788` (tras build):
  - Dar de alta un equipo con un jugador en mayúsculas/minúsculas mixtas y comprobar que se guarda en Proper Case (con tilde si está en el diccionario).
  - Comprobar que `GET /api/equipos` (listado público `/equipos/`) muestra solo Nombre + primer apellido.
  - Comprobar que el panel admin y "Mi equipo" siguen mostrando el apellido completo.
  - Pulsar "Normalizar nombres" en el admin con algún registro sembrado en mayúsculas en D1 local y verificar que se actualiza y que el botón es idempotente (segunda pulsación: 0 actualizados).
