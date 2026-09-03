---
title: "Four tools do three jobs, and I wait on all of them"
description: "Both my ecosystems grew a single fast binary that replaces most of the code-quality stack. Two thirds of that swap is safe; the third part has to earn it."
pubDate: 2026-06-21
tags: ["rust", "php", "tooling", "til"]
draft: false
---

Every project I maintain runs four separate code-quality tools — two on the
JavaScript side, two on the PHP side. Four config files, two ecosystems, and a
check stage slow enough that I tab away to do something else while it runs.

None of that is broken. It's just *a lot*, and it's slow.

Then I noticed both ecosystems independently growing the same idea: one fast
program, written in Rust, that does most of that work on its own —
[Biome](https://biomejs.dev) for JavaScript, [Mago](https://mago.carthage.software)
for PHP.

The thing worth seeing is that my four tools only do **three jobs**. One makes
code look the same everywhere. One catches sloppy patterns. And one reasons about
what the code *means* — follows the values through the program to prove things
like "this can be empty here, and you didn't check". The first two are about the
shape of code. The third is about its meaning.

Shape is a solved problem. If the new tool lays code out consistently, the change
costs one big ugly commit and then I never think about it again. Meaning is years
of accumulated depth in the old tools, and a young program claiming the same
ground is a claim, not a fact.

So the plan is a hedge rather than a migration: **swap the shape layer now, put
the meaning layer on probation.** Run the new analyzer *beside* the old one, diff
what each finds, and only retire the old one if the new one catches what it
catches. If it doesn't, the honest outcome isn't failure — it's a hybrid: the fast
tools on the everyday loop, the old analyzer kept for the deep pass. That's still
fewer moving parts where it matters.

One thing I want to be straight about: every speed multiplier you'll read for
these tools — and they're enormous — comes from someone else's benchmark on
someone else's code. Not mine. Even at half the claimed figures it's the
difference between a check stage you wait on and one you don't notice.

The new tools deliberately give you
*fewer* knobs; "there's one way to format this" is the point. The old ones let you
bend almost any rule, and if your team has years of idiosyncratic style encoded in
config, expect to lose some of it. For me that's mostly a relief. If you've got
fifty custom rules doing load-bearing work, audit them before you assume parity.

## When not to bother yet

- **Your check stage is already fast.** A small repo doesn't need this; the win
  scales with size.
- **You lean on the deepest analysis rules, or a big custom config.** That's
  exactly the part that isn't proven. Wait, or run both.
- **You can't stomach one giant reformat commit** in a repo full of in-flight
  branches. Time it for a quiet week.

That's the theory, written before touching anything real. I then ran it against
[Catroweb](https://github.com/Catrobat/Catroweb) — a genuine Symfony and
JavaScript codebase, not a toy — and
[the numbers came out differently than I expected](/posts/catroweb-biome-mago-real-numbers/).

## The tables

Where things stood mid-2026, and what maps onto what.

| Tool | Language | Job | Written in |
|------|----------|-----|------------|
| Prettier | JS/TS/CSS/JSON | Formatting | JavaScript |
| ESLint | JS/TS | Linting (style + bug patterns) | JavaScript |
| PHP-CS-Fixer | PHP | Formatting / code style | PHP |
| PHPStan | PHP | Static analysis (type-level bugs) | PHP |

Note the asymmetry: JS has no widely-used standalone deep analyzer the way PHP has
PHPStan, because for JS that role is played by `tsc` plus typescript-eslint's
type-aware rules.

| Incumbent | Rust replacement | Clean swap? |
|-----------|------------------|-------------|
| Prettier | Biome (formatter) | Yes — ~97% Prettier-compatible output |
| ESLint | Biome (linter) | Mostly — 500+ rules, but type-aware rules are shallower |
| PHP-CS-Fixer | Mago (formatter) | Yes — opinionated, convention-over-config |
| PHPStan | Mago (analyzer) | **Not yet** — this is the risky one |

Published speed claims:

| Comparison | Claimed speedup | Source of the number |
|------------|-----------------|----------------------|
| Biome vs Prettier (format) | ~35× | Biome's own benchmark, ~171k lines / 2.1k files |
| Biome vs ESLint (lint) | 10–20× (one bench: 0.8s vs 45s on 10k files) | community migration write-ups |
| Mago vs PHP-CS-Fixer / PHPStan | ~30–40× | reported on a 2,400-file Laravel app |

The mechanism is unsurprising: native binaries with no interpreter startup, real
parallelism, no `node_modules` resolution tax.

| Dimension | Old stack | Biome / Mago |
|-----------|-----------|--------------|
| Config files | 4 (`.prettierrc`, `eslint.config.js`, `.php-cs-fixer.php`, `phpstan.neon`) | ~2 (`biome.json`, `mago.toml`) |
| Install footprint | ESLint+Prettier pull a `node_modules` tree; PHP tools via Composer | single static binary per language |
| Philosophy | highly configurable | convention over configuration, à la `gofmt`/`rustfmt` |
| Editor support | mature everywhere | Biome mature; Mago has a JetBrains plugin and LSP, newer |

| Tool | Version (mid-2026) | Status | Notes |
|------|--------------------|--------|-------|
| Biome | v2.5 | Stable, widely adopted | Forked from Rome; in production at large orgs |
| Mago | v1.30 | Stable, fast-moving | Younger; analyzer is the newest, least-proven piece |
| ESLint | v9 (flat config) | Mature | Type-aware rules via typescript-eslint |
| PHPStan | v2.x | Mature | The depth benchmark for PHP analysis |

Biome v2's type-aware linting works *without* the TypeScript compiler — fast, but
it's Biome's own inference, so the deepest typescript-eslint rules aren't all
replicated.

The five things worth measuring, in order: wall-clock check time on the same
runner; the size of the one-time reformat diff; lint rule parity; analysis parity
run side by side; and false positives, the silent tax that makes a tool annoying
no matter how fast it is.

## Follow-up resources

- [Biome — official site](https://biomejs.dev/) — formatter + linter, language support, benchmarks.
- [Mago — official docs](https://mago.carthage.software/) — the PHP toolchain: linter, formatter, analyzer.
- [Mago on GitHub](https://github.com/carthage-software/mago) — release cadence and the analyzer's development.
- [Mago: a blazing fast linter, formatter, and static analyzer for PHP (Laravel News)](https://laravel-news.com/mago) — third-party overview and benchmarks.
- [PHPStan](https://phpstan.org/) and [typescript-eslint](https://typescript-eslint.io/) — the depth benchmarks the Rust analyzers are measured against.
