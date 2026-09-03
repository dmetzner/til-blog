---
title: "The port took a day; getting the game right took four"
description: "An archived Java card game became a web and Android app in five days; most of the work was validating the rules and interface."
pubDate: 2026-08-23
tags: ["ai", "process", "testing", "til"]
draft: false
---

**Mulatschak** — the Austrian trick-taking game — is a card game I wrote years ago and
then left archived and unbuildable. Nothing was wrong with the game. The *scaffolding* had
rotted: half the services it was built against had been switched off, the app store had
dropped the listing, and to fix one bug I'd first have had to repair everything underneath
it. So I never did.

Five days ago I pointed Claude Code at it. It's a working app again — TypeScript now,
no Java left — and you can
[play it in a browser](https://mulatschak.metzner.uk) or
[install it from Play](https://play.google.com/store/apps/details?id=at.heroiceraser.mulatschak).

**Old code is the best spec you will ever hand a model.** Not the architecture — the
*decisions*. Every rule in that Java is one I'd already argued about with someone at a
table. Two things were worth keeping — the rules, and the knowledge of which rules were
wrong — and both survived. The hand-rolled screen-layout maths, the dead multiplayer and
the pile of card images did not.

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

The old version wove the waiting into the rules themselves, so "who wins this trick" could
only be answered by sitting through a round on a phone. With the waiting pushed out into the
screen, the rules can be played at full speed with nobody watching — and a test that
autoplays whole games found a missing rule on day one.

About a third of the commits are named `fix: what the review found`. Getting it *running*
took an afternoon. Getting the rules right, getting the card art to actually read as
Austrian (the correct suit signs still looked like a French deck — it's the grammar, not
the symbols), getting a card you can tap that isn't covered by the card next to it: that
was the other four days. A model has no opinion about whether your game is correct. It
will produce a confident, wrong rule for the Weli — the one card that is trump in every
round — and a green build to go with it.

So the cost didn't vanish, it moved — off the port and onto the review. Which is the good trade,
because the port is what stopped me for years and the review is work I actually enjoy.

The archive isn't a graveyard any more. It's a weekend and a review queue — and the game
is [back where it belongs](https://mulatschak.metzner.uk), free, with no account and no ads.
