# Capitán del equipo: mando único y contacto obligatorio solo suyo

## Contexto

Hoy conviven dos ideas que se solapan y que nadie llama «capitán» en la base de datos:

- `equipos.owner_user_id` (migración 0003): la cuenta de Google que inscribió el equipo. Es lo **único** que autoriza a escribir (`equipoPropioDeUsuario` en `functions/_lib/equipos.ts`), y tiene un índice `UNIQUE` global.
- «Figurar en la plantilla con tu correo» (`equipoDeUsuario`): autoriza a **leer** la ficha en `/mi-equipo/`, con `puedeEditar: false`.

Además, `jugadores.telefono` y `jugadores.email` son obligatorios para **todos** los jugadores, lo que obliga a inventarse datos de gente que solo va a jugar.

El cambio pedido: existe un capitán, que es quien crea el equipo y puede ceder el puesto; es el único con móvil y correo obligatorios; y el resto de jugadores recibe un aviso de que sin contacto no entrará en los grupos ni recibirá notificaciones.

## Decisiones tomadas

1. **Capitán = propietario.** Ceder la capitanía entrega el mando entero: el nuevo capitán puede editar y borrar el equipo desde `/mi-equipo/`, y el anterior deja de poder.
2. **Solo se puede ceder a quien ya tenga móvil y correo** rellenados.
3. **El admin puede cambiar el capitán** desde la ficha de `/admin/equipos/`, aunque no será lo habitual.
4. **El aviso de contacto es dinámico**: aparece bajo la tarjeta del jugador en cuanto se queda sin móvil ni correo, y desaparece al rellenar cualquiera de los dos.

## Alcance

Dentro:

- Nueva columna `equipos.capitan_jugador_id` como única fuente de verdad de quién manda; eliminación de `equipos.owner_user_id`.
- Móvil opcional para los jugadores que no son capitán (el correo ya era opcional en la base, pero obligatorio por validación).
- Designación y cesión de capitanía desde `/inscripcion/`, `/mi-equipo/` y `/admin/equipos/`.
- Aviso dinámico de «sin contacto» en los formularios de plantilla.

Fuera:

- Notificaciones reales, grupos de WhatsApp o envíos a los jugadores. El aviso es informativo; no hay integración detrás.
- Rehacer los índices `UNIQUE` como compuestos con `edicion_id`: ya lo hizo la migración `0010_unicidad_por_edicion.sql`, que llegó de `development` mientras se escribía esto. Este cambio conserva ese alcance por edición y solo le añade la condición parcial al del móvil.
- Cualquier cambio en `camisetas_reservas.owner_user_id`, que es una columna distinta y sin relación.

## Modelo de datos

### `equipos.capitan_jugador_id`

```sql
ALTER TABLE equipos ADD COLUMN capitan_jugador_id INTEGER
  REFERENCES jugadores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipos_capitan ON equipos (capitan_jugador_id);
```

Nullable por necesidad: el equipo se inserta antes que sus jugadores, así que la columna se rellena con un `UPDATE` final dentro del mismo `DB.batch`, resolviendo el jugador por su `orden` (que es único dentro del equipo y se fija en ese mismo batch).

`ON DELETE SET NULL` en vez de la acción por defecto: borrar un equipo hace `DELETE FROM jugadores` antes que `DELETE FROM equipos`, y con `NO ACTION` esa primera sentencia violaría la referencia. Con `SET NULL` el borrado sigue funcionando y el caso «se borra al capitán y el equipo sigue vivo» lo impide la validación, no la base.

### `jugadores.telefono` opcional

La columna es `NOT NULL` y **se queda así**: se guarda cadena vacía para «sin móvil». Reconstruir la tabla para permitir `NULL` es peligroso, porque `estadisticas.jugador_id` y `jugador_atributos.jugador_id` cuelgan de ella con `ON DELETE CASCADE` y un `DROP TABLE` intermedio se llevaría por delante esas filas.

La API sí expone `telefono: null` cuando no hay dato, igual que ya hace con `email`. La conversión vive en un solo sitio por dirección: al validar (`""` entra en la base) y al mapear la respuesta (`""` sale como `null`, en `mapJugador` de `_lib/admin.ts` y en `cargarEquipo` de `api/mi-equipo.ts`).

El índice `UNIQUE` de teléfono pasa a ser parcial, como ya lo es el de correo — si no, dos jugadores sin móvil chocarían entre sí. La migración 0010 ya le había dado alcance por edición, que aquí se conserva:

```sql
DROP INDEX IF EXISTS idx_jugadores_telefono;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_telefono
  ON jugadores (edicion_id, telefono_normalizado) WHERE telefono_normalizado <> '';
```

### Fuera `equipos.owner_user_id`

