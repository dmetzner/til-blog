---
title: "A mounted bucket is not a database — even when SQLite seems to work"
description: "What a tiny Cloud Run deployment taught me about ephemeral containers, deceptive GCS FUSE persistence, Firestore transactions, cutover proofs, and the one innocent polling loop that can dominate the bill."
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

## SQLite was not the mistake

SQLite was the right first choice.

On the single-host deployment, the container had one writer and a real host
directory mounted into it. Rebuilding the image did not touch the database file,
and the filesystem underneath it provided the behavior SQLite expects. That is
the sweet spot: application and database on one machine, with the database on a
durable local disk.

The mistake was assuming that the same path meant the same thing after moving
the container.

On Cloud Run, the container filesystem is an in-memory writable overlay. Google
states this plainly: data written there does not persist when the instance
stops. Scale-to-zero, a crash, or a new revision can all replace the machine
under the process. `DB_PATH=/tmp/game.db` is therefore a cache with SQL syntax,
not a production database.

So the obvious next move was a volume. Cloud Run can mount a Cloud Storage bucket
and expose it at a normal-looking path. The app did not need to know about object
APIs; SQLite still opened `/data/game.db`; the admin UI still worked.

That is where the abstraction became dangerous. It removed the visible error
without satisfying the invisible contract.

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

When I opened the bucket, I initially saw only a tiny `game.db-shm` object — not
the main database. Later, the bucket showed the full trio:

```
game.db
game.db-wal
game.db-shm
```

That did not make the design safer. It only showed that the cache and flush path
eventually uploaded some objects.

Database correctness is not "I can read the row after one happy restart." It is
what happens when two requests write together, a revision overlaps with the old
one while traffic drains, an instance dies between journal operations, or the
storage layer acknowledges operations in an order the database did not expect.

Even `max-instances=1` is not a repair:

- it reduces concurrency, but it does not turn object replacement into database
  page I/O;
- deployments can still involve an old and a new revision during handover;
- crashes can still happen between dependent writes;
- file locking is still absent;
- and the platform is still free to discard the instance.

"It seems to work" is useful evidence for a UI. For a storage engine, it is the
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
managed solution. This was not because "NoSQL scales" or any other architecture
fortune cookie. It was because the access patterns were tiny and known:

- fetch a game by public slug;
- list games for the admin page;
- create one submission per participant;
- count and rank submissions;
- update presence and delete a game with its submissions.

There are no joins worth preserving and no long analytical queries. A managed
document database fits the shape.

One branding detail confused me for longer than it should have: Firebase
Firestore and Google Cloud Firestore are the same database service. The app does
not use a public Firebase browser SDK. The Next.js server uses Google's Firestore
server client, authenticated through the Cloud Run service identity. Nothing in
the voting page receives a database credential.

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

SQLite still runs synchronously underneath, but callers no longer know or care.
The single-host deployment can stay on SQLite; Cloud Run selects Firestore with
an environment variable. This is not an abstract "database portability" layer
for hypothetical future engines. It exists because both deployments are real
and useful.

The refactor also exposed one assumption I had smuggled through the app: internal
game IDs were numbers. Firestore document IDs are opaque strings. Public URLs
already used slugs, so the fix was mostly to stop parsing internal form values as
integers. It was a good reminder that an identifier is not a number merely
because the first database chose an integer primary key.

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

It costs one extra document read to resolve a public URL. For this app, that is
an excellent trade for simple uniqueness and editable URLs.

It also creates a small console-UI gotcha: submissions do not appear as fields on
the game document. They are a **subcollection** under the selected game. If the
Firestore console shows two games and you click the one with zero votes, the
absence of `submissions` can look like missing data. The hierarchy matters when
debugging document stores; the collection browser is not a relational table
viewer.

## "One vote per person" became an honest product rule

The first version asked for an email address. That felt like identity, but it was
not authentication. Anyone could type anyone else's email, and the extra privacy
surface bought no real protection. It was friction wearing a security costume.

For an in-person prize draw, a name is the thing the organizers actually need.
So the UI now asks for a name and says the rule out loud: vote once; if somebody
shares your name, add a surname or short identifier.

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

