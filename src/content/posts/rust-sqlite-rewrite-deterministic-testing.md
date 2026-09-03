---
title: "The moat isn't the code — it's the tests"
description: "SQLite's real moat is its test suite. Turso's Rust rewrite is trying to recreate that confidence with deterministic simulation."
pubDate: 2026-06-20
tags: ["rust", "databases", "testing", "til"]
draft: false
---

I reach for SQLite *because* it's boring. One file, no server, and a reputation as
one of the most thoroughly tested pieces of software on earth. So "we're
rewriting SQLite in Rust" normally makes me roll my eyes — reimplementing the
most-tested C codebase in existence sounds great on a conference slide and ends in
tears.

Then I read how [Turso](https://turso.tech/blog/introducing-limbo-a-complete-rewrite-of-sqlite-in-rust)
is doing it. The rewrite matters for its testing strategy, not its language.

The C code is the easy half to copy: it's public, well structured, and the file
format is documented. What makes SQLite *SQLite* is the testing. It ships roughly
**590 times as much test code as library code** — about 92 million lines of tests
against 156 thousand lines of database — and its `TH3` harness reaches 100%
branch and MC/DC coverage of the core, MC/DC being the standard used for avionics.
That's not money thrown at QA; it's 25 years of every corrupt file and every
power-loss-mid-write turning into a permanent regression test.

And `TH3` is closed-source. So you can clone the logic all day and still start
from zero on the only axis that matters: a database that passes `SELECT 1` and has
none of the accumulated paranoia. That's the moat. Not the code — the tests.

Turso's answer is **deterministic simulation testing**, pioneered by
[FoundationDB](https://www.youtube.com/watch?v=4fFDFbi3toc). Instead of writing
more test *cases*, you build the database so that its entire world is
controllable, then run it inside a simulator. The clock, the random numbers, the
thread scheduling and every read and write go through something the test owns.
Once nothing in the system can act on its own, two things follow: you can
simulate years of execution in minutes — a disk that fails the third write, an
`fsync` that lies, a process that dies mid-transaction — and any failure replays
from a seed, identically, forever. No "it only breaks on CI every fortieth run".

A sketch of the shape (not Turso's actual API):

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

Which is why they rebuilt how the database talks to the disk in the first place:
pushing everything through one narrow, replaceable channel is what makes the fake
world possible. The architecture and the testing strategy are the same decision.

The claim I find genuinely interesting is that this could end up *better* than
accumulating cases. SQLite's suite is a museum of real bugs — powerful, and
inherently backward-looking. A simulator can explore orderings nobody has hit
yet, because "the write succeeds but the directory entry doesn't" is a one-line
fault injection rather than a story you wait for a user to live through. So the
bet isn't "Rust makes it safe" — memory safety doesn't save you from a
transaction that half-commits across a crash. It's: *build simulatability in from
day one and you can manufacture reliability faster than SQLite accumulated it.*

I want that to work, which is why the skepticism stays switched on:

- **It's beta.** Not a drop-in replacement today. "No bugs so far" from early
  adopters isn't a guarantee.
- **New architecture, new bug surface.** Concurrent writes and a fully async
  engine are real features SQLite lacks — and new code paths SQLite never had to
  make correct.
- **Simulation is a method, not a coverage number.** A good simulator with a weak
  seed corpus still misses things. The technique is promising; the coverage has to
  be earned, and that takes years.
- **There's a company attached.** SQLite is public-domain under a foundation with
  a famously conservative charter. "Will this still suit me in ten years" is a
  different question for a startup.

My rule of thumb: if you're choosing SQLite because it's boring and proven, keep
choosing SQLite. But if you've ever wanted concurrent writes or async I/O in that
single-file package, watch the *testing* story specifically — the day its coverage
is credibly in `TH3`'s league is the day this stops being a punchline. The code
was always the easy part.

## Follow-up resources

- [Introducing Limbo: a complete rewrite of SQLite in Rust](https://turso.tech/blog/introducing-limbo-a-complete-rewrite-of-sqlite-in-rust) — Turso's announcement, including the simulation-testing section.
- [How SQLite Is Tested](https://www.sqlite.org/testing.html) — the source of the 590× and 100% MC/DC figures. Worth reading in full.
- [Deterministic Simulation Testing (Antithesis)](https://antithesis.com/docs/introduction/how_antithesis_works/) — how a system-level framework actually works.
- [FoundationDB's testing talk](https://www.youtube.com/watch?v=4fFDFbi3toc) — the talk that put the technique on the map.
- [Deep dive into Turso on Hacker News](https://news.ycombinator.com/item?id=46810950) — the skeptical counterpoints, especially on TH3 and production-readiness.
