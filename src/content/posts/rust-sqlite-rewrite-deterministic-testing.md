---
title: "The Rust SQLite rewrite's real bet isn't Rust — it's how it's tested"
description: "Turso is rewriting SQLite in Rust, but the interesting part is deterministic simulation testing — and why that's the only thing that could plausibly match SQLite's reliability."
pubDate: 2026-06-20
tags: ["rust", "databases", "testing", "til"]
draft: false
---

I reach for SQLite *because* it's boring. It's a single file, no server, no
daemon, and it has a reputation as one of the most thoroughly tested pieces of
software on earth. When I embed a database in something small, "boring and
correct" is the entire feature. So a headline like "we're rewriting SQLite in
Rust" normally makes me roll my eyes — rewriting the most-tested C codebase in
existence is the kind of thing that sounds great on a conference slide and ends
in tears.

Then I actually read how [Turso](https://turso.tech/blog/introducing-limbo-a-complete-rewrite-of-sqlite-in-rust)
is doing it (the project was called Limbo, now just Turso), and the interesting
part wasn't Rust at all. Rust gets the headline; the actual bet is on a testing
strategy. And it's the only version of "rewrite SQLite" that isn't obviously
doomed.

## The thing you can't rewrite

Here's what people miss about SQLite. The C code is the easy part to copy — it's
public, it's well-structured, the file format and SQL semantics are documented.
What makes SQLite *SQLite* isn't the 155 KSLOC of library code. It's the
[testing](https://www.sqlite.org/testing.html).

The numbers are genuinely absurd. SQLite ships with **590 times as much test
code as library code** — about 92 *million* lines of tests against ~156
thousand lines of actual database. Its proprietary TH3 harness hits **100%
branch coverage and 100% MC/DC coverage** of the core library. MC/DC is the
coverage standard used for avionics software — the "this code flies a plane"
bar. That's not an accident of a big company throwing money at QA; it's 25 years
of every weird bug, every corrupt-file report, every power-loss-mid-write
scenario getting turned into a permanent regression test.

And here's the catch for anyone rewriting it: **TH3 is closed-source.** You
can clone the library logic all day, but you can't inherit the test suite that
earned its reputation. So if you reimplement SQLite, you start from zero on the
one axis that actually matters. You have a database that passes `SELECT 1` and
zero of the 25 years of accumulated paranoia.

That's the real moat. Not the code — the tests.

## DST: testing as a simulator, not a pile of cases

Turso's answer is **deterministic simulation testing** (DST), a technique
pioneered by [FoundationDB](https://www.youtube.com/watch?v=4fFDFbi3toc) and now
offered as a service by [Antithesis](https://antithesis.com/). Instead of
writing more test *cases*, you build the database so its entire world is
controllable, then run it inside a simulator.

The trick is removing every source of nondeterminism. The clock, the random
number generator, thread scheduling, and — crucially — all I/O get routed
through an abstraction the test controls. Once nothing in the system can do
anything the simulator didn't decide, two things become true:

- You can **simulate years of execution** in minutes: spin the virtual clock,
  reorder events, inject a disk that fails the third write, a `fsync` that lies,
  a process that dies mid-transaction.
- When something breaks, you can **reproduce it 100% of the time** from a seed.
  No "it only fails on CI every 40th run." The same seed replays the exact same
  failure, byte for byte.

Conceptually — this is a sketch, not Turso's actual API — the database talks to
an injected I/O layer instead of the real one:

```rust
// real run: actually hit the disk
let io = PlatformIO::new();

// test run: a simulated disk the harness fully controls
let io = SimIO::new(seed)
    .fail_write_after(3)     // 4th write returns an error
    .reorder_completions()   // async ops complete out of submission order
    .torn_write(0.01);       // 1% of writes land half-flushed

// same database code, deterministic world — replay the seed to reproduce
```

This is exactly why Turso went **fully async with `io_uring`** on Linux — not
just for throughput, but because a clean async I/O boundary is what makes the
whole system simulatable in the first place. The architecture and the testing
strategy are the same decision.

## Why this could actually exceed SQLite

The claim Turso makes — and the part I find genuinely interesting — is that DST
could be *more* reliable than accumulating test cases, not just a catch-up move.

SQLite's tests are a museum of real bugs: every entry is something that actually
went wrong once. That's powerful but inherently backward-looking — you test the
failures you've already seen. A simulator can explore orderings and faults
**nobody has hit yet**, because generating "the fsync succeeds but the directory
entry doesn't" is a one-line fault injection, not a story you have to wait for a
user to live through. The Antithesis partnership reportedly already shook out a
partial-write bug in Turso's `io_uring` path — exactly the kind of rare,
ordering-dependent corruption that conventional tests almost never trigger.

So the bet isn't "Rust makes it safe" (memory safety doesn't save you from a
transaction that half-commits across a crash). The bet is: *if you build
simulatability in from day one, you can manufacture reliability faster than
SQLite accumulated it.*

## When not to get excited

I want this to work, which is exactly why I'm keeping the skepticism switched on.

- **It's beta.** Turso is not a drop-in replacement for production SQLite today,
  full stop. "No bugs so far" from early adopters is not the same as TH3's
  guarantees.
- **New architecture means new bug surface.** Concurrent writes via MVCC and a
  fully async engine are real features SQLite doesn't have — but they're also new
  code paths SQLite never had to make correct. You don't get the upside without
  the new failure modes.
- **DST is a method, not a coverage number.** "We do simulation testing" doesn't
  yet mean "100% MC/DC of the core, validated for 25 years." A good simulator
  with a weak seed corpus still misses things. The technique is promising; the
  *coverage* has to be earned, and that takes time.
- **There's a company attached.** SQLite is public-domain and run by a foundation
  with a famously conservative charter. Turso is VC-backed. That's not
  disqualifying, but "will this be maintained and aligned with my interests in
  ten years" is a different question for a startup than for SQLite.

My rule of thumb: **if you're choosing SQLite because it's boring and proven,
keep choosing SQLite for now.** But if you've ever wanted concurrent writes,
async I/O, or vector search in that single-file package — watch Turso, and watch
the testing story specifically. Because the day their DST coverage is credibly
in TH3's league is the day "rewrite SQLite in Rust" stops being a punchline and
starts being a real choice.

The code was always the easy part. Whether they can rebuild the *trust* is the
whole game — and at least they're betting on the right thing.

## Follow-up resources

- [Introducing Limbo: a complete rewrite of SQLite in Rust](https://turso.tech/blog/introducing-limbo-a-complete-rewrite-of-sqlite-in-rust) — Turso's announcement, including the DST and Antithesis section.
- [How SQLite Is Tested](https://www.sqlite.org/testing.html) — the source of the 590× and 100% MC/DC figures. Worth reading in full.
- [Deterministic Simulation Testing (Antithesis)](https://antithesis.com/docs/introduction/how_antithesis_works/) — how a system-level DST framework actually works.
- [FoundationDB's testing talk](https://www.youtube.com/watch?v=4fFDFbi3toc) — the talk that put DST on the map.
- [Deep dive into Turso on Hacker News](https://news.ycombinator.com/item?id=46810950) — the skeptical counterpoints, especially on TH3 and production-readiness.
