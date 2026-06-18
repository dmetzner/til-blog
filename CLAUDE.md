# CLAUDE.md

`til.metzner.uk` — a tiny "Today I Learned" blog. Astro static site, same dark-neon
look as the portfolio (`daniel.metzner.uk`). Invariants and gotchas that aren't
obvious from any one file. Skim before changing `src/`.

## Stack

- **Astro 5** content collections (glob loader), static output. **npm** (not pnpm).
- Biome 2.x (lint+format on `.ts`/`.js`/`.json` — **not** `.astro`), Vitest, `astro check`.
- No CSS framework — one hand-rolled `src/styles/global.css`. Google Fonts via `<link>`.
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
    index.astro             note list + tag cloud
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
- **`draft: true` posts are filtered everywhere** (index, slug, tags, both feeds) via
  `({ data }) => !data.draft`. A draft is invisible in prod but still hot-reloads in `dev`.
- **CI runs the full `check` gate before deploy** — a red typecheck/lint/test blocks the
  Pages deploy. Don't downgrade the workflow to `withastro/action` (it skips the gate).
