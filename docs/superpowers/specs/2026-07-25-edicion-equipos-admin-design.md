# Edición de equipos desde el panel admin

## Contexto

El panel `/admin` (`src/pages/admin.astro` + `public/assets/admin.js`, backend en `functions/api/admin.ts`) permite hoy ver equipos/jugadores, borrar equipos y camisetas, y normalizar nombres en bloque. No existe forma de corregir un dato mal introducido por un equipo (nombre, teléfono, apellidos, foto...) sin borrar y pedir que se reinscriban.

El endpoint más parecido que ya existe es `PATCH /api/mi-equipo` (`functions/api/mi-equipo.ts`): el propio capitán edita su equipo, pero lo hace borrando todos los jugadores y reinsertándolos — lo que **pierde siempre las fotos** (`foto_key` se fija a `NULL` en cada reinserción). Ese patrón no vale para el admin porque debe conservar las fotos de los jugadores no tocados.

## Alcance

- El admin puede editar, por equipo: nombre del equipo; y por jugador, nombre, apellidos, teléfono, email, red social, su foto (sustituir o eliminar) y su orden (que determina titular/suplente, igual que hoy).
- El admin puede añadir o quitar jugadores del equipo (respetando 2–15).
- Antes de guardar, se muestra un resumen de los cambios y hay que confirmarlo explícitamente. No hay deshacer posterior — el resumen previo a guardar es la única red de seguridad, según lo pedido.
- Fuera de alcance: historial de cambios, versionado o revertir tras guardar.

## Backend

### Refactor previo: compartir validación y detección de duplicados

`functions/_lib/equipos.ts` gana dos funciones movidas/adaptadas desde `mi-equipo.ts`:

- `buscarDuplicadosEdicion(db, registro, equipoId)`: igual que la actual en `mi-equipo.ts`, comprueba nombre de equipo / nombre completo / teléfono / email contra otros equipos, excluyendo `equipoId`.
- `mapearConflictoUnique(err)` (variante "edición", sin el caso `owner_user_id` que no aplica a admin): traduce violaciones de índice UNIQUE de D1 a errores de campo.

`mi-equipo.ts` pasa a importar estas dos funciones en vez de definirlas localmente (elimina duplicación, sin cambiar su comportamiento).

`functions/_lib/validacion.ts`: `JugadorValidado` gana un campo opcional `id?: number`. En `validarRegistro`, si `j.id` es un número (o string numérica) se copia a la salida; si no, queda `undefined`. Los llamantes actuales (`equipos.ts`, `mi-equipo.ts`) lo ignoran; solo lo usa la edición admin.

### `PATCH /api/admin?type=equipo&id=<id>`

- `requireAdmin`. `id` debe ser un entero positivo de un equipo existente (404 si no).
- Multipart: `payload` (JSON) + `foto_<i>` opcionales, mismo límite `MAX_BODY_BYTES` que `equipos.ts`.
- `payload`:
  ```json
  {
    "nombre": "Equipo X",
    "jugadores": [
      { "id": 12, "nombre": "Ana", "apellidos": "Pérez", "telefono": "...", "email": "...", "redSocial": "...", "eliminarFoto": false },
      { "nombre": "Nuevo", "apellidos": "Jugador", "telefono": "...", "email": "...", "redSocial": "..." }
    ]
  }
  ```
  La posición en el array determina `orden` y `es_suplente` (índices 0 y 1 titulares, resto suplentes) — igual que en el alta y en `mi-equipo.ts`.
- Validación: `validarRegistro(payload, { requireConsent: false, requirePlayerEmail: true })`. No se comprueba email del owner (no aplica a admin).
- Los `id` de jugador que vienen en el payload deben pertenecer al equipo que se edita; si alguno no, 400 con error general (no debería ocurrir desde la UI, es defensa en profundidad).
- Duplicados: `buscarDuplicadosEdicion` contra otros equipos (409 con campos si hay colisión), igual patrón que `mi-equipo.ts`.
- Diff contra la BD actual:
  - Jugadores existentes cuyo `id` no aparece en el payload → se borran (fila + su foto en R2 si tiene).
  - Jugadores del payload con `id` → `UPDATE` de sus campos. `foto_key`:
    - si llega `foto_<i>` válida → se sube primero a R2, se usa la nueva key, la antigua (si había) se borra de R2 tras confirmar el `UPDATE`.
    - si no llega foto pero `eliminarFoto: true` → `foto_key = NULL`, se borra la antigua de R2.
    - si no llega foto y no se pide eliminar → se conserva el `foto_key` actual.
  - Jugadores del payload sin `id` → alta nueva (`INSERT`), con foto si llega `foto_<i>`, si no `foto_key = NULL`.
  - Fotos nuevas se validan con `validarFoto` (mismas reglas que el alta: JPG/PNG/WebP, 4 MB, magic bytes).
