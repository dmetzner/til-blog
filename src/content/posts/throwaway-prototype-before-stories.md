---
title: "Agile's feedback loop starts one slice too late"
description: "An experiment: before the first real slice, vibe-code a throwaway prototype for a few tokens, let stakeholders click it, and start the agile loop already aimed right."
pubDate: 2026-06-22
tags: ["process", "ai", "agile", "til"]
draft: false
---

We were already agile about it. Slice the work small, ship a thin slice, put it
in front of stakeholders, loop. Map the stories, settle the design, build the top
slice clean. And it mostly works — until someone *uses* that first real slice and
says "oh — not like that." The stories were right. The shared understanding
wasn't. So we loop again — except now we're reworking shipped code, not a sketch.

Here's the part nobody says out loud: the agile loop only starts *after* you've
built something real. Getting feedback *before* the first slice would have meant
building a full prototype up front, and that was never worth it — cheaper to ship
the slice and find out. [Story mapping](https://www.oreilly.com/library/view/user-story-mapping/9781491904893/)
(Jeff Patton) already points you toward prototyping the riskiest slice before
building it. We did the mapping — we just skipped the prototype most of the time,
and the times we didn't, it ate too many resources up front. Same reason either
way: cost.

That math just changed. A running prototype now costs a few tokens and a coffee's
worth of wait time. So the move is obvious — **add one more loop, before the
expensive one.**

Features clear, design mostly settled, but before writing the real stories:
vibe-code a throwaway, hand it over, let people click a *real* thing, and pipe
what they say straight into the slices you were going to build anyway.

```
before:  map → design → ship slice → feedback → rework shipped code → loop
after:   map → design → prototype (the cheap loop) → feedback → ship slices that already aim right
```

## Why this isn't just a spike (or a walking skeleton)

It looks like things that already exist, but it isn't quite any of them:

- A [spike](https://en.wikipedia.org/wiki/Spike_(software_development)) (XP)
  produces a decision or a technical answer — it's not something a stakeholder clicks.
- A walking skeleton / [tracer bullet](https://builtin.com/software-engineering-perspectives/what-are-tracer-bullets)
  is deliberately *not* throwaway — it's thin production code you keep and build on.
- A [design sprint](https://www.gv.com/sprint) (Jake Knapp) is the closest: build
  a prototype, test it with users. But it's a facilitated five-day workshop with a
  *façade* — a realistic-looking fake.

What's new is the **cost**. A design sprint costs a week and a room; this costs a
few tokens and a short wait. Cheap enough to build, click, and *delete* per
feature — by the developer, in the normal flow — at higher fidelity than a façade
and with none of the keep-it pressure of a tracer bullet. Patton's advice didn't
change; the price of following it dropped through the floor.

## The catch — which is why it's only an experiment

Two real risks:

1. **"Prototypes don't get thrown out."** A vibe-coded demo convincing enough to
   test is convincing enough that someone says "just ship that." The only defense
   is discipline: declare it disposable, keep it unmergeable, and actually mean it.
2. **The upfront cost is real.** Tokens and time spent before any "real" code
   exists. The entire bet is that early, concrete feedback prevents more rework
   than the prototype costs.

I don't know yet whether it pays off. I'm going to run it on the next feature and
report back: did the throwaway prototype catch a "not like that" before it got
expensive — or was the initial passive spend just... spent?

The cheapest place to be wrong is in code you've already agreed to delete.

## Follow-up resources

- [User Story Mapping — Jeff Patton](https://www.oreilly.com/library/view/user-story-mapping/9781491904893/) — the "shared understanding, not requirements" source, and the prototype-above-the-line idea.
- [Spike (software development)](https://en.wikipedia.org/wiki/Spike_(software_development)) — the XP research timebox, for contrast.
- [Tracer bullets / walking skeleton](https://builtin.com/software-engineering-perspectives/what-are-tracer-bullets) — why those are explicitly *not* throwaway code.
- [The Design Sprint — GV](https://www.gv.com/sprint) — Knapp's prototype-and-test-with-users process, the nearest existing practice.
