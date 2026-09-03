---
title: "The cleanup that never ran"
description: "I stamped every room with the date it should disappear, and assumed that was cleanup. It deleted nothing — and the same one-record shortcut was throttling every write too."
pubDate: 2026-08-10
tags: ["firestore", "databases", "cloud-run", "til"]
draft: false
---

I built a planning-poker room for my team: open a link, a seat appears with your
name, everyone plays a card face down, somebody reveals. The interesting part
isn't the votes — it's who is still *there*, and who closed their laptop twenty
minutes ago without saying anything.

I stored a room the obvious way: one record holding everything about it. That
quietly decided two things I hadn't thought of as decisions.

**Nothing deletes itself.** Abandoned rooms should tidy themselves up, so I
stamped each one with the date it should disappear — which achieves precisely
nothing. It's a note to myself, not an instruction to anyone. Something has to be *told* to go around and sweep, and
that's one switch, entirely separate from writing the field. Mine happened to be
on. If it hadn't been, I'd have had a year of quietly accumulating rooms and a
firm belief that cleanup was handled.

It's also a sweeper, not an alarm clock: things go away within about a day of
their date. Fine for reclaiming junk, useless when the deadline itself is the
feature.

**Whatever shares a record shares a queue.** Ask how fast you can write to one
record and you'll be told "about once a second" — I repeated that for years. It
comes from an older product. The real answer is that the database spreads load by
splitting data across machines, and that splitting stops at one record. So
everything you put in one record, you have decided to write one at a time,
forever.

Which turns my presence problem into a schema problem. Every seat pings every few
seconds to say "still here" — and if the list of people lives *inside* the room
record, all those pings land on the single busiest thing in the database. No
faster interval or bigger machine helps; there's nothing to make bigger. Each
person gets their own record, the pings go side by side, and you pay for it when
reading instead. For a meeting-sized room one record is right. For hundreds of
people it's structurally wrong.

One cheap corollary: **a refused action must not write.** If a click you rejected
still bumps a version number, every invalid click is a write to the busiest record
*and* a notification to everyone watching.

Draw the boundaries of a record around **who writes**, not around what reads
nicely — then go and check the sweeper is actually switched on. The reading side
has its own arithmetic, which I wrote about
[after a party game nearly out-billed itself](/posts/sqlite-cloud-run-gcs-fuse-firestore/).

## The commands and the fine print

The field is inert on its own; the policy is the separate, one-time action:

```js
tx.set(ref, { ...room, expireAt: new Date(now + 60 * 86_400_000) });
```

```bash
gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl
# and gcloud firestore fields ttls list belongs in your deploy notes, not your memory
```

- **Typically deleted within 24 hours** after the expiration date — not a session
  expiry.
- **Absent or `null` means never** — a per-document opt-out with no schema change.
- **One TTL field per collection group**, ceiling of 1000 field-level configs.
- **TTL deletes are billed as deletes and fire listeners** — useful (a client sees
  the document vanish instead of going stale), but expiry is a write-shaped event.

On throughput, the architectural sentence beats any number:

> Firestore can split a key range only until it's serving a single document using
> a dedicated set of replicated storage servers.

The documented fix is the same shape as a sharded counter: spread the data across
documents, i.e. presence as a per-participant subcollection.

## Follow-up resources

- [TTL policies](https://docs.cloud.google.com/firestore/native/docs/ttl) — field type, the ~24-hour window, per-collection-group limit, billing, and that deletes call snapshot listeners.
- [Understand reads and writes at scale](https://docs.cloud.google.com/firestore/native/docs/understand-reads-writes-scale) — key-range splitting bottoming out at a single document.
- [Legacy Cloud Datastore limits](https://docs.cloud.google.com/datastore/docs/concepts/limits) — where "1 write per second" actually comes from.
- [Distributed counters](https://docs.cloud.google.com/firestore/native/docs/solutions/counters) — the canonical shard-a-hot-document pattern.
