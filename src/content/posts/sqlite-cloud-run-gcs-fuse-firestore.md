---
title: "A mounted bucket is not a database — even when SQLite seems to work"
description: "A mounted cloud bucket can make SQLite look persistent while breaking its guarantees; Firestore brings different traps."
pubDate: 2026-07-18
tags: ["cloud-run", "databases", "sqlite", "firestore", "til"]
draft: false
---

I built a tiny estimation game for a summer party. People scan a QR code, enter
one guess, and later the closest three win. This is exactly the kind of app where
SQLite feels perfect: one file, almost no operational surface, and more
reliability engineering behind it than my party game will ever deserve.

It ran perfectly in a container on a normal host with a bind-mounted directory.
Then I moved the same container to Cloud Run, mounted a Cloud Storage bucket at
`/data`, pointed SQLite at `/data/game.db`, redeployed it a few times, and watched
the data survive.

For a brief moment, I thought I had found the delightfully simple solution.

I had actually assembled three incompatible abstractions and received a lucky
demo. The file existed. That did not mean the database was safe.

The lesson I am keeping is broader than any one Google product: **compute can be
disposable or state can be local, but not both at once.** And a service that
makes object storage *look* like a directory does not magically give it the
locking, atomicity, latency, and write semantics of a database filesystem.

That's the whole idea, and if it's the part you came for you can stop here. The
rest is a deep walkthrough — why the demo lied, what I moved to, how I proved the
cutover, and the innocent polling loop that turned out to dominate the bill. The
[write side has its own post](/posts/firestore-live-state-ttl-and-one-document/),
where a record turns out to be the smallest thing you can split.

## SQLite was not the mistake

On the single-host deployment the container had one writer and a real host
directory mounted into it: application and database on one machine, the database
on a durable local disk. That is the sweet spot. The mistake was assuming the same
path meant the same thing after moving the container.

On Cloud Run, the container filesystem is an in-memory writable overlay. Google
states this plainly: data written there does not persist when the instance
stops. Scale-to-zero, a crash, or a new revision can all replace the machine
under the process. `DB_PATH=/tmp/game.db` is therefore a cache with SQL syntax,
not a production database.

So the obvious next move was a volume: Cloud Run can mount a bucket at a
normal-looking path, SQLite still opened `/data/game.db`, and everything still
worked. That is where the abstraction became dangerous — it removed the visible
error without satisfying the invisible contract.

## The path looked local; the semantics were not

Cloud Storage is object storage. A key happens to contain slashes, and GCS FUSE
presents those keys through filesystem calls. There is still no ordinary disk
behind the mount.

Google documents the important differences:

- Cloud Storage FUSE is not fully POSIX-compliant.
- Cloud Run's mount provides no concurrency control or file locking for multiple
  writes to the same object; the last writer wins.
- Writes are flushed by uploading the object, not by modifying database pages on
  a block device with local filesystem guarantees.
- Google explicitly says Cloud Storage FUSE should not be used as a database
  backend.

SQLite, meanwhile, coordinates a database file with journals, locks, `fsync`, and
— in WAL mode — sibling `-wal` and `-shm` files. Its own documentation says WAL
does not work over a network filesystem. The more general SQLite guidance is
almost perfectly tailored to this failure mode: once a network separates the
application from its data, use a client/server database rather than pretending
the network is a local disk.

The mismatch is not subtle once the two contracts are placed next to each other:

```
SQLite wants:       locks + ordered durable writes + page-level coordination
Object storage has: whole objects + network latency + last-writer-wins replacement
GCS FUSE adds:      a convincing pathname
```

The pathname is the least important part.

## "But it survived the deployment" proves almost nothing

This was the trap. I changed the container, Cloud Run created a new revision, and
the game was still there. The data appeared persistent.

When I opened the bucket it eventually showed the full trio — `game.db`,
`game.db-wal`, `game.db-shm` — which proves only that the flush path uploaded some
objects, not that the design is safe.

Database correctness is not "I can read the row after one happy restart." It is
what happens when two requests write together, a revision overlaps with the old
one while traffic drains, an instance dies between journal operations, or the
storage layer acknowledges writes in an order the database did not expect. Even
`max-instances=1` doesn't repair that: deployments still overlap two revisions
during handover, crashes still land between dependent writes, file locking is
still absent, and the platform is still free to discard the instance.

"It seems to work" is useful evidence for a UI. For a storage engine it is the
start of the test, not the verdict.

## The actual choice was not SQLite versus Firestore

There were three honest options:

1. **Keep SQLite and keep the single host.** A durable bind mount, one writer,
   boring operations. Completely valid.
2. **Use Cloud SQL.** Keep relational SQL semantics, accept an always-on database
   instance, connection management, and more operational/cost overhead than this
   app needs.
3. **Use Firestore.** Give up SQL, keep the serverless deployment model, pay per
   operation, and make the application data model explicit.

