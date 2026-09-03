---
title: "Don't read what the agent did — read what it decided"
description: "A long AI task leaves behind a wall of output. Having it finish with a one-page report instead means you can judge the thinking before you check the work."
pubDate: 2026-09-03
tags: ["ai", "process", "tooling", "til"]
draft: false
---

A long AI task leaves a wall of text behind it. Forty minutes of work, thousands
of lines, and somewhere in there are the two or three decisions that actually
mattered. Reading it back is like reading someone's diary in the order they lived
it — everything is in there, and none of it is where you need it.

So I made the run end differently. The last thing it does is write **one page**
and publish it as a [Claude Artifact](https://claude.com/blog/artifacts-in-claude-code) —
a real web page at a private link that only opens for me. Credit where it's due:
these are lovely to read. Proper typography, headings, a table when a table helps,
and it updates in place at the same link when the work moves on. After a day in a
terminal, opening one feels like being handed a printed page.

The page answers four questions, in this order: what changed, how do we know it's
right, what did we deliberately *not* do, and what's waiting on my decision.
Which means I judge the *thinking* first. If the intent was wrong, that shows up
in one paragraph instead of forty files — and when I do go and check the work, I
already know what it was trying to be. Same idea as the
[phone notification](/posts/stop-watching-the-terminal/): the short thing tells me
whether to care, the long thing waits behind a login.

Now the catch, and it's a real one: **the page is written by the same thing that
did the work.** It's a claim, not proof. It can be confidently wrong, and it can
quietly leave something out. So it changes the *order* I read in, never whether I
check at all. On a small change it's ceremony — skip it.

Which is the one advantage an [ordinary written
report](/posts/most-reports-bury-the-conclusion/) still has over this: the author
isn't also the defendant.

## What it actually is

A file with instructions, invoked by name (`/po-report`) at the end of a session.
No code — the whole thing is the ask:

```markdown
---
name: po-report
description: One-page non-technical readout of finished work, published as a web page.
---

Turn the work in this session into one page for a product owner who doesn't code:

1. What changed — in user terms. No file names, no library names.
2. How do we know it's right — what was actually verified, not what was intended.
3. What we deliberately did NOT do — and why.
4. What's waiting on a decision — the options, and your recommendation.

Be honest about the mistakes made along the way. Publish it and give me the link.
```

The publishing part is one line of the ask, because the tool does it — Claude Code
writes the page and hands back a link, private until I share it, versioned at that
same URL every time it republishes.

Point 2 is the one that earns its place. Asked plainly, "how do we know" tends to
come back as "it wasn't checked" more often than you'd like — which is exactly the
sentence you want on page one, not buried on page three.

## Follow-up resources

- [Share session output as artifacts](https://code.claude.com/docs/en/artifacts) — publishing a page to a private URL, and republishing to the same link
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — a `SKILL.md` is just instructions you can invoke by name
