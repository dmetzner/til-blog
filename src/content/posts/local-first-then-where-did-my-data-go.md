---
title: "Local-first, then \"where did my data go?\""
description: "Verso works fully offline before you ever sign in. Then logging in switched to cloud mode and hid the local books — never deleted, but it sure looked like data loss. Here's the fix."
pubDate: 2026-07-25
tags: ["web", "ux", "til"]
draft: false
---

[Verso](https://verso.metzner.uk) is local-first on purpose. You open it, scan
books, build libraries — all in `localStorage`, no account, no network. Signing
in is optional, an upgrade you take when you want your shelf on your phone *and*
your laptop. That's a lovely first-run experience. It also set a trap I walked
straight into.

## The bug that isn't a bug

The store runs in one of two modes — **local** (`localStorage`) or **cloud**
(Supabase) — behind a single read API. Logging in calls `useCloud()`, which
swaps out the backing state for whatever's in your account:

```ts
export async function useCloud() {
  // ...pull libraries + books from Supabase...
  state.libraries = libraries;
  state.books = (bookRows ?? []).map(toBook);
}
```

Now picture a brand-new user: they add twenty books offline, love it, create an
account. `useCloud()` runs, fetches their cloud library — which is *empty* — and
replaces `state.books` with `[]`. Every book they added vanishes from the screen.

The books were never deleted. They're sitting untouched in `localStorage` under a
different key. But the user doesn't know that. They see twenty books, then zero,
right after the one action ("sign in") that was supposed to *protect* their data.
That's the worst possible moment to look like data loss — and technically nothing
was lost at all.

## The fix: detect, then *offer* — never auto-clobber

The instinct is to auto-merge local into cloud on login. Don't. Auto-migration is
how you get duplicated books, or worse, someone's cloud library silently
overwritten by a stale local copy on a shared machine. The right move is to
*notice* on-device data and *offer* to import it, exactly once.

After a cloud login, Verso peeks at the local snapshot and raises a flag — gated
by a "have we already asked on this device?" marker so it never nags twice:

```ts
const MIGR = 'curio.migrated';

// inside useCloud(), after loading cloud data:
const snap = localSnapshot();
status.pendingImport =
  browser && !localStorage.getItem(MIGR) && snap?.books?.length
    ? snap.books.length
    : 0;
```

`pendingImport` drives a one-time banner: "You have 20 books on this device — add
them to your account?" The user decides. Nothing moves until they say so.

## Mapping local libraries to cloud ones by name

When they accept, the import maps each *local* library onto a *cloud* library **by
name** — reusing one that already exists, creating it if it doesn't — so
"Meine Bibliothek" locally becomes "Meine Bibliothek" in the cloud instead of a
second, duplicate library:

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

Two details that matter. Each imported book gets a **fresh `id`** so it can't
collide with anything already in the account. And the whole thing is **additive**
— it inserts into the cloud and never touches the local copy. If the import fails
halfway (it's optimistic, network-backed), the on-device books are still exactly
where they were. Worst case you re-run it; you never lose the original.

The `curio.migrated` flag is what makes it a genuinely *one-time* offer. Without
it, every login would re-prompt or re-import. With it, the local data is
"handled" and the app stops asking.

## The broader lesson

Local-first is a great default, but the moment you add accounts you've created a
**migration UX problem**, and it's easy to miss because it only bites users who
did the right thing — used the app before signing up. The principles that got me
out of it generalize:

- **Switching data sources should never look like deletion.** If cloud mode hides
  local data, tell the user it still exists and where it went.
- **Detect and offer; don't auto-merge.** The user knows whether this device's
  data should join this account. You don't.
- **Guard the offer with a flag** so it's exactly one decision, not a recurring
  nag or an accidental re-import.
- **Migrate additively.** Copy into the destination, keep the source intact until
  you're sure. "Never clobber" beats "clever merge" every time.

The books were safe the whole time. The bug was that the app didn't *say so* —
and in local-first apps, the gap between "your data is fine" and "your data looks
gone" is the entire user experience.
