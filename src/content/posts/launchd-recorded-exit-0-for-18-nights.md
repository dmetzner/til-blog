---
title: "launchd recorded exit 0 for 18 nights"
description: "A step of my nightly job failed 18 mornings running while launchd recorded success. Neither the exit code nor the log's age caught it."
pubDate: 2026-10-06
tags: ["tooling", "testing", "til"]
draft: false
---

Every morning at 07:15 my Mac runs a script that pulls my repos, rebuilds a personal
dashboard and checks a handful of things. One step of it, the dashboard build, failed on
18 mornings in a row in August. I found out by reading the log by hand.

The cause was boring. launchd, the macOS scheduler, starts jobs with a bare `PATH` that
does not include Homebrew. So `python3` was Apple's old 3.9.6 instead of Homebrew's current
one. My code uses syntax 3.9 does not know, so the build died with a `SyntaxError` before
it had done anything. The fix is one `EnvironmentVariables` block in the job's plist that
sets `PATH`.

The interesting part is that nothing noticed. The script wrote the failure into its log
and carried on. It had no `set -e` and its `main` ended with `return 0`, so as far as
launchd was concerned, the job succeeded on every one of those nights:

```text
$ launchctl print gui/501/com.example.nightly | grep 'last exit'
	last exit code = 0
```

**If your "is my scheduled job healthy" check reads the exit code, it was green for the
entire outage.** A shell script reports how its last command went, not whether it did its
job.

## The log is not evidence either

So I wrote a probe that watches the jobs themselves. The first version asked "when did
this job last write to its log?" Run against the real machine, it raised two confident
false alarms straight away:

- A job that stops Docker stacks nobody is using had been "silent for 67 hours". It prints
  nothing when nothing is running, which is most of the time.
- A backup job had been "silent for 83 days". It redirects into its own log file, so the
  one launchd watches had stayed empty since June. It had run at 04:46 that morning.

A healthy quiet job writes nothing, so a log going quiet does not mean the job stopped.

## What worked: launchd's own counter

`launchctl print` shows `runs = N`: how many times launchd has started the job. It costs
about 3 ms per job to read, and it moves exactly when launchd started the job, regardless
of what the job prints.

It is relative, not absolute. It resets to 0 when the job is reloaded or the Mac reboots,
so `runs = 0` means "recently reloaded or rebooted", not "never worked". The useful finding is a
counter that has not moved across several of the job's own intervals, which means storing
the last value and comparing. A counter that went backwards means a reload or reboot; start a new
baseline.

That answers "did it run?". It does not answer "did it work?". The day after the probe
shipped, a fetcher job had been started 167 times while its output file had not changed in
89 hours. So every job now also declares the file it produces and how old that file may get.

The rule I took away: check what the job produces. Exit codes and logs are both the job
talking about itself.
