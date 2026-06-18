---
title: "Astro, for people who already know the web"
description: "A 5-minute mental model of Astro for experienced devs — server-first rendering, islands, and content collections — without the getting-started fluff."
pubDate: 2026-06-18
tags: ["astro", "web", "til"]
---

I've spent years mostly in PHP — Symfony, plain JS and HTML. So when I built this
blog with [Astro](https://astro.build), the surprise wasn't how new it felt — it
was how *familiar*. Astro is server-first: it renders HTML and ships zero JS by
default, the same instinct as a server-rendered PHP page, but with a modern
component model and toolchain on top.

If you already know the web — whether you come from PHP/Symfony or React/Vite —
you don't need a "what is a component" tutorial. You need the mental model and the
parts that are genuinely different. Here's the 5-minute version.

## The one idea: server-first, zero JS by default

Astro renders your components to **HTML at build time** and ships **no
JavaScript to the browser** unless you explicitly ask for it. That's the whole
pitch. A React app sends a runtime + your component tree and hydrates everything;
Astro sends HTML and hydrates *nothing* by default.

If you've written PHP, this is home turf: the server produces HTML, the browser
just shows it. Astro brings that instinct to the JS ecosystem — but instead of
`echo`-ing strings you compose typed components, and instead of a full runtime on
the client you ship none.

For content — blogs, docs, marketing, landing pages — this is the right trade.
The page is just text and markup; there's nothing to hydrate. You get fast loads
and clean HTML without opting out of a framework's runtime cost.

## `.astro` components run on the server

An `.astro` file is two parts: frontmatter (between `---` fences) that runs **at
build time** on the server, and a template that looks like JSX:

```astro
---
// runs on the server/at build — never ships to the client
const posts = await getCollection("posts");
const newest = posts.slice(0, 5);
---
<ul>
  {newest.map((p) => <li>{p.data.title}</li>)}
</ul>
```

`await` at the top level, hit a database, read the filesystem, call an API — it
all happens during the build and only the resulting HTML is sent. The mental
shift from React: **there is no client-side render of this component.** No
`useState`, no effects, no re-render. If you need interactivity, you reach for an
island.

## Islands: opt into JS, per component

The "islands architecture" is Astro's answer to interactivity. Most of the page
is static HTML (the sea); the interactive bits are **islands** you hydrate
individually. You can author them as Astro components with a `<script>`, or drop
in a real React/Vue/Svelte/Solid component and hydrate it with a `client:`
directive:

```astro
---
import Counter from "../components/Counter.jsx"; // a real React component
---
<Counter client:visible />
```

The directive controls *when* the JS loads:

- `client:load` — hydrate immediately
- `client:idle` — wait for the main thread to be free
- `client:visible` — wait until it scrolls into view (great for below-the-fold widgets)
- `client:only` — skip SSR, render only on the client

Everything *not* marked stays zero-JS. So you pay for interactivity exactly where
you use it, not for the whole page. This is the lever React-first setups don't
give you cheaply.

For small bits of behavior you don't even need a framework — a plain
`<script>` in an `.astro` file gets bundled and runs in the browser. This blog's
theme toggle and Impressum modal are ~60 lines of vanilla TS in one `<script>`,
no React island needed.

## Content collections: typed Markdown

If you're doing content, this is the feature that earns the switch. Point a
collection at a folder of Markdown/MDX and give it a [Zod](https://zod.dev)
schema:

```ts
// src/content.config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
```

Now `getCollection("posts")` is **fully typed**, frontmatter is validated at
build (a typo'd date fails the build, not production), and adding a post is
literally dropping a `.md` file in the folder. No CMS, no glue code.

## When to reach for it — and when not to

Reach for Astro when the page is **mostly content**: blogs, docs, portfolios,
marketing, anything where most of the screen is static and interactivity is
sprinkled in. The islands model means a few dynamic widgets don't drag a runtime
onto the whole site.

Don't reach for it for an **app** — a dashboard, an editor, anything that's a
stateful SPA with shared client state across the whole screen. There you'd fight
the model: everything becomes a `client:load` island and you've reinvented a
worse Next.js. Use a real app framework (or just Vite + React) for that. I keep
my [portfolio](https://daniel.metzner.uk) on React/Vite for exactly this reason —
it's an interactive toy box — and the blog on Astro.

The rule of thumb I use: **if you'd describe it as "a site," Astro; if you'd
describe it as "an app," don't.**

## Gotchas worth knowing up front

- Frontmatter runs **once, at build** — not per request (unless you opt into SSR
  with an adapter). "Why isn't my `Date.now()` updating?" Because it ran at build.
- A `.astro` component can't hold client state. Interactivity = island or
  `<script>`. Don't try to make `.astro` behave like a React component.
- Styles in an `.astro` file are **scoped by default**. Reach for a global
  stylesheet or `is:global` when you actually want global.

## Follow-up resources

- [Astro docs — Why Astro?](https://docs.astro.build/en/concepts/why-astro/) — the official framing of the islands philosophy.
- [Islands Architecture](https://jasonformat.com/islands-architecture/) — Jason Miller's original post that named the pattern.
- [Content collections guide](https://docs.astro.build/en/guides/content-collections/) — the typed-Markdown workflow in full.
- [Astro's `client:` directives](https://docs.astro.build/en/reference/directives-reference/#client-directives) — the complete hydration reference.

That's the model. The rest is just the docs.
