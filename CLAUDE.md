# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static Astro 5 site for "La Copa Arena", a beach volleyball event at Playa O Pozo. All content is in Spanish. Deployed to Cloudflare Pages (build command `npm run build`, output directory `dist`).

## Commands

- `npm run dev` — dev server at 127.0.0.1
- `npm run build` — runs `astro check` (TypeScript/type checking) then `astro build`; this is the only verification step, there are no tests or linter
- `npm run preview` — serve the built `dist/`

## Architecture

- Pure static output (`output: "static"`, directory-format URLs in [astro.config.mjs](astro.config.mjs)). No frameworks, no islands — plain `.astro` components only.
- All styling lives in a single stylesheet, [src/styles/global.css](src/styles/global.css), imported once by `BaseLayout`. Components do not use scoped `<style>` blocks; add new styles to global.css using the existing CSS custom properties (`--sea`, `--cream`, `--lime`, `--coral`, etc.) defined in `:root`.
- Two layouts: `BaseLayout.astro` (HTML shell, meta, global CSS) and `LegalLayout.astro` (wraps BaseLayout with header/footer and hero for the legal pages `aviso-legal`, `cookies`, `privacidad`).
- Editable event content (highlights, schedule, categories) is centralized in [src/data/event.ts](src/data/event.ts) rather than hardcoded in pages.
- Client-side interactivity (cursor blob, `data-tilt` card tilt, hover states) is a plain script at [public/assets/site-interactions.js](public/assets/site-interactions.js), loaded with `<script is:inline ... defer>` from `index.astro`. It is not processed by Astro's bundler.

## Conventions

- Spanish copy is deliberately written **without accents/diacritics** ("Musica", "Navegacion", "informacion") — keep new text consistent with this.
- The signup and reserve forms are non-functional placeholders (`type="button"`, no action). The README anticipates wiring them to Cloudflare Workers/Pages Functions, D1, Airtable, or Stripe later without redoing the UI — don't add fake submission logic.
- Legal pages contain placeholder holder/ownership data that must be completed before real publication.