The test also renames the slug, calculates result buckets, ranks winners, toggles
presence, and deletes the game. Most importantly, the test command hard-codes
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8085` and asserts it. An integration test that
can silently point at production is an incident generator with a green checkmark.

The local approval flow was equally useful: run the whole Next app against the
emulator, create a preview game, restart the app process, and verify the game is
still there. That proves the app no longer owns the data lifecycle. It does not
prove the emulator itself is durable — and it does not need to. Production
Firestore owns that part.

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

That ninth and tenth step were the proof. The vote existed before the revision,
the compute instance changed, and the vote still existed afterward. This tests
the property the migration was for, through the same UI and identity the event
will use.

Deleting the old bucket was not just tidiness. An unused bucket containing
`game.db`, `game.db-wal`, and `game.db-shm` is an attractive nuisance: six months
later, somebody sees "the database backup," remounts it, and resurrects the
broken architecture. Once the cutover is verified and no migration is needed,
remove the false source of truth.

## Serverless can be almost free — and still contain a billing trap

The base cost is wonderfully anticlimactic:

- Cloud Run has no minimum instance, uses request-based billing, and scales to
  zero. The free tier includes two million requests plus CPU and memory quotas.
- The first/default Firestore database gets free daily quotas: 50,000 reads,
  20,000 writes, 20,000 deletes, and 1 GiB stored.
- The container repository currently uses about 123 MB; Artifact Registry has a
  0.5 GB storage free tier.
- Two active Secret Manager versions are below its six-version free tier.
- The obsolete Cloud Storage bucket is gone.

For the deployment and a normal number of votes, the bill is effectively zero.
The only unavoidable oddity is that the Artifact Registry repository and Cloud
Run service are in different European regions. Artifact transfer between
European regions is currently $0.02/GiB, so a 123 MB image pull costs a fraction
of a cent. Co-locating them on the next project would remove even that.

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

The interesting optimization is not "cache everything." It is to move work to
the write path, where the event has hundreds of operations, instead of repeating
it on the read path, where viewers can generate millions:

- maintain a result-summary document transactionally when a vote arrives;
- or recompute and store the coarse aggregate after each vote;
- or refresh less often and cache the rendered result;
- or listen to one aggregate document rather than rescanning every submission.

There is one domain wrinkle: the current buckets are relative to the observed
minimum and maximum. A new extreme changes the boundaries and can move all old
votes between buckets, so five simple atomic counters are not sufficient. Either
use fixed bucket boundaries, or recompute the one summary document on each vote.
Reading 500 submissions 500 times is still far cheaper than reading them every
15 seconds for every viewer.

Serverless pricing is not automatically cheap. It is **multiplication made
visible**. Find the term that multiplies users × polling frequency × result-set
size, because that term will eat the rest of the architecture.

## What I would do next time

My deployment checklist for the next small stateful container is now shorter:

1. Decide whether the compute is disposable.
2. If yes, choose the external source of truth before deploying.
3. If a product exposes object storage as files, read its semantics section, not
   only its mounting tutorial.
4. Keep SQLite for a real local disk and a single host; do not blame SQLite for a
   filesystem that broke its contract.
5. Put uniqueness rules inside database transactions or constraints, never in a
   preflight check.
6. Test a concurrent collision, not only a happy insert.
7. Prove persistence by replacing the compute after writing data.
8. Inspect read amplification before celebrating a free tier.
9. Delete the temporary source of truth after a verified cutover.

The broader version is simpler: **storage APIs are contracts, not shapes.** A
bucket mounted at `/data` has the shape of a filesystem. It does not have the
contract of one. A container image has the shape of a server. It does not have
the lifecycle of one.

SQLite remained exactly as reliable as advertised. Cloud Storage remained
exactly the object store it claimed to be. Cloud Run remained disposable. The
bug was composing them according to how they looked instead of how they behave.

That is a much better failure to have during a party-game deployment than during
the party.

## Follow-up resources

- [Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract) — the writable container filesystem is in-memory and does not survive an instance stop.
- [Cloud Storage volume mounts for Cloud Run](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts) — the missing file locking, FUSE limitations, write behavior, and volume removal commands.
- [Cloud Storage FUSE overview](https://docs.cloud.google.com/storage/docs/cloud-storage-fuse/overview) — explicitly says it is not POSIX-compliant and should not be used as a database backend.
- [SQLite Write-Ahead Logging](https://sqlite.org/wal.html) — why WAL requires processes on one host and does not work over a network filesystem.
- [SQLite over a network](https://www.sqlite.org/useovernet.html) — the nuanced version: network filesystem locking/sync behavior varies; prefer a client/server database across a network.
- [Using Google Cloud services from Cloud Run](https://docs.cloud.google.com/run/docs/integrate/using-gcp-services) — Google's own storage matrix: Firestore/Cloud SQL for data, Cloud Storage for objects.
- [Firestore transactions](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions) — retries, atomicity, and why the duplicate-name write is race-safe.
- [Firestore locations](https://docs.cloud.google.com/firestore/docs/locations) — choose close to compute; the database location is immutable.
- [Firestore pricing](https://cloud.google.com/firestore/pricing) — the free daily quota and the per-document-read math behind the polling footgun.
- [Cloud Run pricing](https://cloud.google.com/run/pricing) — scale-to-zero/request billing and the monthly free tier.
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing) — free storage allowance and the small cross-region transfer cost.
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing) — six active secret versions and 10,000 accesses per month in the free tier.
