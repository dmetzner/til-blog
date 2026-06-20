---
title: "Trading four linters for two: Biome and Mago vs my Prettier/ESLint/PHPStan/Fixer stack"
description: "A theoretical, table-by-table comparison of the Rust linting toolchains Biome and Mago against the Node/PHP incumbents — before I migrate a real project and report the actual numbers."
pubDate: 2026-06-21
tags: ["rust", "php", "tooling", "til"]
draft: false
---

Every project I maintain runs four separate code-quality tools. On the JS/TS
side: [Prettier](https://prettier.io) to format and [ESLint](https://eslint.org)
to lint. On the PHP side: [PHPStan](https://phpstan.org) to find type-level bugs
and [PHP-CS-Fixer](https://cs.symfony.com) to format. Four tools, four config
files, two ecosystems, and a CI lint stage that takes long enough that I tab away
to do something else while it runs.

None of that is broken. It's just *a lot* — and it's slow. So when I noticed that
both ecosystems are independently growing a single fast Rust binary to do most of
that work — [Biome](https://biomejs.dev) on the JS side, [Mago](https://mago.carthage.software)
on the PHP side — the symmetry got my attention. Two languages, the same idea:
collapse the toolchain into one oxidized binary and make it fast enough that you
stop tabbing away.

This post is the paper comparison I did before committing to anything. **It is
explicitly theoretical.** I haven't migrated yet. In a few weeks I'm moving
[Catroweb](https://github.com/Catrobat/Catroweb) — a real Symfony + JS project,
not a toy — over to these tools and I'll report what actually happened: real CI
numbers, real rule parity, real false positives. So treat every speed multiplier
below as a *published benchmark, not my measurement*. The point today is to map
the terrain and find where the risk is.

## The stack today

| Tool | Language | Job | Written in |
|------|----------|-----|------------|
| Prettier | JS/TS/CSS/JSON | Formatting | JavaScript |
| ESLint | JS/TS | Linting (style + bug patterns) | JavaScript |
| PHP-CS-Fixer | PHP | Formatting / code style | PHP |
| PHPStan | PHP | Static analysis (type-level bugs) | PHP |

Four tools, but really three *jobs*: format, lint, and deep-analyze. Note the
asymmetry — JS has no widely-used standalone "type-level analyzer" the way PHP
has PHPStan, because for JS that role is mostly played by `tsc` plus
typescript-eslint's type-aware rules. Hold onto that; it's where the comparison
gets interesting.

## What maps to what

| Incumbent | Rust replacement | Clean swap? |
|-----------|------------------|-------------|
| Prettier | Biome (formatter) | Yes — ~97% Prettier-compatible output |
| ESLint | Biome (linter) | Mostly — 500+ rules, but type-aware rules are shallower |
| PHP-CS-Fixer | Mago (formatter) | Yes — opinionated, convention-over-config |
| PHPStan | Mago (analyzer) | **Not yet** — this is the risky one |

Two of these are easy. Formatting is a solved problem: if Biome and Mago produce
output that's stable and close enough to what I have now, the diff is a one-time
cost and then I never think about it again. Linting at the style/syntax level is
likewise a comfortable swap.

The bottom-right cell is the whole story. That's where I need real data.

## Speed — the headline, with an asterisk

This is what everyone leads with, so here it is — and here's the asterisk:
**these are vendors' and bloggers' benchmarks on their repos, not mine.**

| Comparison | Claimed speedup | Source of the number |
|------------|-----------------|----------------------|
| Biome vs Prettier (format) | ~35× | Biome's own benchmark, ~171k lines / 2.1k files |
| Biome vs ESLint (lint) | 10–20× (one bench: 0.8s vs 45s on 10k files) | community migration write-ups |
| Mago vs PHP-CS-Fixer / PHPStan | ~30–40× | reported on a 2,400-file Laravel app |

Even if the real numbers are half of these, that's the difference between a CI
lint stage you wait on and one you don't notice. The mechanism is unsurprising:
Rust binaries with no interpreter startup, real parallelism across cores, and no
`node_modules` resolution tax. The interesting question isn't *whether* they're
faster — they obviously are — it's whether you give anything up to get there.

## Where it breaks down: the analysis gap

Here's the part that took me longest to understand, and the part I'd tell anyone
eyeing this swap to focus on.

**Formatting and style-linting are about the shape of code. Static analysis is
about its meaning.** PHPStan and typescript-eslint's type-aware rules don't just
read your file — they build a model of your types and follow them across function
boundaries to prove things like "this can be `null` here" or "this method doesn't
exist on that union." That's years of accumulated inference depth.

- **Biome v2** (current stable v2.5, ~508 rules) added type-aware linting
  *without* requiring the TypeScript compiler — impressive,
  and fast, but it's Biome's own inference, not full `tsc` type resolution. The
  deepest typescript-eslint rules that need a complete type graph aren't all
  replicated. For most projects Biome covers the common cases; for the gnarly
  type-level rules, you may still keep `tsc`/typescript-eslint around.
- **Mago** (current v1.30, June 2026) has moved faster than I expected: it now
  ships an actual *static analyzer* alongside its linter and formatter, aiming
  squarely at PHPStan/Psalm territory. But "ships an analyzer" and "matches
  PHPStan's depth and rule ecosystem on a large real codebase" are different
  claims, and only the second one matters for replacing PHPStan in production.

So my working hypothesis going into the Catroweb migration:

> Format and lint — swap with confidence. Deep static analysis — run Mago's
> analyzer *alongside* PHPStan first, diff the findings, and only drop PHPStan
> if Mago catches what it catches. Same for Biome vs typescript-eslint's
> type-aware rules.

That hedge — keep the old analyzer until the new one earns its retirement — is
the entire low-risk path here. The speed win on format+lint is free; the analysis
layer has to be *proven*, not assumed.

## Config and developer experience

| Dimension | Old stack | Biome / Mago |
|-----------|-----------|--------------|
| Config files | 4 (`.prettierrc`, `eslint.config.js`, `.php-cs-fixer.php`, `phpstan.neon`) | ~2 (`biome.json`, `mago.toml`) |
| Install footprint | ESLint+Prettier pull a `node_modules` tree; PHP tools via Composer | single static binary per language |
| Philosophy | highly configurable (esp. ESLint, PHP-CS-Fixer) | convention over configuration, à la `gofmt`/`rustfmt` |
| Editor support | mature everywhere | Biome mature; Mago has a JetBrains/PhpStorm plugin and LSP, newer |

The convention-over-config stance is a genuine trade, not pure upside. ESLint and
PHP-CS-Fixer let you bend almost any rule; Biome and Mago deliberately give you
fewer knobs because "there's one way to format this" is the point. If your team
has strong idiosyncratic style rules encoded over years, expect to *lose* some of
them. For me that's mostly a relief — fewer bikeshed configs — but if you've got a
50-rule custom ESLint config doing load-bearing work, audit it before you assume
parity.

## Maturity check

| Tool | Version (mid-2026) | Status | Notes |
|------|--------------------|--------|-------|
| Biome | v2.5 | Stable, widely adopted | Forked from Rome; in production at large orgs |
| Mago | v1.30 | Stable, fast-moving | Younger; analyzer is the newest, least-proven piece |
| ESLint | v9 (flat config) | Mature | Type-aware rules via typescript-eslint |
| PHPStan | v2.x | Mature | The depth benchmark for PHP analysis |

Biome is past the "is this safe?" question — it's a default for new JS projects
now. Mago is solid for format+lint and improving quickly on analysis, but it's
the younger tool and the analyzer is where I'd keep my guard up.

## What I'll actually measure on Catroweb

So the experiment isn't "is Rust faster" (yes). It's a checklist:

1. **Wall-clock CI lint+format time**, old stack vs new, on the same runner.
2. **Format diff size** — how much churn does the one-time Biome/Mago reformat create?
3. **Lint rule parity** — which ESLint / PHP-CS-Fixer rules have no Biome/Mago equivalent?
4. **Analysis parity** — run Mago's analyzer next to PHPStan and count what each finds that the other misses. Same for Biome vs typescript-eslint.
5. **False positives** — the silent tax that makes a tool annoying regardless of speed.

If format+lint comes out clean and the analysis layer is even 80% of PHPStan,
this is an easy win. If the analyzer misses real bugs PHPStan catches, then the
honest outcome is a *hybrid*: Biome + Mago for the fast format/lint loop,
PHPStan/typescript-eslint kept for deep analysis. That's still fewer moving parts
on the hot path, which is most of the value.

## When not to bother (yet)

- **Your lint stage is already fast.** A small repo where ESLint runs in two
  seconds doesn't need this. The win scales with codebase size.
- **You lean hard on PHPStan/Psalm's deepest rules or a big custom ESLint config.**
  The analysis and configurability gaps will bite you. Wait, or run hybrid.
- **You can't stomach a one-time reformat diff** in a repo with lots of in-flight
  branches — the format churn will cause merge pain. Time it for a quiet window.

My rule of thumb going in: **swap the format and lint layer now, treat the
analysis layer as on probation.** The speed is real and the unification is real;
the only thing I refuse to take on faith is whether a year-old Rust analyzer
matches a tool that's been finding PHP type bugs for the better part of a decade.

That's the theory. In a few weeks I'll have run it against a real codebase and
I'll post the numbers — including whichever part of this turns out to be wrong.

## Follow-up resources

- [Biome — official site](https://biomejs.dev/) — formatter + linter, language support, benchmarks.
- [Mago — official docs](https://mago.carthage.software/) — the PHP toolchain: linter, formatter, analyzer.
- [Mago on GitHub](https://github.com/carthage-software/mago) — release cadence and the analyzer's development.
- [Mago: a blazing fast linter, formatter, and static analyzer for PHP (Laravel News)](https://laravel-news.com/mago) — third-party overview and benchmarks.
- [PHPStan](https://phpstan.org/) and [typescript-eslint](https://typescript-eslint.io/) — the depth benchmarks the Rust analyzers are measured against.