For a game with a few documents and append-like votes, Firestore was the smallest
managed option — not because "NoSQL scales" or any other architecture fortune
cookie, but because the access patterns are tiny and known: fetch a game by slug,
list games for the admin page, create one submission per participant, count and
rank them, toggle presence, delete a game with its submissions. No joins worth
preserving, no analytical queries.

One branding detail confused me longer than it should have: Firebase Firestore
and Google Cloud Firestore are the same service. The app uses no browser SDK —
the server talks to Firestore through the Cloud Run service identity, so nothing
in the voting page ever receives a credential.

## The migration started by making the storage API asynchronous

The original data layer used Node's built-in `node:sqlite`, whose `DatabaseSync`
API is deliberately synchronous. Firestore is network I/O and therefore async.

That difference spread farther than changing an import. Every page, action,
script, and test that touched the store had to await it. The useful refactor was
to make the public repository async for *both* implementations:

```js
const backend = process.env.DATA_BACKEND === "firestore" ? "firestore" : "sqlite";

let storePromise;

function store() {
  storePromise ??=
    backend === "firestore"
      ? import("./game-firestore.js")
      : import("./game-sqlite.js");
  return storePromise;
}

export async function getGameBySlug(slug) {
  return (await store()).getGameBySlug(slug);
}

export async function insertVote(gameId, name, guess) {
  return (await store()).insertVote(gameId, name, guess);
}
```

SQLite still runs synchronously underneath, but callers no longer know or care —
and this isn't an abstract portability layer, it exists because both deployments
are real. The refactor also flushed out an assumption I'd smuggled through the
app: internal IDs were numbers, and Firestore's are opaque strings. An identifier
is not a number just because the first database chose an integer primary key.

## A public slug needs its own consistency rule

In SQLite, `slug UNIQUE` is enough. Firestore documents are naturally addressed
by document ID, but I wanted random internal IDs and editable human-readable
slugs in URLs.

The resulting shape is deliberately small:

```
games/{randomGameId}
game_slugs/{slug}                       -> { game_id }
games/{randomGameId}/submissions/{id}   -> one participant's vote
```

`game_slugs` is an alias collection. Creating a game transactionally creates
both the game and its alias. Renaming a slug reserves the new alias and deletes
the old one in the same transaction. Two admins racing for the same slug cannot
both win.

It costs one extra document read to resolve a public URL — an excellent trade for
uniqueness plus editable URLs. One debugging gotcha comes with it: votes are a
**subcollection**, not fields on the game, so clicking the wrong game in the
console makes them look missing. A collection browser is not a table viewer.

## "One vote per person" became an honest product rule

The first version asked for an email address. That felt like identity but wasn't
authentication — anyone can type anyone else's email, so the extra privacy
surface bought no protection. Friction wearing a security costume. For an
in-person prize draw a name is what the organizers actually need, so the form asks
for one and says the rule out loud: vote once, and add a surname if somebody
shares your name.

Normalization is intentionally boring:

```js
const cleaned = name.trim().replace(/\s+/g, " ");
const normalized = cleaned.toLowerCase();
```

The raw cleaned name is stored for the winner list. The normalized form enforces
the duplicate rule. This prevents accidental double submission; it does not
pretend to stop a determined cheater inventing another name. A party game does
not need an identity provider merely to make dishonesty more ceremonious.

The Firestore document ID for a vote is a SHA-256 hash of that normalized name:

```js
const id = sha256(normalizedName);
const ref = gameRef.collection("submissions").doc(id);

await firestore.runTransaction(async (transaction) => {
  if ((await transaction.get(ref)).exists) {
    duplicate = true;
    return;
  }

  transaction.create(ref, {
    name: cleanedName,
    normalized_name: normalizedName,
    guess,
    submitted_at: Date.now(),
    present: true,
  });
});
```

The hash is not encryption or anonymization — names have a tiny guessable input
space, and the readable name is stored in the document anyway. Its job is to
turn the business uniqueness key into a fixed valid document ID.

The transaction is the load-bearing part. Two concurrent requests read the same
document. Firestore retries a transaction when a concurrent edit invalidates its
read, so exactly one creates the vote and the other returns "duplicate." A
check-then-write without a transaction would merely move the race condition to
a managed database.

## The emulator test needed real concurrency

I did not want the Firestore implementation "tested" by mocking the SDK until it
returned what the mock was told to return. Google ships a local Firestore
emulator, so the integration test used the real client and real transaction
behavior:

```js
const results = await Promise.all([
  insertVote(game.id, "Max Mustermann", 99),
  insertVote(game.id, "  max   mustermann ", 101),
]);

assert.equal(results.filter((result) => result.ok).length, 1);
assert.equal(results.filter((result) => result.reason === "duplicate").length, 1);
```

The test also renames the slug, ranks winners, toggles presence and deletes the
game — and it hard-codes `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085` and asserts it.
An integration test that can silently point at production is an incident
generator with a green checkmark.

Running the whole app against the emulator and restarting the process proves the
app no longer owns the data lifecycle. It doesn't prove the emulator is durable,
and doesn't need to.

