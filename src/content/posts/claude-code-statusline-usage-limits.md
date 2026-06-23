---
title: "Claude Code pipes your usage limits to the status line"
description: "The status line script gets a fat JSON blob on stdin — including your 5-hour and weekly rate-limit windows and when they reset."
pubDate: 2026-06-23
tags: ["tooling", "ai", "til"]
draft: false
---

I kept typing `/usage` to check how close I was to the 5-hour limit before
kicking off something expensive. It's a context switch away from the prompt for
one number. Turns out that number is already being handed to me — I just wasn't
catching it.

Claude Code runs whatever script you point `statusLine` at and pipes a JSON blob
to it on **stdin**. Most of the examples stop at model name and context
percentage. But for Pro/Max accounts the blob also carries `rate_limits`:

```bash
#!/usr/bin/env bash
input=$(cat)                    # Claude Code pipes the session JSON here
j() { jq -r "$1" <<<"$input"; }

H_PCT=$(j '.rate_limits.five_hour.used_percentage // empty')
H_RST=$(j '.rate_limits.five_hour.resets_at // empty')   # unix epoch seconds
W_PCT=$(j '.rate_limits.seven_day.used_percentage // empty')
```

`used_percentage` is 0–100, `resets_at` is an epoch you turn into "resets in
2h11m" with a bit of `date` math. Same blob gives you `model.display_name`,
`effort.level`, `session_name`, `context_window.used_percentage`, and
`cost.total_lines_added` / `total_lines_removed`. Wire it into three lines and
the prompt tells you everything `/usage` did, without leaving it:

```
💬 redesign-checkout-flow  🤖 Opus 4.8 [high]
📁 acme-shop  🌿 feature/checkout-redesign (3f +47/-12)
5h ███░░░░░ 34% ↻2h11m  │  wk ██░░░░░░ 18% ↻Mon 09:00  │  ctx 22%
```

Two things bit me on the way there. First, `printf '%.0f' "34.7"` *fails* under a
comma-decimal locale — on my `de_DE` box it rejects the dot. `export LC_ALL=C` at
the top of the script and floats parse again. Second, if you shell out to `git`
for the branch and diff stats, cache it — but key the cache file on the
`session_id` from the JSON, not `$$`. The PID changes every invocation, so a
PID-keyed cache never hits.

The bar redraws on every assistant turn (debounced 300ms). For the limit windows
to stay live while you're idle — waiting on a long tool call — set
`refreshInterval: 1` in the same settings block; it re-runs the script on a
timer. Drop the script path in `~/.claude/settings.json` and it's global across
every project.

One footnote: `rate_limits` only shows up on Pro/Max, and only *after* the first
API call of the session — so handle the empty case (`// empty` above) or the line
flickers in blank on a cold start.

`/usage` is now a thing I don't type.

## Follow-up resources

- [Customize your status line — Claude Code docs](https://code.claude.com/docs/en/statusline.md) — the full stdin JSON schema, including the `rate_limits`, `cost`, and `context_window` fields.
- [ccstatusline](https://github.com/sirmalloc/ccstatusline) — a configurable pre-built status line if you'd rather not hand-roll the bash.
- [starship-claude](https://github.com/martinemde/starship-claude) — drives the Claude Code status line from a Starship config.
- [jq](https://jqlang.github.io/jq/) — the JSON parser doing all the field extraction above.
