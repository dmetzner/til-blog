---
title: "FIFA shipped a beginner's auth bug"
description: "A billion-dollar platform shipped the same access-control bug I catch in first-week code. Budget and brand don't buy you out of it — so look closely."
pubDate: 2026-06-19
tags: ["security", "web", "til"]
draft: false
---

In code review — especially in consulting — I keep finding the same bug. Someone gates an
action behind a role by hiding the button: it renders for admins, disappears for everyone
else, the ticket closes. The POST endpoint behind it stays open to anyone who knows the URL.

I'd half-assumed this was a small-team problem — something you catch as a project matures
and gets real review. The big platforms, with security teams and audits and real money on
the line, surely don't ship something this basic.

Then I read the FIFA World Cup 2026 writeup.

Same bug. Anyone could register on the public agent portal and land in FIFA's Microsoft
Entra tenant. The Angular apps checked JWT roles and showed tidy "access denied" pages —
but the backend APIs served data to *any* authenticated member anyway: write access to the
stats and commentary going out on air *during* matches, 23 internal spreadsheets, and the
RTMP keys for every camera. An attacker "could have rickrolled the entire World Cup."

The world's biggest sporting event shipped the exact mistake I see from people on their
first web project. Budget didn't catch it. Brand didn't catch it. The frontend check just
*felt* like a check:

```twig
{# Twig hides the button — that's UX #}
{% if is_granted('ROLE_ADMIN') %}
  <button>Delete match</button>
{% endif %}
```

```php
// the controller is where authorization actually happens
#[IsGranted('ROLE_ADMIN')]
public function deleteMatch(Match $match): Response { /* ... */ }
```

You need both. Yes, the role gets named twice and the two can drift — so make the server
the source of truth and the template its mirror. The button is polish; the endpoint is the
only thing that's actually authorization.

What makes this so easy to miss — for a student and for FIFA alike — is that the broken
version *works*. The access-denied page renders, the demo looks right, QA clicks through
and sees exactly what it should. The hole is invisible from the screen; it only shows up
when you go around the front end and poke the API directly.

Credit to bobdahacker, who found it: they could have put Subway Surfers on the world feed
mid-match. Instead they filed a report. FIFA ignored every normal channel, so they
escalated it themselves — MediaKind, then CISA and the FBI — until it was patched within
hours. Finding the bug is the fun part. Resisting that much access and quietly getting it
fixed is the actual job.

That's the part I keep relearning: nobody is too big or too well-funded to ship the dumb
bug. So I don't assume it's handled — I look. For every guarded action: can I hit the
endpoint directly with a normal user's token and a guessed payload? If it returns `200`,
the role check was decoration — side project or FIFA, same test.

## Follow-up resources

- [The FIFA World Cup 2026 writeup](https://bobdahacker.com/blog/fifa-hack) by bobdahacker — the full breakdown, and a genuinely fun read.
- [OWASP Top 10: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — it's been #1 on the list for a reason.
- [Symfony — Security & access control](https://symfony.com/doc/current/security.html) — `#[IsGranted]` and voters, enforced where the work happens.
