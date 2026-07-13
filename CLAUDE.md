# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Astro 5 site for "La Copa Arena", a beach volleyball event at Playa O Pozo (Porto do Son). All content is in Spanish. Deployed to Cloudflare Pages (build command `npm run build`, output directory `dist`). The site output is static; a backend scaffold exists as Cloudflare Pages Functions + D1 (see Backend below).

## Commands

- `npm run dev` — dev server at 127.0.0.1
- `npm run build` — runs `astro check` (TypeScript/type checking) then `astro build`; this is the only verification step, there are no tests or linter
- `npm run preview` — serve the built `dist/`
- `npx wrangler d1 migrations apply DB --local` — apply D1 migrations to the local database
- `npx wrangler pages dev dist --port 8788` — serve `dist/` plus the Pages Functions in `functions/` with the local D1 binding (build first)

## Architecture

- Static output (`output: "static"`, directory-format URLs in [astro.config.mjs](astro.config.mjs)). No frameworks, no islands — plain `.astro` components only.
- All styling lives in a single stylesheet, [src/styles/global.css](src/styles/global.css), imported once by `BaseLayout`. Components do not use scoped `<style>` blocks; add new styles to global.css using the existing CSS custom properties (`--sea`, `--cream`, `--lime`, `--coral`, `--dune`, `--pine`, `--dusk`, etc.) defined in `:root`.
- Display typography is Titan One (npm package `@fontsource/titan-one`, imported by `BaseLayout`), exposed as `--font-display` and used for h1/h2, the giant hero dates and the nav "Inscribirse" sticker button. It echoes the rounded chunky lettering of the Copa Arena logo; headings are Title Case (no uppercase transform). Body text stays Inter/system.
- Two layouts: `BaseLayout.astro` (HTML shell, meta, fonts, global CSS) and `LegalLayout.astro` (wraps BaseLayout with header/footer and hero for the legal pages `aviso-legal`, `cookies`, `privacidad`).
- Editable event content (dates, claim, contact, social links, location/"Dónde estamos" data, perks) is centralized in [src/data/event.ts](src/data/event.ts) rather than hardcoded in pages. Real socials come from the Copa Arena linktree (https://linktr.ee/la.copa.arena).
- The landing is a vertical journey: hero with the watercolor action photo (`copa-arena-hero-watercolor.png`) under a cream overlay (the hero location eyebrow links to `/donde-estamos/`) → "¡Tienes que venir!" perks on a sand band → pine forest divider → sunset CTA band with SVG scenery. The header is left-to-right: brand wordmark (Titan One, `--deep`, distinct from the Inter nav links), nav links, and the tilted "Inscribirse" sticker CTA (`.header-join`, coral→sun gradient, wiggle keyframes gated on `html.js`).
- `/donde-estamos/` ([src/pages/donde-estamos.astro](src/pages/donde-estamos.astro)) is its own page (legal-page pattern): Google Maps satellite embed of Praia do Pozo/Langaño (`/maps/embed?pb=` format — the old `output=embed` endpoint now 404s) in an ink-border card + a tilted photo "postal" (Wikimedia Commons, CC0) + address/how-to-arrive list, all from the `donde` export in event.ts. The Monte Louro silhouette in `SceneHorizon` and the small `header-peak` SVG poking out of the nav pill both trace the angular mountain of the Copa Arena logo — keep their geometry in sync with the logo if it changes. Scenery components:
  - [src/components/SceneHorizon.astro](src/components/SceneHorizon.astro) — sky, sun, Monte Louro silhouette, sea, dunes. Props: `variant` (`"morning"` | `"sunset"`, recolors via CSS variables) and `dunes` (boolean). Layers carry `data-parallax="<factor>"` inside a `data-scene` container.
  - [src/components/SceneForest.astro](src/components/SceneForest.astro) — two-layer pine treeline generated deterministically in frontmatter.
  - [src/components/SandDivider.astro](src/components/SandDivider.astro) — wavy sand edge divider (props `fill`, `flip`).
  - [src/components/VideoCard.astro](src/components/VideoCard.astro) — vertical 9:16 video card, **currently unused**: reserved for action clips (pending Higgsfield credits); `.video-strip` CSS and the play/pause observer already exist.
- Client-side interactivity (cursor blob, hover states, scroll parallax for `[data-parallax]`, `.reveal` intersection reveals, video autoplay observer) is a plain script at [public/assets/site-interactions.js](public/assets/site-interactions.js), loaded with `<script is:inline ... defer>` from `index.astro`. It is not processed by Astro's bundler. It adds the `js` class to `<html>`; reveal/entrance styles are gated on `html.js` so content stays visible without JS. Everything motion-related is disabled under `prefers-reduced-motion`.

## Backend (Cloudflare Pages Functions + D1)

- The site stays static; Cloudflare Pages automatically deploys [functions/](functions/) as Pages Functions alongside `dist/`. No Astro adapter.
- [wrangler.toml](wrangler.toml) declares the `DB` D1 binding (`copa-arena-db`) and the `FOTOS` R2 binding (`copa-arena-fotos`, private player photos). The real `database_id` must be pasted after running `npx wrangler d1 create copa-arena-db` (see README).
- Migrations live in [db/migrations/](db/migrations/) (`migrations_dir` in wrangler.toml). Tables: `inscripciones`, `reservas` (0001, legacy) and `equipos`, `jugadores` (0002). Uniqueness (team name; player full name / phone / email) is enforced via normalized columns (lowercase, accent-stripped in the endpoint — SQLite NOCASE is ASCII-only) plus UNIQUE indexes.
- [functions/api/equipos.ts](functions/api/equipos.ts) is the real registration endpoint: `POST /api/equipos` (multipart: `payload` JSON + optional `foto_0..n`; Turnstile check, validation with per-field Spanish errors keyed `jugadores.<i>.<campo>`, R2 photo upload, transactional `DB.batch` insert, confirmation email) and `GET /api/equipos` (public list: team names + player count only, for privacy). Shared helpers live in [functions/_lib/](functions/_lib/) (`http`, `validacion`, `turnstile`, `gmail`) — `_lib` files don't become routes. Client validation in [public/assets/team-form.js](public/assets/team-form.js) mirrors `functions/_lib/validacion.ts`: keep both in sync.
- Confirmation email is sent from copa.arena.2000@gmail.com via Gmail API OAuth (plain-text MIME). Secrets: `TURNSTILE_SECRET_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (production: `wrangler pages secret put`; local: `.dev.vars`, gitignored). Email failure never rolls back a registration (201 with `emailEnviado: false`).
- Frontend pages: `/inscripcion/` (form, dynamic player cards, min 2 players + subs up to 15, RGPD consent, Turnstile widget — site key in `src/data/event.ts` `inscripcion.turnstileSiteKey`, currently the always-passing test key) and `/equipos/` (client-side fetch list). The old `POST /api/inscripciones` endpoint is obsolete but kept.
- `astro dev` does not serve `/api`; test the full flow with `npm run build` + `npx wrangler pages dev dist --port 8788`.

## Frontend changes

- When a request involves changes to the web frontend (UI, layout, styling, visual components), ALWAYS invoke the `frontend-design:frontend-design` skill before implementing.
- Every frontend change MUST be responsive and adapt to the device/viewport size. Always verify and style the mobile browser (phone) version, not just desktop — use the existing media queries in [src/styles/global.css](src/styles/global.css) (breakpoints 900px and 560px) or add new ones as needed.
- Note when verifying with headless Chrome screenshots: Chrome clamps the window to a ~500px minimum width, so `--window-size=390,...` renders a 500px layout cropped to 390 — right-edge "cuts" at mobile sizes are usually this artifact, not a layout bug.

## Git workflow (Git Flow)

- This repo follows **Git Flow**. `main` only ever receives merges from `development` — never commit or push directly to `main`.
- `development` is the integration branch and the base/target for all work. Every branch below is cut **from `development`** and merged **back into `development`** via PR/merge, never straight into `main`:
  - `feature/<nombre-corto>` — new functionality or enhancements.
  - `bugfix/<nombre-corto>` — non-urgent bug fixes found on `development`.
  - `release/<version>` — stabilizes `development` for a release (version bump, final polish) before it goes to `main`.
  - `hotfix/<nombre-corto>` — urgent fix branched from `main` to patch production, merged back into **both** `main` and `development`.
- Before starting any requested change: check out `development` (create it from `main` if it doesn't exist yet), pull latest, then branch off it with the right prefix for the kind of change (feature/bugfix/release/hotfix).
- Push work to the `feature/bugfix/release/hotfix` branch and merge into `development` freely as work completes — this does not require asking first.
- **Never push to `main` or merge `development` → `main` without asking first.** When work is ready to promote, stop and: (1) give a summary of the changes being promoted, (2) ask for explicit confirmation before merging `development` into `main` and pushing.

## Conventions

- Spanish copy uses **proper accents/diacritics** ("Música", "Navegación", "información") — this reversed an earlier no-accents convention, so fix any accent-less stragglers you touch.
- Copy tone: fun but not jokey — short, confident lines; no chistes. The user curates final wording.
- Legal pages contain placeholder holder/ownership data that must be completed before real publication.
