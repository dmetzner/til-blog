# til.metzner.uk

A small **Today-I-Learned** blog — short notes on the things I run into while building.
Static [Astro](https://astro.build) site, same dark-neon look as
[daniel.metzner.uk](https://daniel.metzner.uk), which pulls its latest notes from here.

## Develop

```bash
npm install
npm run dev      # dev server at http://localhost:4321
```

## Commands

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `npm run dev`    | Astro dev server with hot reload                          |
| `npm run build`  | Production build → `dist/`                                |
| `npm run preview`| Serve the built `dist/` locally                           |
| `npm run check`  | `astro check` + Biome + Vitest — the pre-commit / CI gate |
| `npm run format` | Apply Biome formatting + import sorting                   |

Requires **Node ≥ 22.12** (Astro 6). Run `npm run check` before committing.

## Write a post

Drop a Markdown file in `src/content/posts/`:

```markdown
---
title: "Your title"
description: "One-line summary (shown in lists, feeds, and meta)."
pubDate: 2026-06-19
tags: ["astro", "til"]
draft: false        # true = hidden in prod, still visible in dev
---

Your note. Code fences get syntax highlighting + a copy button.
```

That's it — tag pages, the home list, RSS, and `posts.json` update automatically.

## Layout

```
src/
  content/posts/*.md     the notes (schema in content.config.ts)
  lib/posts.ts           pure helpers (sort, date, tags, reading time) — unit-tested
  pages/
    [...page].astro      paginated home (page 1 at /, then /2, /3…)
    posts/[...slug].astro single note + prev/next + share
    tags/[tag].astro      per-tag listing
    posts.json.js         CORS feed the portfolio consumes  ← don't break its shape
    rss.xml.js            RSS feed
    404.astro
  components/            PostCard, Footer, Legal, ThemeToggle, LangToggle, Duck…
  layouts/Base.astro    <head>, SEO/OG/JSON-LD, header, theme + lang bootstrap
  scripts/site.ts       theme, EN/DE, share, code-copy, legal modal (vanilla)
  styles/global.css     all styling
scripts/gen-og.mjs      regenerate public/og.png when branding changes
```

See `CLAUDE.md` for invariants and gotchas before changing `src/`.

## Deploy

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`, which runs
the full `check` gate first and **blocks the deploy on red**. Custom domain
`til.metzner.uk` (`public/CNAME`).
