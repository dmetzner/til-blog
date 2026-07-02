# CLAUDE.md

`til.metzner.uk` — a tiny "Today I Learned" blog. Astro static site, same dark-neon
look as the portfolio (`daniel.metzner.uk`). Invariants and gotchas that aren't
obvious from any one file. Skim before changing `src/`.

## Stack

- **Astro 7** content collections (glob loader), static output. **Node ≥ 22.12**. **npm** (not pnpm). (Exact versions: see `package.json`.)
- Biome 2.x (lint+format on `.ts`/`.js`/`.json` — **not** `.astro`), Vitest, `astro check`.
- No CSS framework — one hand-rolled `src/styles/global.css`. Fonts self-hosted in `public/fonts/` (`src/styles/fonts.css`) — no third-party font requests (no visitor-IP leak).
- Deploys to **GitHub Pages on every push to `main`** (`.github/workflows/deploy.yml`),
  custom domain `til.metzner.uk` (`public/CNAME`).

## Commands

```bash
npm run dev      # astro dev server
npm run build    # astro build → dist/
npm run check    # astro check && biome check . && vitest run  — the pre-commit / CI gate
npm run format   # biome check --write .
```

## Layout

```
src/
  content/posts/*.md        the notes. Frontmatter schema in content.config.ts.
  content.config.ts         posts collection schema (title/description/pubDate/tags/draft).
  lib/posts.ts              EDIT pure helpers HERE (sort, date fmt, tag slug/counts).
                            No astro:content imports → unit-tested in lib/posts.test.ts.
  pages/
    [...page].astro         paginated note list + tag cloud (the home route)
    posts/[...slug].astro   single note + prev/next nav + tag links
    tags/[tag].astro        per-tag listing (route = tagSlug of the label)
    posts.json.js           CORS feed the PORTFOLIO fetches — see gotcha below
    rss.xml.js              RSS feed
    404.astro
  layouts/Base.astro        <head>, site header, fonts
  styles/global.css         all styling
```

## Conventions

- **Pure list/tag/date logic lives in `src/lib/posts.ts`** and is the only thing tested.
  `.astro` pages and feeds import from it — don't re-implement sorting/formatting inline.
- **`byDateDesc` breaks date ties by `id`** so builds are deterministic. Keep it that way.
- Tag routes use `tagSlug()` (lowercase, non-alphanumerics → `-`). The display label is
  carried separately as a prop — never derive the label back from the slug.
- Run `npm run check` before committing; Biome owns formatting. Comments explain *why*.

## Gotchas (load-bearing)

- **`posts.json` is a public API the portfolio depends on.** `daniel.metzner.uk` fetches
  `https://til.metzner.uk/posts.json` (see portfolio `config.ts`) to render its writing feed.
  It's served with `Access-Control-Allow-Origin: *` for the cross-subdomain fetch. Don't
  rename the route or change the item shape (`title`/`description`/`pubDate`/`tags`/`url`)
  without updating the portfolio's `useTil.ts`/`config.ts` in lockstep.
- **Biome does not parse `.astro`** — those files are excluded in `biome.json`. Typechecking
  and template correctness for `.astro` come from `astro check`, which is part of `npm run check`.
- **`draft: true` posts are UNLISTED, not private.** They're filtered out of the index, tag
  pages, RSS, sitemap, and `posts.json` via `({ data }) => !data.draft` — but the post page
  itself IS built and publicly served at its slug URL (hidden only by client-side CSS +
  `noindex`). So a draft on `main` is effectively published-but-unlinked: anyone who guesses
  the URL or reads view-source sees it. Don't commit anything genuinely secret as a draft;
  keep it off `main` until publish. (Preview mechanism, commit `390bc61`.)
- **CI runs the full `check` gate before deploy** — a red typecheck/lint/test blocks the
  Pages deploy. Don't downgrade the workflow to `withastro/action` (it skips the gate).
- **Per-post likes (`LikeButton.astro`) are privacy-gated.** The count is fetched only when the
  button scrolls into view (IntersectionObserver) — never on page load, so a bounce never pings
  Supabase with the visitor's IP. A like is a deliberate click, deduped in `localStorage` (no
  cookie). Writes go ONLY through the `bump_like` SECURITY DEFINER function (`supabase/likes.sql`,
  run once in the dashboard) which clamps the delta to ±1 — the publishable key can't set
  arbitrary counts. Talks to Supabase over plain PostgREST (no SDK bundled). `config.likes` empty
  = feature off (button not rendered). Same EU Supabase project as the portfolio's live room.
