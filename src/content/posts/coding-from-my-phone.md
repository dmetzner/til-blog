---
title: "Coding from my phone works because none of it runs on my phone"
description: "Claude Code on the web runs each session in a cloud VM, so closing the browser doesn't stop the work — I shipped two small apps from a train with no laptop."
pubDate: 2026-06-28
tags: ["tooling", "ai", "til"]
draft: false
---

I went in skeptical. Coding from a phone sounds like a party trick — a cramped
keyboard, a toy. I had a long train ride and tried it anyway, and the thing that
flipped me wasn't the editing. It was switching to another app, coming back ten
minutes later, and finding the work *already done*.

That only makes sense once you notice where the work actually happens: not on the
phone. [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
runs each session on a computer somewhere else — a fresh one, with a copy of the
project on it. The phone is a remote control, not the machine. So when the docs say
*"sessions persist even if you close your browser, and you can monitor them from the
Claude mobile app,"* they mean it literally. Which also removes the reason to sit and
[watch a terminal](/posts/stop-watching-the-terminal/) at all.

Two things came out of a few minutes of chatting on the train:
[nice-wheel](https://niceshops-playground.github.io/nice-wheel/) and
[plan-it-nice](https://niceshops-playground.github.io/plan-it-nice/). Describe the
idea, wait a bit, open the GitHub Pages URL on the same phone, test, refine.

## The one gotcha

Make the GitHub repo *first*. A session clones one repo into its VM and works inside
it; `--remote` is one repository at a time. Start the session before the project
exists and it has nowhere to go. Honestly better that way — it can't wander off and
start "improving" something unrelated. (One sharp edge worth knowing: the docs note
the connected GitHub account's credential can technically *reach* any repo it can
see — the single-repo scope is about what gets worked on, not a hard wall.)

## What you actually give up

Overview. On the PC I skim the diff as it lands; on the phone I'm mostly trusting the
description of what changed. For a throwaway demo that's fine. For anything I'd merge,
I'd still want the diff in front of me — `claude --teleport` pulls a cloud session
straight into my local terminal for exactly that.

The surprise wasn't that a phone can drive a coding agent. It's that the agent was
never on the phone to begin with.

## Follow-up resources

- [Claude Code on the web — docs](https://code.claude.com/docs/en/claude-code-on-the-web) — the architecture, session persistence, and the single-repo `--remote` model.
- [Announcement: Claude Code on the web](https://claude.com/blog/claude-code-on-the-web) — research preview for Pro/Max/Team, iOS monitoring.
- [How the sandboxing works](https://www.anthropic.com/engineering/claude-code-sandboxing) — isolated VMs, scoped credentials via a proxy, network limits.
- [Web quickstart](https://code.claude.com/docs/en/web-quickstart) — connect GitHub and run the first task.
