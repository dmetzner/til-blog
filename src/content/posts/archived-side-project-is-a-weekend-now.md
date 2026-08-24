---
title: "Your archived side project is a weekend now"
description: "A 14.5k-line Java Android app I gave up on is a working web and Android app again after five days — porting got cheap, being correct did not."
pubDate: 2026-08-23
tags: ["ai", "process", "testing", "til"]
draft: false
---

`dmetzner/Mulatschak` sat archived for years. 14.5k lines of Java, a hand-rolled `Canvas`
renderer, AGP 3.6 pointed at jcenter — which stopped serving — `targetSdk 28`, and multiplayer
built on Play Games real-time, a service Google switched off on 2020-03-31. Play removed the
listing in 2025. To ship one bugfix I'd have had to repair the build system first, so I never did.

Five days ago I pointed Claude Code at it. It's a working app again: a web build and an Android
APK, 9.6k lines of TypeScript, no Java left.

**Old code is the best spec you will ever hand a model.** Not the architecture — the *decisions*. Every rule in that Java is one I already argued about with someone
at a table. Two things were worth keeping, the rules and the knowledge of which rules were wrong,
and both survived. `GameLayout`'s 722 lines of pixel maths, the dead multiplayer and 33 PNG card
faces did not.

One rule made the port testable, and it's the only architecture decision I'd defend:

```sh
# check.sh — the engine must not learn to wait
if grep -rnE 'setTimeout|setInterval|requestAnimationFrame|Date\.now' src/core; then
  fail "src/core must stay free of timers and wall-clock reads"
fi
# ...and it may not roll its own dice: one seeded generator, in one file
if grep -rn 'Math\.random' src/core | grep -v 'engine.ts'; then
  fail "only engine.ts may seed the RNG"
fi
```

The Java drove its state machine with `Handler.postDelayed`, so "who wins this trick" could only be
answered by playing a round in an emulator. With pacing pushed into the view, the engine runs
headless — a test autoplays complete games on six seeds, and it found a missing elimination rule on
day one.

95 commits in five days, and about a third are named `fix: what the review found`.
Getting it *running* took an afternoon. Getting the rules right, getting the card art to actually
read as Austrian (correct suit signs still looked like a French deck — it's the grammar, not the
symbols), getting a tap target that isn't covered by a 374px SVG: that was the other four days. A
model has no opinion about whether your game is correct. It will produce a confident, wrong rule for the
Weli — the one card that is trump in every round — and a green build to go with it.

So the cost didn't vanish, it moved — off the port and onto the review. Which is the good trade,
because the port is what stopped me for years and the review is work I actually enjoy.

The archive isn't a graveyard any more. It's a weekend and a review queue.
