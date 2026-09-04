---
title: "My biggest CLAUDE.md was 224 KB"
description: "Nine agent instruction files went from 455,530 characters to 88,584 — and the split that actually saves context is a plain markdown link, not an `@path` import."
pubDate: 2026-09-04
tags: ["ai", "tooling", "til"]
draft: false
---

Every coding-agent session in a project opens by reading that project's instruction
file — `CLAUDE.md`, the page that says how to build it, what to run before claiming
done, and which things break silently. Mine had turned into archives. The worst of
them was 224,224 characters. At the rough four-characters-a-token
conversion — I never put a real tokenizer on it — that is about 55,000 tokens: more
than a quarter of a 200,000-token context window, spent before any work started. Not
because the project has that many rules, but because every rationale, incident and old
decision it ever had was living in the same file as them.

I compacted nine of them in one sweep, biggest first:

| File |  Before |  After | Cut |
| ---: | ------: | -----: | --: |
|    1 | 224,224 |  7,773 | 97% |
|    2 |  54,512 | 10,513 | 81% |
|    3 |  40,524 | 10,578 | 74% |
|    4 |  33,271 | 12,372 | 63% |
|    5 |  31,646 | 11,106 | 65% |
|    6 |  24,036 | 12,045 | 50% |
|    7 |  19,951 | 10,018 | 50% |
|    8 |  17,288 |  7,256 | 58% |
|    9 |  10,078 |  6,923 | 31% |
| **Total** | **455,530** | **88,584** | **81%** |

Almost nothing was deleted. The long passages moved into a `docs/` folder beside the
file, one document per subject, linked from the rule they explain; for the two biggest
I checked mechanically that the relocated documents came out byte-identical to what
left. What did get deleted was duplication, and dated status notes of the
as-of-August-this-is-still-broken kind, which age into lies.

## The link has to be lazy

The obvious way to split a big one up is the way that does not work. A `CLAUDE.md`
can pull in another file with `@path/to/file`. It saves nothing. [The documentation is blunt about it](https://code.claude.com/docs/en/memory):
splitting into `@path` imports "helps organization but doesn't reduce context, since
imported files load at launch."

An ordinary markdown link is a different thing entirely. It is text until the agent
decides it needs that document and goes and reads it. That is the whole trick: a link
the agent may follow costs one line; an import costs the file. Same rule one level up —
a skill's *description* is loaded every session, its body only when it runs. So a
long procedure costs almost nothing until you invoke it, and the description is the
half worth fighting over.

## The gate caught me cutting a guardrail

Trimming one of them dropped four facts its own automated checks require to be written
down — a network binding, a list of commands that run with reduced permissions, and two
retention windows that exist for legal reasons. The suite failed and named all four. That is
the argument for having [a test that reads your instruction file](/posts/a-test-that-reads-your-docs/),
not only your code.

The size target is under 200 lines, and the reason is not only cost: longer files, per the
same docs, "reduce adherence." A rule buried on page forty is a rule you are not
actually enforcing. `/doctor` will propose trims for a checked-in `CLAUDE.md`, though it
cuts what an agent could re-derive from the code — which is not the same thing as knowing
which sentences a test depends on.
