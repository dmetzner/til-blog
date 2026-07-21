---
title: "Svelte 5 runes: a reactive store behind a synchronous read API"
description: "One `db` object with getters over `$state` keeps components dead simple — and lets the exact same store run in local or cloud mode behind a single API."
pubDate: 2026-07-22
tags: ["svelte", "web", "til"]
draft: false
---

Building [Verso](https://verso.metzner.uk) I wanted components that never think
about *where* the data comes from. A shelf view should say "give me the books in
this library" and get an array back — synchronously, no `await`, no loading
prop threaded through five layers. The trick that made this work in Svelte 5 is
putting a reactive `$state` behind a plain object of getters.

## One `db` object, getters over `$state`

The whole store is a module-level `$state` plus a `db` object whose properties
are getters that read it:

```ts
const state = $state<State>(loadLocal());

export const db = {
  get books() {
    return state.books;
  },
  get currentLibrary() {
    return state.libraries.find((l) => l.id === state.currentLibraryId)
      ?? state.libraries[0];
  },
  inLibrary(libraryId = state.currentLibraryId) {
    return state.books
      .filter((b) => b.libraryId === libraryId)
      .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  },
  // ...
};
```

Because Svelte 5's reactivity is fine-grained and runs through the getter every
time it's read, a component can just write `{#each db.inLibrary() as book}` and it
re-renders when `state.books` changes. No subscription boilerplate, no
`$store` prefix, no store contract at all — reads look completely synchronous.
The reactivity is real; it's just hidden behind a property access.

## The same API, in two totally different modes

Here's the payoff. That `db` object never changes shape, but underneath it runs
in one of two modes: **local** (anonymous, `localStorage`) or **cloud**
(logged-in, Supabase). A module-level `mode` flag decides where a write goes:

```ts
add(book) {
  const b = { id: uid(), addedAt: Date.now(), ...book } as Book;
  state.books.push(b);                     // optimistic: UI updates now
  if (mode === 'cloud' && supabase)
    cloudWrite(supabase.from('books').insert(toRow(b)));
  else persistLocal();
  return b;
}
```

The component calls `db.add(...)` and gets a book back immediately — it has no
idea whether that landed in `localStorage` or Postgres. Switching modes is just
swapping what backs the same `state`: `useLocal()` reloads from `localStorage`,
`useCloud()` pulls rows from Supabase and maps them in. The read API on top
doesn't flinch.

Cloud writes are **optimistic** — the array mutates first, the network call fires
after. If it fails (offline, an RLS rejection, a transient 5xx) I don't want to
silently roll back and confuse the user, so a tiny wrapper just flips an error
flag the UI can surface:

```ts
function cloudWrite(p: PromiseLike<{ error: unknown }>) {
  Promise.resolve(p).then(
    (res) => { if (res?.error) status.error = true; },
    () => { status.error = true; }
  );
}
```

## Bonus: one component, three HTML tags

Verso's signature element is a book rendered as a *shelf spine*. Sometimes it's a
link (to the detail page), sometimes a button (opens a sheet), sometimes purely
decorative (the spines on the landing page). Rather than three components, it's
one, using `<svelte:element>` to pick its own tag:

```svelte
<script lang="ts">
  let { book, onclick, href, tone } = $props();
  // link → <a>, handler → <button>, neither → decorative <div>
  const tag = $derived(href ? 'a' : onclick ? 'button' : 'div');
  const interactive = $derived(tag !== 'div');
</script>

<svelte:element this={tag} class="spine" class:deco={!interactive}
  href={href || undefined} {onclick}
  aria-hidden={interactive ? undefined : 'true'}>
  <!-- ... -->
</svelte:element>
```

A decorative spine renders as a non-focusable `<div>` with `aria-hidden`, so the
landing page's row of pretty book spines doesn't pollute the tab order or the
screen-reader output. Same markup, correct semantics for each use.

## The gotcha: dynamic `type` fights `bind:value`

The one that cost me a confusing ten minutes. The login form has a "show
password" toggle, so I wanted:

```svelte
<!-- ❌ Svelte won't allow this -->
<input type={showPw ? 'text' : 'password'} bind:value={password} />
```

Svelte refuses to compile a `bind:value` on an `<input>` whose `type` is a
dynamic expression. It makes sense once you see it: `bind:value` needs to know
the input's type at compile time to generate the right coercion (a
`type="number"` binds a number, everything else binds a string). A runtime
`type` means it *can't* know, so it bails.

The fix is to drop the two-way binding and wire it up manually — set `value` and
handle `oninput` yourself:

```svelte
<!-- ✅ manual value + oninput -->
<input
  type={showPw ? 'text' : 'password'}
  value={password}
  oninput={(e) => (password = e.currentTarget.value)}
/>
```

Slightly more verbose, but it lets the `type` flip freely. `bind:` is sugar; when
the sugar won't compile, the desugared version always works.

## The takeaway

The pattern I keep reaching for now: **a reactive `$state` core, wrapped in a
plain object of getters and methods.** Components read it like synchronous data
and never learn where it lives. That single seam is what let Verso run the same
UI over `localStorage` and Postgres — and made "log in and your books sync" a
change to the store, not to every screen that shows a book.
