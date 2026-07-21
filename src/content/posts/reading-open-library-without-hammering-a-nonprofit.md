---
title: "Reading Open Library without hammering a nonprofit"
description: "Using Open Library for ISBN metadata and covers — where the data actually lives, which endpoint resolves German editions, and how to cache so a timeout never poisons the answer."
pubDate: 2026-07-23
tags: ["web", "apis", "til"]
draft: false
---

[Verso](https://verso.metzner.uk) scans a book's ISBN and shows you the title,
author, cover and a bit of blurb. The obvious source is Google Books or an Amazon
scrape — but both mean handing someone's reading life to an ad company, which is
exactly what the app is meant to avoid. So the metadata comes from
[Open Library](https://openlibrary.org), a nonprofit run by the Internet Archive.

Free and privacy-friendly comes with a responsibility: don't hammer a charity's
servers. Here's what I learned wiring it up.

## The description lives on the *work*, not the edition

Open Library models books in two layers. An **edition** is one physical printing
(one ISBN); a **work** is the abstract book that all its editions share. The
blurb you want to show is on the *work* — `/works/{id}.json` — and often isn't on
the edition record at all.

So a lookup is two hops: resolve the ISBN to a work key, then fetch the work for
its description. And the description field is a shape-shifter — sometimes a plain
string, sometimes an object:

```ts
// A description is a plain string OR { type, value } — both occur for real.
function textValue(d: unknown): string | null {
  if (typeof d === 'string') return d.trim() || null;
  if (d && typeof d === 'object' && 'value' in d) {
    const v = (d as { value?: unknown }).value;
    return typeof v === 'string' ? v.trim() || null : null;
  }
  return null;
}
```

If you assume it's always a string, you get `[object Object]` in your UI the first
time you hit the other shape. Both are valid; handle both.

## `search.json?isbn=` resolves what `/isbn/{isbn}.json` can't

The intuitive endpoint is `/isbn/{isbn}.json`. It works — until it 404s, which
happens surprisingly often for German editions. What consistently *does* resolve
those ISBNs is the search endpoint:

```ts
const search = await getJson(
  `https://openlibrary.org/search.json?isbn=${isbn}` +
  `&fields=key,first_publish_year,edition_count,number_of_pages_median,subject,publisher&limit=1`,
  signal
);
const doc = search?.docs?.[0];
const workKey = typeof doc?.key === 'string' ? doc.key : null; // → /works/OL...W
```

Two wins in one call. `search.json?isbn=` is the *only* endpoint that gives you
`first_publish_year` and `edition_count` — nice "first published 1979, 42
editions" details — and its `key` is already the work key, so the second hop to
`/works/{key}.json` for the description falls straight out. It also resolves a
bunch of ISBNs that the direct edition endpoint refuses. When I need just the
title/author/cover for the scan result I use the lighter
`/api/books?bibkeys=ISBN:…&jscmd=data` endpoint; the richer detail view uses
`search.json`.

One caution: `search.publisher` is an *aggregate* across every edition of the
work, so it can be a huge list. Cap it (`.slice(0, 3)`) or you'll render fifty
publisher names.

## Covers 404 — so cache the misses

Covers come from `covers.openlibrary.org/b/isbn/{isbn}-M.jpg`. Add
`?default=false` or a missing cover returns a blank placeholder image instead of
a 404 — and you actually *want* the 404 so you know it's missing. But then the
browser will re-request that dead URL on every render and every filter switch.
Rude to a nonprofit, and pointless. So I remember the misses in `localStorage`:

```ts
const MISS_KEY = 'curio.coverMiss';
const coverMiss = loadMiss(); // Set<string> from localStorage

export function markCoverMissing(isbn: string): void {
  const c = cleanIsbn(isbn);
  if (!c || coverMiss.has(c)) return;
  coverMiss.add(c);
  localStorage.setItem(MISS_KEY, JSON.stringify([...coverMiss]));
}
```

Once a cover is known missing, `Cover.svelte` skips the network entirely and goes
straight to a styled placeholder.

## Cache the details too — but only when the call *completes*

The detail lookup gets the same treatment: cache each ISBN's result (including a
definitive "not found," stored as `null`) so expand/collapse or a revisit doesn't
re-hit the API. But there's a subtle trap. If you cache on *any* exit, a timeout
or an offline blip caches an empty answer — and now the book is permanently
blurb-less even after you're back online, because the cache says "already looked,
nothing there."

The fix is a `completed` flag. Only a resolved HTTP response (200 *or* 404 —
either is a definitive answer) is cacheable. A network error or an aborted
timeout leaves `completed` false, so nothing is written:

```ts
let result: BookDetails | null = null;
let completed = false;
try {
  const search = await getJson(url, ctrl.signal);
  completed = true; // resolved (200 or 404) → the answer is definitive
  // ...build result, optionally fetch the work for its description...
} catch {
  /* network error / timeout — leave completed=false so we don't cache it */
}

if (completed) {
  detailCache[isbn] = result;
  localStorage.setItem(DETAIL_KEY, JSON.stringify(detailCache));
}
```

The work fetch that adds the description is wrapped in its *own* try/catch inside
the completed branch, because it's optional enrichment — if it fails we still
cache the good search-based fields rather than throwing the whole thing away.

## The lesson

Being a good API neighbour isn't only about rate limits — it's about caching the
*right* answers. Cache your 404s so you stop asking. Cache your successes so you
don't ask twice. But never cache a *failure to reach the server*, or you'll turn
one bad network moment into a permanently wrong result. "Did the call complete?"
and "did it find anything?" are two different questions, and only the first one
decides whether you're allowed to remember the answer.
