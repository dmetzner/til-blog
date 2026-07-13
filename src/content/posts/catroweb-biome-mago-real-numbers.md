---
title: "The follow-up: Biome shipped, Mago didn't — what the Catroweb migration actually taught me"
description: "Three weeks ago I promised real numbers instead of vendor benchmarks. Here they are: Biome replaced ESLint+Prettier and stuck, Mago got screened out before it ever ran, and the thing that ate my afternoon was a supply-chain scanner nobody asked about."
pubDate: 2026-07-13
tags: ["rust", "php", "tooling", "til"]
draft: false
---

Three weeks ago I [wrote up a paper comparison](/posts/biome-mago-vs-prettier-eslint-phpstan/)
of two Rust linting toolchains — [Biome](https://biomejs.dev) on the JS side,
[Mago](https://mago.carthage.software) on the PHP side — against the incumbents I
actually run: Prettier, ESLint, PHPStan, and PHP-CS-Fixer. That post was
explicitly theoretical. Every speed number in it was somebody else's benchmark on
somebody else's repo. I promised to migrate a real project —
[Catroweb](https://github.com/Catrobat/Catroweb), a Symfony + JS codebase with a
real CI pipeline and real maintainers — and report what happened.

This is that report. The short version has a twist I didn't see coming: **Biome
shipped and I'd do it again. Mago never ran — I screened it out before the
migration, and I'm glad I did. And the part that actually cost me an afternoon
wasn't either tool; it was a supply-chain scanner that fired because I regenerated
a lockfile.**

## What I said I'd measure

The first post committed to a five-point checklist. I'm going to grade myself
against it honestly, including the items I couldn't complete and why.

1. Wall-clock CI lint+format time, old vs new.
2. One-time format diff / churn size.
3. Lint rule parity — which incumbent rules have no Rust equivalent.
4. Analysis parity — run Mago's analyzer next to PHPStan and diff the findings.
5. False positives.

Spoiler: I got clean answers on 1, 3, and 5, a partial on 2, and item 4 turned
into a different question entirely.

## Biome: shipped, and I'd do it again

The JS side went in as a single PR. ESLint and Prettier came out; Biome 2.5.2
went in as the formatter and linter for `.js`/`.ts`/`.json`.

**The speed (item 1).** On the combined JS + asset lint gate, Biome came in around
**5.2× faster** than the ESLint + Prettier setup it replaced. That's below the
30–40× headline numbers I quoted from vendor benchmarks in the last post — and
that gap is the whole lesson. Those benchmarks isolate the formatter on a
hundred-thousand-line repo with a warm cache and nothing else in the stage. My
real gate does other work, runs on a shared CI runner, and pays fixed overhead
that no linter can delete. 5.2× is what the speedup looks like *after* it's
diluted by everything a real pipeline does. It's still the difference between a
stage I waited on and one I don't notice — which was the entire point — but if
you're budgeting off the vendor's number, halve it and then halve it again.

**Rule parity (item 3).** This is where "four tools to two" turned out to be
marketing, including my own. Biome did *not* absorb everything:

- **Prettier stayed** — for Markdown and YAML. Biome doesn't format those, so
  Prettier is still in the tree, just scoped down to `*.md`/`*.yaml`.
- **Stylelint stayed** — Biome doesn't do SCSS, and Catroweb has a real
  stylesheet. So SCSS linting is untouched.

So the honest headline isn't "two tools replaced four." It's "Biome replaced the
two JS-specific tools cleanly, and the other two stayed because they cover file
types Biome doesn't." That's still a win — the hot path (the JS lint+format loop
every developer hits) got faster and simpler — but the config-file count didn't
collapse the way the paper comparison implied. Believe the tools about what they
lint before you plan the retirement party.

**Format churn (item 2, partial).** The one-time reformat was a bounded, single
commit — the usual cost of adopting an opinionated formatter — and it was
uneventful. I don't have a clean isolated churn number to give you, because it
landed in the same branch as the tool swap and the merge below, and I'm not going
to reverse-engineer a precise figure I didn't measure cleanly. If churn is your
blocker, the real advice from the last post holds: time it for a quiet window with
few in-flight branches.

## The surprise: false positives came from where I wasn't looking (item 5)

Here's the afternoon-eater, and it's a good TIL in its own right.

Migrating Biome meant regenerating `yarn.lock` — ESLint's dependency subtree came
out, Biome's went in. Routine. Except Catroweb runs
[SafeDep `vet`](https://github.com/safedep/vet-action) as a supply-chain gate on
every PR, and the lockfile rewrite surfaced two *transitive* dependencies
(`ignore` and `json-schema-traverse`) that the scanner's bundled policy flagged as
**unmaintained** — its `ossf-unmaintained` filter fails the build when a package's
OpenSSF Scorecard "Maintained" score is 0.

Both packages are stable, ubiquitous, and low-churn *because they're finished*,
not because they're abandoned. That's a classic scorecard false positive: "no
recent commits" and "unmaintained" are not the same thing, but the metric can't
tell them apart. My Biome PR was red for a reason that had nothing to do with
Biome, ESLint, formatting, or linting — it was a maintenance heuristic firing on
two deep transitive deps that happened to become newly *visible* when the lockfile
moved.

The fix was to stop using the bundled policy wholesale and commit an explicit one:

```yaml
# .github/vet-policy.yaml — bundled default minus the maintenance-scorecard filter.
# Still enforces: critical/high vulns, malware, risky licenses, low popularity,
# dangerous release workflows. Drops only ossf-unmaintained (false-positive prone
# on stable low-activity transitive deps).
filters:
  - name: critical-or-high-vulns
    check_type: CheckTypeVulnerability
    value: vulns.critical.exists(p, true) || vulns.high.exists(p, true)
  - name: osv-malware
    check_type: CheckTypeMalware
    value: vulns.all.exists(v, v.id.startsWith("MAL-"))
  # …popularity, licenses, dangerous-workflow kept; ossf-unmaintained removed.
```

The lesson generalizes past this one scanner: **a lockfile migration re-runs every
policy your repo has against a freshly-resolved dependency graph.** The tool you're
adopting is rarely the thing that turns CI red. The second-order effects on
everything *else* that inspects your dependencies are. Budget for that.

## Mago: I didn't migrate it, and that's the finding

Item 4 was supposed to be "run Mago's analyzer next to PHPStan and diff the
findings." I never got there — because I applied a rule I hold hard: **if a
replacement isn't feature-complete for what I actually run, I don't adopt it, even
partially.** So before migrating anything I audited Mago (v1.43) against
Catroweb's *actual* PHP config, and it didn't clear the bar. Screening it out
cleanly is a more useful result than a half-migration would have been.

Two gaps did it.

**The formatter is close but not a drop-in.** Catroweb's PHP-CS-Fixer config runs
`@PhpCsFixer` + `@Symfony` + `strict_param` at 2-space indent. Mago's formatter
handles the *shape* fine — 2-space is supported, quotes/braces/trailing-commas/
import-sorting all covered. What it doesn't do is the *semantic* fixers that
ruleset leans on:

| PHP-CS-Fixer rule Catroweb uses | Mago formatter equivalent |
|---|---|
| Remove unused imports | ❌ none |
| Normalize PHPDoc blocks | ❌ none |
| Order class elements (consts→props→methods) | ❌ none |
| `strict_param` (force `strict` arg) | ❌ none |
| `native_function_invocation` | ⚠️ inverts it (strips the `\`, opposite policy) |

Those aren't cosmetic. They're the fixers that keep diffs clean and enforce house
style automatically. A formatter that can't do them isn't a replacement for the
one that does — it's a second formatter I'd have to run *alongside* the first,
which defeats the entire purpose.

**The analyzer isn't ready for a framework app.** This was the risky cell in the
last post's map, and it's exactly where the risk was. Mago's analyzer does real
type inference, reads `@psalm`/`@phpstan` annotations, and has a baseline. But it
has **no Symfony/Doctrine type-provider** — the framework integrations live only
in its linter, not its analyzer. On a Symfony app, that means the analyzer can't
reason about the container, magic repository methods, or Doctrine's dynamic return
types, so it produces a false-positive flood against code PHPStan (with
`phpstan-symfony` + `phpstan-doctrine`) understands fine. Add no PHPStan-style
level ladder and no incremental cache, and it's not a tool I can drop PHPStan for
today.

So the honest answer to "did Mago's analysis match PHPStan?" is: **I couldn't run
the comparison, because the analyzer doesn't model the framework the code is built
on.** That's not a knock on the project — it's young and moving fast, single
maintainer doing genuinely impressive work — it's a statement about *fit* for this
codebase right now.

## The scorecard

| Checklist item | Result |
|---|---|
| 1. CI speed | ✅ ~5.2× on the JS gate — real, but a fraction of the vendor benchmark |
| 2. Format churn | 🟡 one-time, bounded, uneventful — no clean isolated number |
| 3. Rule parity | ✅ Biome replaced ESLint+Prettier for JS; Prettier (md/yaml) + Stylelint (SCSS) stayed |
| 4. Analysis parity | ⛔ not run — Mago's analyzer has no Symfony/Doctrine model, so the comparison was moot |
| 5. False positives | ✅ found — but from the *supply-chain scanner*, triggered by the lockfile rewrite, not from Biome |

## What would flip Mago from "no" to "yes"

I'm not done with Mago — I'm waiting on it. The two concrete triggers that would
get me to re-run this migration:

1. The formatter ships **unused-import removal, PHPDoc normalization, and
   class-element ordering** (the fixers that make it a real PHP-CS-Fixer drop-in).
2. The analyzer ships a **Symfony/Doctrine type-provider**, so it can be run
   next to PHPStan on a framework app without drowning in false positives.

Until then the PHP side stays on PHP-CS-Fixer + PHPStan + Psalm, and I'll check
back when a release notes either of those.

## The meta-lesson

My rule of thumb in the last post was "swap format and lint now, treat deep
analysis as on probation." The migration confirmed it — but sharpened it into
something more general:

> The Rust rewrite is only as done as its *least glamorous* feature. Speed is the
> easy 90%. The semantic fixers, the framework type-providers, the file types
> nobody demos — that's where "replaces X" quietly becomes "replaces most of X,"
> and only your real config tells you which one you're getting.

Biome cleared that bar for my JS. Mago hasn't yet for my PHP. And the fastest way
to learn the difference was to stop reading benchmarks and point a real pipeline
at both.

## Resources

- [Biome — official site](https://biomejs.dev/) — the formatter/linter that shipped.
- [Mago — official docs](https://mago.carthage.software/) — the PHP toolchain I'm waiting on; watch the analyzer's framework support.
- [SafeDep vet-action](https://github.com/safedep/vet-action) — the supply-chain gate, and how to point it at a custom policy.
- [OpenSSF Scorecard — Maintained check](https://github.com/ossf/scorecard/blob/main/docs/checks.md#maintained) — why "no recent commits" trips the unmaintained heuristic.
- [Part 1: the paper comparison](/posts/biome-mago-vs-prettier-eslint-phpstan/) — the theory this post tests.
