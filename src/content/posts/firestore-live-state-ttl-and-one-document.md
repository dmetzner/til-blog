---
title: "Firestore deletes nothing on its own, and a document is the smallest thing it can split"
description: "Two Firestore properties that decide the schema for live shared state: TTL is a policy rather than a field, and the document is the unit that expires, transacts, and hotspots."
pubDate: 2026-08-10
tags: ["firestore", "databases", "cloud-run", "til"]
draft: false
---

I built a planning-poker room for my team: you open a link, a seat appears with your
name, everyone plays a card face down, somebody reveals. The interesting state isn't the
votes — it's presence. Who is still here, and who closed their laptop twenty minutes ago
without telling anybody.

Firestore held all of it, and I picked the schema the way most people do: one document
per room, everything inside it. That worked, and it quietly made two decisions for me
that had nothing to do with queries — **who deletes this**, and **how often one document
gets written**. Neither is hidden in the docs. Both are easy to walk straight past.

## An expiry field does nothing until a policy exists

The pattern is obvious enough that you'll write it without reading anything: stamp
`expireAt` on every write, let old records disappear.

```js
tx.set(ref, { ...room, expireAt: new Date(now + 60 * 86_400_000) });
```

Ship that and you have accomplished nothing. The field is inert data. Firestore only
deletes documents when a **TTL policy** names that field for that collection group,
which is a separate, one-time administrative action:

```bash
gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl
```

I checked mine after the fact and it was `ACTIVE` — but "I wrote the field, so cleanup
is handled" is exactly the belief that leaks storage for a year. The check is one
command (`gcloud firestore fields ttls list`), and it belongs in your deploy notes next
to the field, not in your memory.

Four details worth knowing before you design around it:

**It's a sweeper, not a scheduler.** Data is "typically deleted within 24 hours after
its expiration date". So TTL is fine for reclaiming abandoned state and wrong for
anything where the deadline is the feature. It cannot hide data at a promised time, and
it cannot be your session expiry.

**Absent or null means never.** A document without the field, or with `null` there, is
simply skipped. That's a feature: leave the field off and you have pinned a record
against cleanup, per document, no schema change.

**One TTL field per collection group**, and a ceiling of 1000 field-level
configurations per database. You don't get two expiry rules on the same collection.

**Deletes are billed as deletes, and they fire listeners.** TTL deletion "calls all
active snapshot listeners" and triggers functions. That's genuinely useful for live
state — a client watching a document sees it vanish rather than going stale — but it
also means expiry is a write-shaped event with a cost, not a silent vacuum.

## The number everyone quotes is from a different product

Now the other half. Ask about write throughput and someone will tell you Firestore
allows about **one sustained write per second per document**. I repeated that myself.

It's worth knowing where it comes from, because the wording still exists — in the
*legacy Cloud Datastore* limits, as a maximum write rate of 1 per second to an entity
group. Current Firestore documentation doesn't state a per-document number at all. It
says the maximum rate for updating a single document "depends highly on the workload",
and that contention comes from the write rate, concurrent access and the number of
affected indexes.

What it does state is the architectural reason, which is more useful than a number:

> Firestore can split a key range only until it's serving a single document using a
> dedicated set of replicated storage servers.

Firestore scales by splitting key ranges across servers. That splitting bottoms out at
one document. A document is therefore the smallest unit of write parallelism you can
ever have — and "high and sustained volumes of concurrent operations on a single
document may lead to a hotspot", with the recommended fix being to change the data
model and spread the data across documents.

So the honest form of the rule isn't 1/sec. It's: **whatever you put in one document,
you have decided to write serially, forever.**

## Which is a schema decision, not a limit to raise

Which brings back the presence problem. Knowing who's still here means heartbeats, and if
the participant list lives inside the shared room document, every heartbeat from every
person is a write to the single hottest document in the database. The room's ceiling stops
being about my app and starts being about how many writers I pointed at one key.

The fix isn't a shorter heartbeat interval — that's the wrong direction — and it isn't a
bigger instance, because there's nothing to make bigger. It's giving each writer its own
document, i.e. presence as a per-participant subcollection. Then heartbeats are parallel
and you pay for it on the read side instead.

For a room the size of a meeting, one document is right: it's atomic, one listener sees
everything, and there's nothing to reconcile. For hundreds of people it's structurally
wrong, and no amount of tuning will move it. Same shape as the classic counter problem —
that's why sharded counters exist.

The corollary is cheap and worth writing down: **a rejected operation must not write.**
If a disallowed action still bumps a version field, you've turned every invalid click
into a write on the hot document *and* a push to every listener watching it. A no-op has
to be a no-op all the way down.

## When Firestore isn't the answer here

If your shared state changes many times per second — cursor positions, dragging, actual
gameplay — this whole discussion is a sign you're holding the wrong tool. That's memory
plus a pub/sub fan-out, with the database used for the parts worth keeping. Firestore is
a good fit when writes are bounded by *people doing things* and you want durability and
listeners for free.

The read side is a separate trap with separate arithmetic — I wrote about that one
[after a party game nearly out-billed itself](/posts/sqlite-cloud-run-gcs-fuse-firestore/).

The thing I'd tell myself earlier: in Firestore the document is the unit of everything —
what you can transact atomically, what expires, and what you can hotspot. So draw
document boundaries around **who writes**, not around what reads nicely. Then go and
confirm the TTL policy actually exists.

## Follow-up resources

- [TTL policies](https://docs.cloud.google.com/firestore/native/docs/ttl) — required field type, the ~24-hour deletion window, per-collection-group limit, billing, and that TTL deletes call snapshot listeners.
- [Understand reads and writes at scale](https://docs.cloud.google.com/firestore/native/docs/understand-reads-writes-scale) — key-range splitting bottoming out at a single document, and the 500/50/5 ramp-up rule.
- [Best practices](https://docs.cloud.google.com/firestore/native/docs/best-practices) — hotspots, monotonic IDs, and why single-document throughput "depends highly on the workload".
- [Legacy Cloud Datastore limits](https://docs.cloud.google.com/datastore/docs/concepts/limits) — where "1 write per second" actually comes from.
- [Quotas and limits](https://docs.cloud.google.com/firestore/native/docs/quotas) — the 1 MiB document ceiling and transaction limits.
- [Distributed counters](https://docs.cloud.google.com/firestore/native/docs/solutions/counters) — the canonical shard-a-hot-document pattern.
