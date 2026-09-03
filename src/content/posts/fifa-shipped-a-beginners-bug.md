---
title: "FIFA shipped a beginner's auth bug"
description: "A billion-dollar platform shipped the same access-control bug I catch in first-week code. Budget and brand don't buy you out of it — so look closely."
pubDate: 2026-06-19
tags: ["security", "web", "til"]
draft: false
---

In code review I keep finding the same bug — mostly in work from people early in their
careers: new juniors at work, and the students I mentor now and then on
[Catrobat](https://catrobat.org)'s open-source [Catroweb](https://github.com/Catrobat/Catroweb).
Someone gates an action behind a role by hiding the button: it renders for admins,
disappears for everyone else, the ticket closes. The endpoint behind that button stays open
to anyone who knows the address.

Then I read the FIFA World Cup 2026 writeup, and there it was — the same bug, at the
biggest sporting event on earth.

Anyone could sign up on a public FIFA portal and end up inside the company's own
staff directory. The screens were careful: log in as a nobody and you got a tidy
"access denied" page. But the systems *behind* those screens handed data to anyone
who was logged in at all — including write access to the stats and commentary going
out on air *during* matches, 23 internal spreadsheets, and the keys to every camera
feed. An attacker "could have rickrolled the entire World Cup."

Budget didn't catch it. Brand didn't catch it. The check on the screen just *felt*
like a check:

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
and sees exactly what it should.

Credit to bobdahacker, who found it: they could have put Subway Surfers on the world feed
mid-match. Instead they filed a report. FIFA ignored every normal channel, so they
escalated it themselves — MediaKind, then CISA and the FBI — until it was patched within
hours. Finding the bug is the fun part. Resisting that much access and quietly getting it
fixed is the actual job.

Nobody is too big or too well-funded to ship the dumb bug, so I don't assume it's
handled — I look. For every guarded action: can I reach it directly, as an ordinary
user, going around the screen entirely? If the answer comes back fine, the check was
decoration. Side project or World Cup, same test — [including on my own
sites](/posts/bot-proofing-auth-on-a-static-site/).

## Follow-up resources

- [The FIFA World Cup 2026 writeup](https://bobdahacker.com/blog/fifa-hack) by bobdahacker — the full breakdown, and a genuinely fun read.
- [OWASP Top 10: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — it's been #1 on the list for a reason.
- [Symfony — Security & access control](https://symfony.com/doc/current/security.html) — `#[IsGranted]` and voters, enforced where the work happens.
