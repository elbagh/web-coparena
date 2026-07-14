# La Copa Arena

Web en Astro para La Copa Arena, con Cloudflare Workers para inscripciones, login con Google y gestión privada de equipos y camisetas.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Despliegue en Cloudflare Workers

En el proyecto de Cloudflare Workers Builds:

- Build command: `npm run build`
- Deploy command: `npm run deploy:worker`
- Root directory: `/`

El build de Astro genera `dist/`. El deploy compila las funciones de `functions/` a `.worker/` y ejecuta `wrangler deploy`, usando `dist/` como assets estáticos del Worker.

Si despliegas por CLI:

```bash
npm run deploy
```

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

Configura en Cloudflare Workers:

- `GOOGLE_CLIENT_ID`: ID de cliente OAuth de Google, tipo Web.
- `SESSION_SECRET`: cadena larga y aleatoria para firmar la sesión.
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

En Google Cloud Console, el cliente OAuth debe permitir el dominio de producción del Worker y el dominio preview si quieres probar login en previews.

## Notas

- `npm run build:site` valida Astro. En Cloudflare, `npm run build` genera `.worker/index.js` antes del deploy.
- `dist/` y `.worker/` no se commitean; Cloudflare los genera durante el build/deploy.
- Cada cuenta de Google solo puede tener un equipo asociado.
- Las reservas de camisetas quedan ligadas a la cuenta de Google y se consultan desde Mi zona.
