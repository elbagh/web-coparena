# La Copa Arena

Web en Astro para La Copa Arena, con Cloudflare Pages Functions para inscripciones, login con Google y gestión privada de equipos.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Despliegue en Cloudflare Pages

En el proyecto de Cloudflare Pages:

- Build command: `npm run build`
- Build output directory: `dist`
- Deploy command: dejar vacío

Si despliegas por CLI:

```bash
npm run build
npx wrangler pages deploy dist --project-name web-coparena
```

No uses `npx wrangler deploy` ni `npx wrangler versions upload` para esta web: esos comandos son de Workers y no publican correctamente las Pages Functions de `functions/`.

## Recursos de Cloudflare

```bash
npx wrangler d1 create copa-arena-db
npx wrangler r2 bucket create copa-arena-fotos
```

El binding de D1 debe llamarse `DB` y el bucket R2 debe llamarse `FOTOS`.

Aplica las migraciones:

```bash
npx wrangler d1 migrations apply copa-arena-db
```

## Variables y secrets

Configura en Cloudflare Pages:

- `GOOGLE_CLIENT_ID`: ID de cliente OAuth de Google, tipo Web.
- `SESSION_SECRET`: cadena larga y aleatoria para firmar la sesión.
- `TURNSTILE_SECRET_KEY`: secret de Cloudflare Turnstile.
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

En Google Cloud Console, el cliente OAuth debe permitir el dominio de producción y el dominio preview de Pages si quieres probar login en previews.

## Notas

- `npm run build` debe terminar con 0 errores antes de desplegar.
- `dist/` no se commitea; Cloudflare lo genera durante el build.
- Cada cuenta de Google solo puede tener un equipo asociado.
