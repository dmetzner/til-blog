---
title: "Reading Open Library without hammering a nonprofit"
description: "Book data from a charity's servers, for free — which means the interesting question isn't how to fetch it, but which answers you're allowed to remember."
pubDate: 2026-07-23
tags: ["web", "apis", "til"]
draft: false
---

[Verso](https://verso.metzner.uk) scans the barcode on a book and shows you the
title, author, cover and a bit of blurb. The easy sources for that are Google
Books or a scrape of Amazon — and both mean handing someone's reading life to an
ad company, which is the one thing the app exists not to do. So the data comes
from [Open Library](https://openlibrary.org) instead, run by the Internet
Archive. Free, no tracking, no key.

Which puts the responsibility somewhere else: it's a charity's servers, and I
shouldn't be rude to them.

The first thing to know is that a book, in their data, is two things. There's the
specific printing you're holding — one barcode, one publisher, one year — and
there's the *book itself*, the thing every printing has in common. The blurb you
want to show belongs to the book, not to the printing. So one scan is two
questions: which book is this, and then, what is that book about.

The second thing cost me the most time. The obvious way to look up a barcode
often simply says "never heard of it" — reliably so for German editions, which is
most of my shelf. Searching for the same number, rather than asking for it
directly, finds them. Same data, same servers, different door. It also comes back
with extras worth having: first published in 1979, 42 editions, that kind of
detail.

Plenty of books have no cover on file,
which means a missing image — and the browser will cheerfully ask again for that
same missing image every time the list redraws. Pointless for me and rude to
them, so I write down which covers don't exist and stop asking.

But writing down answers has a trap in it. **"Did I get an answer?" and "did the answer contain anything?" are different
questions, and only the first one decides whether I'm allowed to remember it.**
"This book has no blurb" is a real answer — remember it, stop asking. "The
request timed out" is not an answer at all, and if you file it as one, a single
moment of bad wifi leaves that book permanently blank, long after the connection
came back, because your own notes now say you already checked.

Being a good neighbour to somebody else's servers turns out to be mostly that:
remember the noes, remember the yeses, and never write down a silence.

## The wiring, in code

Two hops: search resolves the barcode to a work key, then the work carries the
description. `search.json?isbn=` is also the only endpoint that returns
`first_publish_year` and `edition_count`:

```ts
const search = await getJson(
  `https://openlibrary.org/search.json?isbn=${isbn}` +
  `&fields=key,first_publish_year,edition_count,number_of_pages_median,subject,publisher&limit=1`,
  signal
);
const doc = search?.docs?.[0];
const workKey = typeof doc?.key === 'string' ? doc.key : null; // → /works/OL...W
```

`/isbn/{isbn}.json` is the intuitive endpoint and 404s far more often. For the
lightweight scan result, `/api/books?bibkeys=ISBN:…&jscmd=data` is enough; the
detail view uses the search hop above. Note that `search.publisher` aggregates
across *every* edition, so cap it (`.slice(0, 3)`) unless you want fifty
publisher names on screen.

Covers live at `covers.openlibrary.org/b/isbn/{isbn}-M.jpg`. Add `?default=false`
so a missing cover 404s instead of returning a blank placeholder — you want the
404, then you remember it:

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

And the flag that separates "answered" from "found" — only a resolved response,
200 *or* 404, may be cached:

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

The optional work fetch sits in its own try/catch *inside* the completed branch,
so a failed description doesn't throw away the good fields alongside it.
