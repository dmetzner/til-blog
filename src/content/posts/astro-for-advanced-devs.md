---
title: "If you'd call it a site, Astro; if you'd call it an app, don't"
description: "Astro sends finished pages by default and wakes only the interactive parts; that trade stops working when the whole screen is an app."
pubDate: 2026-06-18
tags: ["astro", "web", "til"]
---

I've spent years mostly in PHP. So when I built this blog with
[Astro](https://astro.build), the surprise wasn't how new it felt — it was how
*familiar*.

The idea is that the page is finished before it reaches you. The words, the
markup, the layout: all of it is assembled once, when the site is built, and what
your browser downloads is the finished thing. **No JavaScript is sent at all**
unless some specific part of the page actually needs it. Anyone who has written a
server-rendered page will recognise that instinct immediately; the modern
component tooling sits on top of it rather than replacing it.

That's the opposite of a client-rendered app. It ships a program to your browser,
which then builds the page on your device — every time, on every device, including
the phone on a train. For a blog that's paying a real cost for nothing: there's no
program here, just text.

Interactivity happens a piece at a time. Instead of the whole page being live,
individual pieces are — a theme toggle, a like button — and each one
declares when it should wake up. Immediately? When the browser is idle? Only once
it scrolls into view? Everything not marked stays inert, so you pay for
interactivity exactly where you use it instead of across the entire page. That
lever is the thing app-first setups don't hand you cheaply.

The other feature that earns the switch, if you write content: the posts are
plain Markdown files in a folder, with a declared shape — this must have a title,
a date, a list of tags. Get one wrong and **the build fails instead of the
website**. A typo'd date is a broken build on my laptop, not a broken page for a
reader. Adding a post is dropping a file in a folder. No CMS, no glue.

Where I wouldn't use it: an app. A dashboard, an editor, anything where the whole
screen is live and shares state. There you'd fight the model — every piece
becomes interactive, and you've rebuilt a worse version of a framework designed
for exactly that. My [portfolio](https://daniel.metzner.uk) stays on React
because it's an interactive toy box; the blog is a blog.

## The model, in code

An `.astro` file is two parts: frontmatter between `---` fences that runs **at
build time on the server**, and a template that looks like JSX:

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

Top-level `await`, hit a database, read the filesystem — it all happens during the
build and only HTML is sent. The mental shift from React: **there is no
client-side render of this component.** No `useState`, no effects, no re-render.

Interactivity is an *island* — an Astro component with a `<script>`, or a real
React/Vue/Svelte component hydrated with a `client:` directive:

```astro
---
import Counter from "../components/Counter.jsx"; // a real React component
---
<Counter client:visible />
```

- `client:load` — hydrate immediately
- `client:idle` — wait for the main thread to be free
- `client:visible` — wait until it scrolls into view (great below the fold)
- `client:only` — skip SSR, render only on the client

For small behaviour you don't need a framework at all: a plain `<script>` in an
`.astro` file gets bundled and runs in the browser. This blog's theme toggle and
imprint modal are ~60 lines of vanilla TS in one `<script>`.

Content collections are the typed-Markdown half — point a loader at a folder and
give it a [Zod](https://zod.dev) schema:

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

`getCollection("posts")` is then fully typed and frontmatter is validated at build.

Three gotchas worth knowing up front:

- Frontmatter runs **once, at build** — not per request, unless you opt into SSR
  with an adapter. "Why isn't my `Date.now()` updating?" Because it ran at build.
- Styles in an `.astro` file are **scoped by default**. Use a global stylesheet or
  `is:global` when you actually mean global.

## Follow-up resources

- [Astro docs — Why Astro?](https://docs.astro.build/en/concepts/why-astro/) — the official framing of the islands philosophy.
- [Islands Architecture](https://jasonformat.com/islands-architecture/) — Jason Miller's original post that named the pattern.
- [Content collections guide](https://docs.astro.build/en/guides/content-collections/) — the typed-Markdown workflow in full.
- [Astro's `client:` directives](https://docs.astro.build/en/reference/directives-reference/#client-directives) — the complete hydration reference.
