---
title: The safe way to kill a legacy system is called strangler fig
description: The incremental-migration pattern you already reach for in legacy code has a name that's easy to forget — and a plant behind it worth remembering.
pubDate: 2026-07-20
tags: ["architecture", "process", "til"]
draft: false
---

Every couple of years I hit the same job: a legacy system nobody wants to rewrite in one shot. So we replace it a piece at a time — stand up a proxy in front, route one feature to new code, leave the rest on the old system, repeat until nothing points at the old thing and it can come out.

I do this constantly. I can never remember it has a name.

It's the **strangler fig** pattern. Martin Fowler [named it back in 2004](https://martinfowler.com/bliki/StranglerFigApplication.html), after the fig vines he watched in the Australian rainforest: they germinate up in the branches of a host tree, send roots down around the trunk, and slowly envelop it until the original is hollow and gone. No felling, no big-bang cutover day — the new thing grows around the old until the old is redundant.

The catch is the seam. It only works if you can *intercept* the calls — a facade in front that routes each request to old or new. No seam to hook into (legacy source you can't touch, requests you can't route) and you're back to the rewrite you were trying to avoid.

The technique was never the problem — the name was. Strangler fig.

---

**Follow-up resources**

- [Martin Fowler — StranglerFigApplication](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [Azure Architecture Center — Strangler Fig pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