## A cutover is complete only after a replacement instance reads the data

Deploying the new image and seeing HTTP 200 was not enough. The old failure mode
also returned HTTP 200.

The production cutover was a checklist:

1. Create the default Firestore Native database in the same region as Cloud Run.
2. Enable deletion protection; database location cannot be changed later.
3. Grant the Cloud Run runtime service account `roles/datastore.user`.
4. Deploy the tested image with `DATA_BACKEND=firestore`.
5. Remove `DB_PATH`, the GCS FUSE mount, and the volume from the Cloud Run service.
6. Keep the admin password in Secret Manager rather than a literal environment
   value.
7. Create a temporary game through the real production admin UI.
8. Submit a real temporary vote through the public form.
9. Force a second Cloud Run revision with the same image.
10. Verify the game and vote from the second revision.
11. Delete only the temporary game and vote.
12. Delete the obsolete bucket so nobody can accidentally wire it back in later.

Steps nine and ten are the proof: the vote existed, the compute instance changed,
the vote survived — tested through the same UI and identity the event will use.

Deleting the old bucket wasn't tidiness either. A bucket still holding
`game.db-wal` is an attractive nuisance: six months later somebody finds "the
database backup", remounts it, and resurrects the broken architecture.

## Serverless can be almost free — and still contain a billing trap

The base cost is wonderfully anticlimactic:

- Cloud Run has no minimum instance, uses request-based billing, and scales to
  zero. The free tier includes two million requests plus CPU and memory quotas.
- The first/default Firestore database gets free daily quotas: 50,000 reads,
  20,000 writes, 20,000 deletes, and 1 GiB stored.
- The container repository (~123 MB) and two secret versions both sit inside
  their free tiers, and the obsolete bucket is gone.

For a normal number of votes the bill is effectively zero — the only oddity is
that image pulls cross two European regions at $0.02/GiB, a fraction of a cent.

Then I looked at the live results page.

While voting is open, it refreshes every 15 seconds. Each render reads the game
and scans all submissions to produce five privacy-preserving buckets. That is
fine computationally and potentially silly economically because Firestore bills
document reads, not returned HTML bytes.

A deliberately pessimistic event example:

```
100 viewers × 240 refreshes/hour × ~502 document reads
≈ 12,048,000 reads/hour
```

After the daily free 50,000 reads, Belgium pricing is currently $0.03 per 100,000
documents. Twelve million reads is only about $3.60 — not a disaster, but wildly
larger than every other part of this tiny app combined. Four hours of everybody
leaving the results tab open is no longer "free because serverless."

The fix isn't "cache everything". It's to move the work to the write path, where
the event has hundreds of operations, instead of repeating it on the read path,
where viewers generate millions: keep one result-summary document up to date as
votes arrive, and let viewers read that.

One domain wrinkle: the buckets are relative to the observed minimum and maximum,
so a new extreme can move old votes between buckets — five atomic counters aren't
enough. Either fix the boundaries or recompute the summary on each vote. Reading
500 submissions 500 times is still far cheaper than every viewer rescanning them
every 15 seconds.

Serverless pricing is not automatically cheap. It is **multiplication made
visible**. Find the term that multiplies users × polling frequency × result-set
size, because that term will eat the rest of the architecture.

## What I would do next time

1. Decide whether the compute is disposable — and if it is, choose the external
   source of truth before deploying.
2. If a product exposes object storage as files, read its semantics section, not
   its mounting tutorial.
3. Put uniqueness rules in transactions or constraints, never in a preflight
   check, and test a concurrent collision rather than a happy insert.
4. Prove persistence by replacing the compute *after* writing data.
5. Inspect read amplification before celebrating a free tier, then delete the
   old source of truth.

The broader version: **storage APIs are contracts, not shapes.** A bucket mounted
at `/data` has the shape of a filesystem and none of its contract. A container
image has the shape of a server and none of its lifecycle.

Every one of those three products did exactly what it says. The bug was composing
them according to how they looked instead of how they behave — a much better
failure to have during a party-game deployment than during the party.

## Follow-up resources

- [Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract) — the writable filesystem is in-memory and does not survive an instance stop.
- [Cloud Storage volume mounts for Cloud Run](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts) — the missing file locking, FUSE limitations, and volume removal.
- [Cloud Storage FUSE overview](https://docs.cloud.google.com/storage/docs/cloud-storage-fuse/overview) — explicitly not POSIX-compliant, explicitly not a database backend.
- [SQLite over a network](https://www.sqlite.org/useovernet.html) — and [WAL](https://sqlite.org/wal.html): locking and sync behaviour vary; prefer client/server across a network.
- [Firestore transactions](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions) — retries, atomicity, and why the duplicate-name write is race-safe.
- [Firestore pricing](https://cloud.google.com/firestore/pricing) — the free daily quota and the per-document-read math behind the polling footgun.
- [Firestore locations](https://docs.cloud.google.com/firestore/docs/locations) — choose close to compute; the location is immutable.
