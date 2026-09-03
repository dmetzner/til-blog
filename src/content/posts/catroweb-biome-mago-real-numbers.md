---
title: "One tool shipped, one never ran, and neither turned CI red"
description: "The real migration numbers: 5.2×, not 35×, plus a lockfile regeneration that triggered the supply-chain scanner."
pubDate: 2026-07-13
tags: ["rust", "php", "tooling", "til"]
draft: false
---

Three weeks ago I [wrote up the theory](/posts/biome-mago-vs-prettier-eslint-phpstan/):
two new fast tools, one per language, promising to replace most of my
code-quality stack. Every number in it was somebody else's benchmark on somebody
else's code. Here's what happened when I pointed a real pipeline at both.

**The speed is real and much smaller than advertised.** The JavaScript side went
in as one change, and the check stage came out about **5.2× faster**. The headline
claims I'd quoted were 30–40×. That gap is the useful part: a vendor benchmark
isolates one tool on an enormous codebase with a warm cache and nothing else
running, while my pipeline does other work on a shared machine and pays fixed
costs no tool can delete. Still the difference between a stage I waited on and one
I don't notice — but if you're budgeting off the vendor's figure, halve it and
halve it again.

**"Four tools down to two" was marketing, mine included.** Two of the old tools
stayed, because they handle file types the new one doesn't touch — one for
Markdown and YAML, one for stylesheets. What actually happened is that the two
JavaScript-specific tools were replaced cleanly and the everyday loop got faster.
Believe a tool about what it covers before you plan the retirement party.

**The afternoon went somewhere I wasn't looking.** Swapping tools meant
regenerating the lockfile — and a lockfile rewrite re-runs *every* policy the repo
has against a freshly resolved dependency list. Ours includes a supply-chain
scanner, which failed the build over two tiny libraries deep in the tree, flagged
as **unmaintained** because the score counts recent commits. Both are quiet for
the best possible reason: they're finished. My change was red for reasons that had
nothing to do with the tool I was adopting; those libraries had simply become
newly *visible*.

Which generalises: **the tool you're adopting is rarely what turns CI red — the
second-order effects on everything else that inspects your dependencies are.**

**And the one I didn't migrate.** I hold a rule hard: if a replacement isn't
complete for what I actually run, I don't adopt it partially. So I checked the PHP
tool against the project's real config first, and it didn't clear the bar. Its
formatter gets the *shape* of code right but can't do the cleanup the current one
does automatically — dropping imports nobody uses, tidying doc comments, keeping
class members in order. And its deep analyzer doesn't model the framework the
whole application is built on, so it would bury me in warnings about code the
existing tool understands fine.

So the honest answer to "did the new analyzer match the old one" is that I
couldn't run the comparison at all. Not a knock on the project — it's young, fast
moving, one person doing impressive work — a statement about fit. Screening it out
cleanly beat a half-migration. Two things would make me retry: the formatter
learning those cleanup fixers, and the analyzer learning the framework.

The sharpened rule of thumb:

> A rewrite is only as done as its *least glamorous* feature. Speed is the easy
> 90%. The boring fixers, the framework knowledge, the file types nobody demos —
> that's where "replaces X" quietly becomes "replaces most of X", and only your
> real config tells you which one you're getting.

## The details, tables and config

Against the five-point checklist from part one:

| Checklist item | Result |
|---|---|
| 1. CI speed | ✅ ~5.2× on the JS gate (Biome 2.5.2 replacing ESLint + Prettier) |
| 2. Format churn | 🟡 one-time, bounded, uneventful — no clean isolated number, it landed with the swap |
| 3. Rule parity | ✅ Biome replaced ESLint+Prettier for JS; Prettier stayed for `*.md`/`*.yaml`, Stylelint for SCSS |
| 4. Analysis parity | ⛔ not run — Mago's analyzer has no Symfony/Doctrine type-provider |
| 5. False positives | ✅ found — from [SafeDep `vet`](https://github.com/safedep/vet-action), triggered by the lockfile rewrite |

The flagged dependencies were `ignore` and `json-schema-traverse`, caught by the
`ossf-unmaintained` filter, which fails a build when a package's OpenSSF Scorecard
"Maintained" score is 0. The fix was to drop the bundled policy for an explicit
one:

```yaml
# .github/vet-policy.yaml — bundled default minus the maintenance-scorecard filter.
# Still enforces: critical/high vulns, malware, risky licenses, low popularity,
# dangerous release workflows. Drops only ossf-unmaintained.
filters:
  - name: critical-or-high-vulns
    check_type: CheckTypeVulnerability
    value: vulns.critical.exists(p, true) || vulns.high.exists(p, true)
  - name: osv-malware
    check_type: CheckTypeMalware
    value: vulns.all.exists(v, v.id.startsWith("MAL-"))
  # …popularity, licenses, dangerous-workflow kept.
```

Where Mago (v1.43) fell short of Catroweb's PHP-CS-Fixer config (`@PhpCsFixer` +
`@Symfony` + `strict_param`, 2-space indent). Shape is covered — indentation,
quotes, braces, trailing commas, import sorting. The semantic fixers are not:

| PHP-CS-Fixer rule Catroweb uses | Mago formatter equivalent |
|---|---|
| Remove unused imports | ❌ none |
| Normalize PHPDoc blocks | ❌ none |
| Order class elements (consts→props→methods) | ❌ none |
| `strict_param` (force `strict` arg) | ❌ none |
| `native_function_invocation` | ⚠️ inverts it (strips the `\`, opposite policy) |

Its analyzer does real type inference and reads `@psalm`/`@phpstan` annotations,
but the framework integrations live only in its *linter*: no reasoning about the
container, magic repository methods or Doctrine's dynamic return types, against a
PHPStan setup that has `phpstan-symfony` and `phpstan-doctrine`. No level ladder
and no incremental cache either.

## Resources

- [Biome](https://biomejs.dev/) — the formatter/linter that shipped.
- [Mago](https://mago.carthage.software/) — the PHP toolchain I'm waiting on; watch the analyzer's framework support.
- [SafeDep vet-action](https://github.com/safedep/vet-action) — the supply-chain gate, and how to point it at a custom policy.
- [OpenSSF Scorecard — Maintained check](https://github.com/ossf/scorecard/blob/main/docs/checks.md#maintained) — why "no recent commits" trips the heuristic.
- [Part 1: the paper comparison](/posts/biome-mago-vs-prettier-eslint-phpstan/) — the theory this post tests.
