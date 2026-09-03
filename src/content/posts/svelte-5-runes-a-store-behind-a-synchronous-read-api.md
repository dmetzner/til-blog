---
title: "No screen should know where the data lives"
description: "Every view asks for books and gets them instantly — none of them knows whether the answer came from the device or from an account. One object in the middle, and one honest cost."
pubDate: 2026-07-22
tags: ["svelte", "web", "til"]
draft: false
---

Building [Verso](https://verso.metzner.uk) I wanted one thing: a screen should be
able to ask "which books are on this shelf" and get the answer *now*. Not a
promise of one, not a loading flag threaded down through five components.

So everything on screen talks to one object in the middle. To a view it looks
like a plain list that happens to always be current — the reactivity is real, it
just hides behind a property read:

```ts
const state = $state<State>(loadLocal());

export const db = {
  get books() { return state.books; },
  inLibrary(id = state.currentLibraryId) {
    return state.books.filter((b) => b.libraryId === id);
  },
};
```

The payoff arrived with accounts. Signed out, books live on the device; signed
in, in your account. Same screens, both worlds, because switching swaps what sits
*behind* that object. Not one view changed.

The honest cost: reads that look instant can't express "still loading", so the
first paint after signing in shows whatever's there — which is exactly how you
[make twenty books look deleted](/posts/local-first-then-where-did-my-data-go/).
One seam buys you cheap change upstream, and one new failure mode downstream.