```sql
DROP INDEX IF EXISTS idx_equipos_owner_user_id;
ALTER TABLE equipos DROP COLUMN owner_user_id;
```

Se elimina en lugar de mantenerse sincronizada con el capitán: dos columnas que dicen quién manda acaban contradiciéndose, y su índice `UNIQUE` global (sin `edicion_id`) haría fallar la sincronización en cuanto una cuenta heredara el mando de un segundo equipo.

Ese índice era también lo que garantizaba «una cuenta, un equipo» — y lo garantizaba *para siempre*, no por edición, que es justamente lo que la migración 0010 vino a quitar de en medio para que una persona pueda volver a inscribirse cada año.

Lo que hace falta conservar es la garantía **dentro de la edición viva**, y esa sigue en pie por dos vías: `idx_jugadores_email` es `UNIQUE` por `(edicion_id, email_normalizado)`, así que un correo solo puede estar en una plantilla de esa edición y por tanto capitanear un solo equipo; y el alta sigue rechazando a quien ya figure en un equipo de la edición (`equipoDeUsuario`). Ser capitán de un equipo en 2026 y de otro en 2027 es ahora posible, y es lo correcto.

`api/equipos.ts` pierde además las dos ramas que hablan de la columna: la de `mapearConflictoUnique` («Ya tienes un equipo inscrito con esta cuenta») y la de `mapearErrorEsquema` («falta equipos.owner_user_id»).

### Migración `0011_capitan.sql`

Orden de las sentencias:

1. `ALTER TABLE equipos ADD COLUMN capitan_jugador_id …` + su índice.
2. Backfill del capitán, en dos pasadas:
   ```sql
   -- 1) el jugador cuyo correo es el del propietario actual
   UPDATE equipos SET capitan_jugador_id = (
     SELECT j.id FROM jugadores j
     JOIN usuarios u ON u.id = equipos.owner_user_id
     WHERE j.equipo_id = equipos.id
       AND j.email_normalizado = lower(trim(u.email))
     ORDER BY j.orden ASC, j.id ASC LIMIT 1
   );
   -- 2) el resto, al jugador de menor orden
   UPDATE equipos SET capitan_jugador_id = (
     SELECT j.id FROM jugadores j WHERE j.equipo_id = equipos.id
     ORDER BY j.orden ASC, j.id ASC LIMIT 1
   ) WHERE capitan_jugador_id IS NULL;
   ```
3. Reemplazo del índice `UNIQUE` de teléfono por su versión parcial.
4. `DROP INDEX idx_equipos_owner_user_id` y `ALTER TABLE equipos DROP COLUMN owner_user_id`.

Consecuencia asumida: un equipo creado desde el panel cuyo jugador 1 no tenga correo queda sin capitán con cuenta, y por tanto no editable desde `/mi-equipo/` — exactamente igual que hoy sin propietario, y se arregla dándole correo a ese jugador desde el panel.

## Autorización

`functions/_lib/equipos.ts`:

- `equipoPropioDeUsuario` se sustituye por **`equipoDelCapitan(db, user, edicionId)`**: el equipo cuyo `capitan_jugador_id` apunta a un jugador con `email_normalizado` igual al correo de la sesión. Es lo único que autoriza a escribir.
- `equipoDeUsuario` conserva la lectura amplia (cualquier jugador con tu correo en la plantilla), pero pierde la rama `owner_user_id`. El orden de preferencia pasa a ser «el equipo donde eres capitán primero».
- `registroIncluyeEmailUsuario` desaparece: la comprobación deja de ser «tu correo está en algún jugador» y pasa a ser «tu correo es el del capitán».

La regla de seguridad de CLAUDE.md no se debilita, se estrecha: antes cualquier fila con tu correo te ligaba al equipo; ahora solo la del capitán da poderes, y esa fila o la verificó Google al inscribir, o la cedió el capitán a propósito.

Consecuencia visible: entre que se cede el mando y el nuevo capitán entra con Google, nadie edita el equipo. Y si el correo del nuevo capitán no es una cuenta con la que se pueda entrar con Google, el equipo queda sin editor hasta que el admin lo corrija. El diálogo de cesión lo advierte explícitamente.

## Validación (`functions/_lib/validacion.ts`)

`RegistroValidado` gana `capitan: number` (índice dentro de `jugadores`). `OpcionesValidacion` pierde `ownerEmail` y `requirePlayerEmail`, y gana `emailCapitanObligatorio?: string`.

Reglas:

- `body.capitan` debe ser un entero dentro del rango de la plantilla. Si falta o no es válido → error de campo `capitan`: «Indica quién es el capitán del equipo.» No hay valor por defecto: dar por supuesto el jugador 1 en un guardado del panel podría cambiar el mando de un equipo sin querer.
- **Capitán**: móvil y correo obligatorios y válidos. Los errores se marcan en `jugadores.<capitan>.telefono` / `.email` con el texto «El capitán necesita móvil y correo para que podamos avisaros.»
- **Resto**: móvil y correo opcionales. Si vienen, se validan con las mismas reglas de formato y unicidad que hoy.
- Desaparece la regla «indica al menos un correo en el equipo»: el capitán siempre tiene uno.
- `emailCapitanObligatorio` (lo pasa solo el alta): si el correo del capitán no coincide → error en `jugadores.<capitan>.email`: «El capitán debe usar el correo con el que has iniciado sesión.»

`buscarDuplicados` (en `api/equipos.ts`) y `buscarDuplicadosEdicion` (en `_lib/equipos.ts`) dejan fuera del `IN (…)` los teléfonos vacíos, igual que ya hacen con los correos nulos. Si no, todos los jugadores sin móvil se detectarían como duplicados entre sí.

`public/assets/team-form.js` replica estas reglas (obligatoriedad según sea capitán o no, y el aviso). `test/unit/paridad-validacion.test.ts` es lo que impide que se separen.

## Reglas de cesión y borrado

Viven en los endpoints, no en `validarRegistro`, porque dependen de cuál es el capitán **actual** en la base:

- **`POST /api/equipos` (alta)**: el capitán lo elige el formulario (por defecto el jugador 1) y su correo debe ser el de la sesión (`emailCapitanObligatorio`).
- **`PATCH /api/mi-equipo`**:
  - Si el capitán del registro es el mismo jugador que el actual, su correo debe seguir siendo el de la sesión. Cambiarlo por otro se rechaza con 400: «Para ceder el equipo, designa a otro capitán.» Ceder es un acto explícito, no un efecto colateral de teclear un correo.
  - Si el capitán del registro es **otro** jugador, es una cesión: se acepta (la validación ya garantiza que esa persona tiene móvil y correo) y a partir de ese guardado quien manda es el nuevo.
  - Quitar de la plantilla al capitán actual solo se permite si ese mismo guardado designa a otro capitán. Es el caso «me voy del equipo y dejo a Ana al mando», que no se puede hacer en dos pasos porque tras ceder ya no se puede guardar.
  - Si el guardado deja al usuario fuera del equipo, la respuesta es `{ ok: true, team: null }` y la interfaz explica que ha cedido el equipo y ya no forma parte.
- **`PATCH /api/admin/equipos`**: mismas reglas salvo la del correo de sesión, que no aplica al admin. El admin sí puede cambiar el capitán libremente entre jugadores con móvil y correo.

## Interfaz

Cambios de frontend; antes de tocar estilos se invoca la skill `frontend-design:frontend-design`, y todo se comprueba en móvil (breakpoints 900/560 px de `src/styles/global.css`).

### Tarjeta de jugador (`/inscripcion/` y `/mi-equipo/`)

- La cabecera de la tarjeta del capitán muestra una insignia **Capitán**; su botón «Quitar» queda oculto.
- Las demás tarjetas muestran un botón **Hacer capitán**, deshabilitado —con explicación— mientras a esa persona le falte móvil o correo.
- Los rótulos de móvil y correo llevan `(opcional)` en las tarjetas que no son del capitán, y se marcan como obligatorios en la del capitán. Al mover la capitanía, los rótulos se recalculan.
- Aviso dinámico bajo la tarjeta, en cuanto a un jugador no capitán le falta **alguno** de los dos datos. El texto se ajusta a lo que falta, porque cada dato sirve para una cosa:

  | Falta | Aviso |
  |---|---|
  | Móvil | ⚠ Sin móvil no le añadiremos al grupo del torneo. |
  | Correo | ⚠ Sin correo no recibirá los avisos del torneo. |
  | Los dos | ⚠ Sin móvil ni correo no le añadiremos al grupo del torneo ni recibirá avisos. |

  Desaparece en cuanto están los dos. Es un aviso, nunca bloquea el envío.

### Cesión

Confirmación explícita antes de guardar una cesión, con el correo del destinatario a la vista: «Dejarás de poder editar el equipo; a partir de ahora lo hará quien entre con `ese@correo`. Si no es una cuenta de Google, nadie podrá editarlo hasta que os echemos una mano.» En `/mi-equipo/` con el diálogo propio de la página; en el panel, con `CopaAdmin.confirmar()` (nunca `window.confirm`).

### Panel de administración