- Persistencia: subir fotos nuevas a R2 primero (igual que `equipos.ts`); si falla, no se toca la BD. Luego un único `env.DB.batch([...])` con los `UPDATE`/`INSERT`/`DELETE` de jugadores y el `UPDATE` de `equipos.nombre`/`nombre_normalizado`. Si el batch falla, se limpian de R2 las fotos nuevas que se acababan de subir (igual que `equipos.ts`). Si el batch tiene éxito, se limpian de R2 las fotos antiguas sustituidas/eliminadas/huérfanas (best effort, como ya hace `mi-equipo.ts`).
- Respuesta: `{ ok: true, equipo: <mismo shape que ya devuelve GET /api/admin para un equipo> }`.
- Errores: mismo mapeo `mapearConflictoUnique` para condiciones de carrera pese al pre-check.

### `GET /api/admin?type=foto&jugadorId=<id>`

- `requireAdmin`. Busca el jugador por `id`, si no existe o no tiene `foto_key` → 404.
- `env.FOTOS.get(foto_key)`; si no está en R2 → 404. Si está, se devuelve el `body` tal cual con el `Content-Type` guardado en `httpMetadata` y `Cache-Control: no-store` (foto privada, no cachear en capas intermedias).

## Frontend (`/admin`)

- `src/pages/admin.astro`: añade el `<dialog>` de edición de equipo (mismo patrón que `match-dialog`), con formulario de nombre de equipo + lista de jugadores editables + paso de confirmación.
- `public/assets/admin.js`:
  - `renderTeams`: cada tarjeta de jugador muestra una miniatura (`<img src="/api/admin?type=foto&jugadorId=…">` si `tieneFoto`, si no un marcador vacío) y la tarjeta de equipo gana un botón "Editar".
  - Editor: formulario con nombre de equipo y una fila por jugador (nombre, apellidos, teléfono, email, red social, foto ampliada + "Cambiar foto" + "Eliminar foto", subir/bajar orden, "Quitar jugador"), botón "Añadir jugador" (deshabilitado a los 15), validación en cliente que refleja `functions/_lib/validacion.ts` (mismos patrones y mensajes que ya usa `public/assets/team-form.js`).
  - Al pulsar "Guardar cambios": se calcula un diff legible (equipo: nombre antes→después si cambia; por jugador: campos que cambian, "se añade", "se quita", "cambia la foto", "se elimina la foto") y se muestra dentro del mismo diálogo como paso de confirmación ("Confirmar cambios" / "Volver a editar"). Solo al confirmar se construye el `FormData` (payload + `foto_<i>`) y se hace el `PATCH`.
  - Tras guardar con éxito: cerrar diálogo, refrescar `loadAdmin()`.
  - Errores de servidor (400/409) se pintan en los campos correspondientes del formulario (se vuelve al paso de edición, no al de confirmación).

## Testing

No hay test runner en el proyecto (`npm run build` = `astro check` + `astro build` es la única verificación, según CLAUDE.md). Verificación manual con `npx wrangler pages dev dist --port 8788`:

- Editar nombre de equipo y campos de un jugador existente, confirmar y comprobar que persiste tras recargar.
- Añadir un jugador nuevo y quitar uno existente, comprobar min 2 / max 15.
- Sustituir la foto de un jugador y comprobar que la miniatura cambia y la antigua ya no está en R2 (o al menos que `foto_key` cambió).
- Eliminar la foto de un jugador y comprobar que la miniatura desaparece.
- Intentar poner un teléfono/email que ya usa otro equipo → error 409 en el campo correcto.
- Comprobar responsive del diálogo de edición en móvil (breakpoints 900px/560px de `global.css`), según la norma de "Frontend changes" de CLAUDE.md.
