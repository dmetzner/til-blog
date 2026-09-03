---
title: "I told Claude Code to build its own status line"
description: "The status line is just a script that gets handed a JSON blob — git branch, files changed, usage limits — so building one is mostly describing what you want."
pubDate: 2026-06-23
tags: ["tooling", "ai", "til"]
draft: false
---

I wanted the bar at the bottom of my prompt to tell me two things: what branch
I'm on, and how close I am to my usage limit before I kick off something big. I
didn't write a line of bash. I told Claude Code to build me a status line — and
it did, then we tweaked it back and forth until it looked right.

Here's ours:

```
💬 add-usage-statusline  🤖 Opus 4.8 (1M context) [high]
📁 nicecode  🌿 feat/claude-statusline (2f +63/-4)
5h ██░░░░░░ 34% ↻2h16m  │  wk █░░░░░░░ 18% ↻Sat 10:40  │  ctx 22%
```

The reason this is so little work is that the status line is **just a script**.
Claude Code runs whatever you point it at and pipes it a JSON blob on stdin, and
that blob already has the good stuff worked out for you. The branch, the files
changed and lines added/removed, the model and its effort level, how much of the
context window is gone — you don't compute any of it, you just pick what to show:

```bash
echo "$json" | jq -r '.workspace.current_dir'        # which project
echo "$json" | jq -r '.cost.total_lines_added'        # +63
echo "$json" | jq -r '.context_window.used_percentage' # 22
```

The part I didn't expect: how much of my quota I've used, and when it resets, is
already in there too — both the five-hour window and the weekly one. Now the
prompt answers "am I about to run out" before I ask, and
`/usage` is a command I stopped typing.

```bash
# each window arrives with a percentage used and a reset timestamp
echo "$json" | jq -r '.rate_limits.five_hour.used_percentage'
echo "$json" | jq -r '.rate_limits.seven_day.resets_at'
```

Drop the script path in `~/.claude/settings.json` and it's global across every
project. Add `refreshInterval: 1` and it keeps ticking while you're idle, so the
"resets in 2h16m" countdown stays honest while a long tool call runs.

One caveat worth knowing: `rate_limits` only shows up on Pro/Max, and only after
the first message of a session — so a brand-new session starts without it for a
beat. Fine once you handle the empty case.

## Follow-up resources

- [Customize your status line — Claude Code docs](https://code.claude.com/docs/en/statusline.md) — every field in the stdin blob, including `rate_limits`, `cost`, and `context_window`.
- [ccstatusline](https://github.com/sirmalloc/ccstatusline) — a configurable pre-built bar if you'd rather not describe your own.
- [starship-claude](https://github.com/martinemde/starship-claude) — drives the Claude Code status line from a Starship config.
- [jq](https://jqlang.github.io/jq/) — the JSON parser pulling fields out of the blob.
