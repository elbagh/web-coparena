# La Copa Arena

Web en Astro para el evento deportivo La Copa Arena. La salida actual es estatica y esta preparada para desplegar en Cloudflare Workers con Static Assets.

## Desarrollo

```bash
npm install
npm run dev
```

## Build y despliegue en Cloudflare Workers

```bash
npm run build
npx wrangler deploy
```

Configura Cloudflare con:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Project name: `web-coparena`

El archivo [wrangler.toml](wrangler.toml) usa `assets.directory = "./dist"`, asi que `npx wrangler deploy` sube la salida estatica generada por Astro en `dist/`.

## Backend pendiente

El directorio [functions/](functions/) contiene el backend preparado originalmente como Cloudflare Pages Functions. Ese formato no se despliega automaticamente con `npx wrangler deploy`, porque ese comando despliega un Worker.

Para publicar `/api` con este modo hay que migrar esos endpoints a un Worker principal y activar los bindings reales de D1/R2/secrets.

Recursos previstos para el backend:

```bash
npx wrangler d1 create copa-arena-db
npx wrangler r2 bucket create copa-arena-fotos
```

Secrets previstos:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

## Notas

- `npm run build` debe terminar con 0 errores antes de desplegar.
- `dist/` no se commitea; Cloudflare lo genera durante el build.
- Las paginas legales tienen textos base y deben revisarse antes de publicar definitivamente.
