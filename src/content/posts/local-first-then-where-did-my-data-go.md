---
title: "Signing in almost ate twenty books"
description: "Verso works before you ever sign in — which is exactly why signing in can make twenty books vanish from the screen with nothing deleted. What I built instead."
pubDate: 2026-07-25
tags: ["web", "ux", "til"]
draft: false
---

[Verso](https://verso.metzner.uk) works before you sign in. You open it, scan
books, build shelves — no account, no network, nothing to agree to. An account is
optional, the thing you add when you want your shelf on the phone *and* the
laptop. It's a lovely way to meet an app. It also sets a trap, and I nearly
walked into it while building the login.

Someone adds twenty books, likes the app, creates an account.
The app now looks at the account for its data — and the account is brand new, so
it's empty. Twenty books on screen, then none. Nothing was deleted; the books are
sitting untouched on the device where they always were. But the screen says
otherwise, and the screen is what people believe. That's the worst imaginable
moment to look like data loss: immediately after the one action that was supposed
to *protect* their books.

The tempting fix is to quietly merge the device's books into the new account.
Don't. Do that and you get duplicates on the second login, or worse — on a shared
computer, someone else's stale shelf lands in your account, or yours gets buried
under theirs. Silent cleverness with other people's data goes wrong in ways they
can't undo.

So the app notices instead of acting. After signing in, it checks whether there's
anything on this device and, if so, asks — once: *you have 20 books here, add
them to your account?* Nothing moves until you say yes. If you say no, it never
brings it up again.

Two details in the import earn their place. It matches shelves **by name**, so
"Meine Bibliothek" on the device joins "Meine Bibliothek" in the account instead
of becoming a second one beside it. And it only ever **copies**: everything goes
into the account, the device's copy stays exactly where it is. If the import dies
halfway through, nothing is lost and you can simply run it again.

"Never clobber" beats "clever merge" every time. The bug would have been that the app didn't
*say so* — and in an app that works offline first, the gap between "your data is
fine" and "your data looks gone" is the entire experience.

## The code behind the offer

Two modes — on-device or account — sit behind
[one read API](/posts/svelte-5-runes-a-store-behind-a-synchronous-read-api/), so
signing in swaps the source underneath the same views:

```ts
export async function useCloud() {
  // ...pull libraries + books from Supabase...
  state.libraries = libraries;
  state.books = (bookRows ?? []).map(toBook);
}
```

That assignment is the whole hazard: an empty account replaces `state.books` with
`[]`. So after loading, peek at the local snapshot and raise a flag — gated by an
"already asked on this device" marker:

```ts
const MIGR = 'curio.migrated';

// inside useCloud(), after loading cloud data:
const snap = localSnapshot();
status.pendingImport =
  browser && !localStorage.getItem(MIGR) && snap?.books?.length
    ? snap.books.length
    : 0;
```

`pendingImport` drives the one-time banner. The import itself maps libraries by
name, gives every book a fresh `id` so it can't collide with something already in
the account, and never writes to the local copy:

```ts
const byName = new Map(state.libraries.map((l) => [l.name, l.id]));
const idMap = new Map<string, string>();
for (const lib of snap.libraries) {
  let cloudId = byName.get(lib.name);
  if (!cloudId) {
    cloudId = uid();
    await supabase.from('libraries').insert({ id: cloudId, name: lib.name });
    byName.set(lib.name, cloudId);
  }
  idMap.set(lib.id, cloudId);       // remap every book's libraryId
}
const rows = snap.books.map((b) =>
  toRow({ ...b, id: uid(), libraryId: idMap.get(b.libraryId) ?? state.currentLibraryId })
);
await supabase.from('books').insert(rows);
localStorage.setItem(MIGR, '1');    // done — never offer again on this device
```

The accounts and tables behind this are shared with two other sites, which works
for [reasons worth their own post](/posts/one-supabase-project-three-static-apps/).
