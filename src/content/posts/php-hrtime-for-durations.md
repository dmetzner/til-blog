---
title: "Measure durations with hrtime, not microtime"
description: "PHP's microtime() reads the wall clock, which can be reset mid-measurement. hrtime() only ever counts forward, so it is the one for elapsed time."
pubDate: 2026-10-22
tags: ["php", "til"]
draft: false
---

I was logging how long a slow API call takes, and the code used `hrtime()`. I have always
written `microtime(true)` for that, so I asked why.

The two answer different questions. `microtime()` answers *what time is it?* It reads the
wall clock, and the wall clock gets corrected. If the time sync service steps it by two
seconds while your request runs, your "duration" is two seconds off, or even negative.

`hrtime()` answers *how much time has passed?* It counts nanoseconds from an arbitrary
starting point, usually boot. On its own the number means nothing, but the
[PHP manual](https://www.php.net/manual/en/function.hrtime.php) promises it is monotonic
and cannot be adjusted, so nobody can reset it between two readings:

```php
$startedAt = hrtime(true);
$response = $client->request('POST', $url);
$durationMs = intdiv(hrtime(true) - $startedAt, 1_000_000);
```

On a server that is always on, those clock jumps almost never happen, which is why
`microtime()` has served me fine for years. The rule is still easy to keep: `hrtime()` for
durations, `microtime()` when you need an actual timestamp.

