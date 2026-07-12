# La Copa Arena

Web en Astro para el evento deportivo La Copa Arena (vóley playa en Playa O Pozo, Porto do Son). Salida estática + backend preparado con Cloudflare Pages Functions y D1.

## Desarrollo

```bash
npm install
npm run dev
```

## Build para Cloudflare Pages

```bash
npm run build
```

Configura Cloudflare Pages con:

- Framework preset: `Astro`
- Build command: `npm run build`
- Output directory: `dist`

Al existir [wrangler.toml](wrangler.toml) con `pages_build_output_dir`, la configuración (incluidos los bindings) se toma de ese fichero.

## Backend (Pages Functions + D1)

La web sigue siendo estática; el directorio [functions/](functions/) se despliega automáticamente como Pages Functions junto a `dist/`.

Puesta en marcha de la base de datos (una sola vez):

```bash
npx wrangler d1 create copa-arena-db
# pega el database_id que devuelve en wrangler.toml
npx wrangler d1 migrations apply DB --remote
```

Desarrollo local del backend:

```bash
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler pages dev dist --port 8788
```

### Registro de equipos

- `POST /api/equipos` — recibe el formulario de `/inscripcion/` (multipart: campo `payload` JSON + fotos opcionales `foto_0..n`). Valida, comprueba duplicados (nombre de equipo y jugadores por nombre completo, móvil o correo, todo insensible a mayúsculas y acentos), sube las fotos a R2 y guarda en D1. Respuestas: `201 {ok, equipoId, emailEnviado}`, `400/409 {error, campos}`, `403` (Turnstile), `413`, `500`.
- `GET /api/equipos` — listado público que consume `/equipos/`: solo nombre y nº de jugadores.
- El endpoint antiguo `POST /api/inscripciones` queda obsoleto (se mantiene por compatibilidad).

Tablas en [db/migrations/](db/migrations/) (`equipos` y `jugadores` en `0002_equipos.sql`).

### Configuración necesaria en producción

1. **D1**: `npx wrangler d1 create copa-arena-db` y pegar el `database_id` en `wrangler.toml`; aplicar migraciones con `--remote`.
2. **R2**: `npx wrangler r2 bucket create copa-arena-fotos` (privado; las fotos no se sirven al público).
3. **Turnstile**: crear el widget en el dashboard de Cloudflare (dominio + `*.pages.dev`) y pegar la *site key* en `src/data/event.ts` (`inscripcion.turnstileSiteKey`; ahora lleva la clave de test, que siempre pasa).
4. **Gmail API** (envío desde copa.arena.2000@gmail.com): en Google Cloud crear proyecto, habilitar Gmail API, pantalla de consentimiento OAuth (External, **publicar la app**: en modo Testing el refresh token caduca a los 7 días), credencial "Aplicación web" con redirect `https://developers.google.com/oauthplayground`, y en OAuth Playground (con "Use your own OAuth credentials") autorizar el scope `gmail.send` y copiar el refresh token.
5. **Secrets del proyecto Pages**: `npx wrangler pages secret put <NOMBRE> --project-name la-copa-arena` para `TURNSTILE_SECRET_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN`.
6. En local, esos valores van en `.dev.vars` (gitignorado); vale la secret de test de Turnstile `1x0000000000000000000000000000000AA` y credenciales de Gmail vacías (el registro funciona y responde `emailEnviado: false`).

Nota: `astro dev` no sirve `/api`; para probar el formulario completo usa `npx wrangler pages dev dist` tras `npm run build`.

## Pendiente

- Clips de video verticales (saque, remate, celebración) para la franja de acción: `VideoCard.astro` y sus estilos ya existen; falta generar/grabar los clips y colocarlos en `public/assets/videos/`.
- Completar los datos de titularidad de las páginas legales (aviso legal y responsable del tratamiento en privacidad) antes de publicar.
- Fijar el plazo de conservación de datos definitivo en `/privacidad/` (ahora: 12 meses tras el torneo).
