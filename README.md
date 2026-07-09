# La Copa Arena

Web estatica en Astro para el evento deportivo La Copa Arena.

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

La web esta preparada como sitio estatico. Cuando haya inscripciones reales, se puede evolucionar a formularios conectados a Cloudflare Workers, Pages Functions, D1, Airtable, Stripe u otro backend sin rehacer la interfaz.
