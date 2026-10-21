# CLAUDE.md

`til.metzner.uk` — a tiny "Today I Learned" blog. Astro static site, same dark-neon look as
the portfolio (`daniel.metzner.uk`). Commands and how to write a post: `README.md`.

## The gate

Run `npm run check` (`astro check && biome check . && vitest run`) before reporting done.
Biome owns formatting. **CI runs the same gate before deploy** — a red typecheck/lint/test
blocks the Pages deploy. Don't downgrade the workflow to `withastro/action` (it skips the gate).

## Invariants

- **Every change goes through a pull request — no direct pushes to `main`.** Merging needs
  three things: the gate green locally, CI green, and an independent review with no unresolved
  high or major finding on the commit that gets merged.
- **A CI job that could not START is not a pass.** An Actions billing block dies instantly with
  no logs and no steps; that is "could not run", and it is said out loud on the PR rather than
  merged past in silence.
- **The only exception is a project Daniel has explicitly called prototyping. This is not one.**
- **`posts.json` is a public API the portfolio depends on.** `daniel.metzner.uk` fetches
  `https://til.metzner.uk/posts.json` (see portfolio `config.ts`) to render its writing feed,
  served with `Access-Control-Allow-Origin: *`. Don't rename the route or change the item shape
  (`title`/`description`/`pubDate`/`tags`/`url`) without updating the portfolio's
  `useTil.ts`/`config.ts` in lockstep.
- **Pure list/tag/date logic lives in `src/lib/posts.ts`** and is the only thing tested.
  `.astro` pages and feeds import from it — don't re-implement sorting/formatting inline.
- **`byDateDesc` breaks date ties by `id`** so builds are deterministic. Keep it that way.
- **Per-post likes (`LikeButton.astro`) are privacy-gated.** The count is fetched only when the
  button scrolls into view (IntersectionObserver) — never on page load, so a bounce never pings
  Supabase with the visitor's IP. A like is a deliberate click, deduped in `localStorage` (no
  cookie). Writes go ONLY through the `bump_like` SECURITY DEFINER function
  (`supabase/likes.sql`, run once in the dashboard), which clamps the delta to ±1 — the
  publishable key can't set arbitrary counts. Plain PostgREST, no SDK bundled. `config.likes`
  empty = feature off (button not rendered).
- **Fonts are self-hosted** (`public/fonts/`, `src/styles/fonts.css`) — no third-party font
  requests (no visitor-IP leak).

## Stack

- Astro content collections (glob loader), static output. **npm** (not pnpm). Node ≥ 22.12
  (Astro's floor; CI pins 22 in `deploy.yml`). Dependency versions: `package.json`.
- Biome (lint+format on `.ts`/`.js`/`.json` — **not** `.astro`), Vitest, `astro check`.
- No CSS framework — one hand-rolled `src/styles/global.css`.
- Deploys to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`), custom
  domain in `public/CNAME`.

## Layout

- `src/content.config.ts` — posts collection schema (title/description/pubDate/tags/draft).
- `src/lib/posts.ts` — EDIT pure helpers HERE (sort, date fmt, tag slug/counts). No
  `astro:content` imports → unit-tested in `lib/posts.test.ts`.
- `src/pages/[...page].astro` — paginated note list + tag cloud (the home route).
- `src/pages/posts.json.js` — the CORS feed the portfolio fetches.

## Gotchas

- **TypeScript is pinned to 6 on purpose** — TS 7 breaks `astro check`. Don't bump it, and
  leave the red dependabot TS 7 PR alone; it re-proposes itself.
- **Biome does not parse `.astro`** — those files are excluded in `biome.json`. Typechecking
  and template correctness for `.astro` come from `astro check`.
- **`draft: true` posts are UNLISTED, not private.** They're filtered out of the index, tag
  pages, RSS, sitemap and `posts.json` via `({ data }) => !data.draft` — but the post page
  itself IS built and publicly served at its slug URL (hidden only by client-side CSS +
  `noindex`). Don't commit anything genuinely secret as a draft; keep it off `main` until
  publish.
- **Tag routes use `tagSlug()`** (lowercase, non-alphanumerics → `-`). The display label is
  carried separately as a prop — never derive the label back from the slug.
- **Likes share one EU Supabase project** with the portfolio's live room.