- Ficha de equipo (`/admin/equipos/`, `?accion=ficha`): donde hoy se elige «Cuenta» (propietario por cuenta de Google) ahora se elige **capitán** entre los jugadores de la plantilla.
- La columna «Cuenta» de la tabla de equipos pasa a mostrar el correo del capitán; `ownerEmail` en la respuesta de `_lib/admin.ts` y `api/admin/index.ts` se renombra a `capitanEmail`.
- El editor de plantilla del panel gana el mismo selector de capitán que el público.

### Copia afectada

`/inscripcion/`: el texto del hero dice hoy que «el correo de cada jugador es obligatorio». Pasa a explicar que solo el capitán necesita móvil y correo, y que quien no los dé no recibirá avisos. Igual en la nota del campo de correo de la plantilla.

## Errores y casos límite

| Caso | Respuesta |
|---|---|
| `capitan` ausente o fuera de rango | 400, campo `capitan` |
| Capitán sin móvil o sin correo | 400, campos `jugadores.<i>.telefono` / `.email` |
| En el alta, correo del capitán ≠ sesión | 400, campo `jugadores.<i>.email` |
| Se cambia el correo del capitán actual sin ceder | 400, «Para ceder el equipo, designa a otro capitán.» |
| Se quita al capitán sin designar otro | 400, «Antes de salir del equipo, designa a otro capitán.» |
| Escribe alguien que no es el capitán | 403, con el mensaje actual de `noEsTuEquipo()` adaptado a «capitán» |
| Equipo sin capitán con cuenta (heredado o creado en el panel) | `puedeEditar: false`; la ficha se ve, no se edita |
| Dos jugadores sin móvil en el mismo equipo | Válido: el índice `UNIQUE` es parcial |

## Tests

`unit`:

- `validacion.test.ts`: capitán obligatorio; índice fuera de rango; móvil y correo exigidos solo al capitán; plantilla con varios jugadores sin contacto; `emailCapitanObligatorio`.
- `paridad-validacion.test.ts`: se amplía a las reglas nuevas para que `team-form.js` no pueda divergir.
- jsdom sobre `team-form.js` y `my-team.js`: el aviso aparece y desaparece según móvil/correo, y «Hacer capitán» está deshabilitado sin contacto.
- `mi-equipo-solo-lectura.test.ts`: se actualiza a la nueva noción de `puedeEditar`.

`integration`:

- Alta con capitán, incluyendo el rechazo si su correo no es el de la sesión.
- Cesión: el nuevo capitán guarda; el anterior recibe 403.
- Cesión a alguien sin móvil o sin correo: 400.
- Quitar al capitán sin ceder: 400. Quitarlo cediendo en el mismo guardado: 200 con `team: null`.
- `GET /api/mi-equipo`: `puedeEditar` en ambos sentidos y `telefono: null` cuando no hay.
- Panel: cambio de capitán desde la ficha; el editor de plantilla respeta las mismas reglas.
- Alta y edición con dos jugadores sin móvil (verifica el índice parcial).

Se revisan y actualizan `mi-equipo.test.ts`, `equipos-alta.test.ts`, `equipo-editor.test.ts` y el helper `crearEquipo` de `test/helpers/db.ts`, que pasa de `ownerUserId` a designar capitán. Un test que haya que debilitar para que siga pasando es un hallazgo, no un trámite.

`npm run verify` en verde antes de mezclar en `development`.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `db/migrations/0011_capitan.sql` | nuevo |
| `functions/_lib/validacion.ts` | capitán, contacto opcional |
| `functions/_lib/equipos.ts` | `equipoDelCapitan`, duplicados con teléfono vacío |
| `functions/_lib/equipo-editor.ts` | `UPDATE` final del capitán en el batch |
| `functions/_lib/admin.ts` | `ownerEmail` → `capitanEmail`, `telefono` vacío → `null` |
| `functions/api/equipos.ts` | alta con capitán, fuera `owner_user_id` |
| `functions/api/mi-equipo.ts` | autorización por capitán, reglas de cesión |
| `functions/api/admin/equipos.ts` | ficha: capitán en vez de cuenta |
| `functions/api/admin/jugadores.ts` | contacto opcional salvo capitán; ni se borra ni se mueve de equipo al capitán |
| `functions/api/admin/index.ts` | `capitanEmail` |
| `public/assets/team-form.js` | capitán, aviso, rótulos opcionales |
| `public/assets/my-team.js` | ídem + diálogo de cesión |
| `public/assets/admin/equipos.js` | selector de capitán |
| `src/pages/inscripcion.astro` | plantilla de tarjeta y copia |
| `src/pages/mi-equipo.astro` | plantilla de tarjeta |
| `src/styles/global.css` | insignia de capitán y aviso |
| `src/styles/admin/*` | selector de capitán en la ficha |
| `test/helpers/db.ts` | `crearEquipo` designa capitán |
| tests citados arriba | actualización y ampliación |
