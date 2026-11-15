---
title: "Background jobs without a broker: one table, one worker per kind of work"
description: "Moving Catroweb's slow work onto Symfony Messenger with a MariaDB queue: what it fixed, how it works, and where deploys bite."
pubDate: 2026-11-15
tags: ["php", "databases", "til"]
draft: false
---

A Scratch project took 66 seconds to import on [share.catrobat.org](https://share.catrobat.org). The import downloads the project from Scratch, converts it and publishes it, all while the
visitor's browser waits on one request. The server gives a request 120 seconds. And because only one conversion
may run at a time, a second import at the same moment would have been refused with: "Another
Scratch project is being converted right now. Please try again in a minute."

I had been thinking about a job queue for a while. That import settled it.

## What a queue changes

A queue splits "please do this" from "doing it". The request writes a note — *convert Scratch
project 372415454* — into a list and answers at once with a ticket number. A separate, long-running
process, the **worker**, takes notes off the list and does the work. The browser asks "is ticket
42 done yet?" every two seconds and opens the project when it is.

Three things follow:

- The website no longer waits on a request for a minute, so it can't run into the timeout.
  (Released apps still wait, see below.)
- Two imports no longer collide. The worker does them one after the other; the second one waits
  for the first to finish instead of being turned away.
- A job that fails because Scratch is down is tried again later, automatically, and one that
  keeps failing lands in a "failed" list where an admin can inspect and retry it.

In the first hours on production, six imports went through the queue; the slowest took 57 seconds
from click to finished project, and none failed.

## No RabbitMQ needed

The usual picture of a queue includes a message broker such as RabbitMQ or Redis: another service
to run, monitor and back up. For a site this size, that is overkill. Symfony
Messenger can keep its queue in an ordinary database table. A queued job is one row; a worker
polls the table and claims rows with a transaction. The overhead per job is a few writes to a database the site already has.

The important design decision was not the storage but the split: **one queue per kind of work, each
with its own worker.** Mail gets a queue, Scratch imports get one, big upload checks get one, and
the periodic tasks get two lanes, fast and slow. A slow job never makes a verification mail wait.

## The periodic tasks, and a cron that ran nothing for nearly seven months

Catroweb had one cron entry: every ten minutes, a command ran 21 maintenance tasks one after the
other — popularity scores, rankings, achievements, clean-ups. A comment in the server config
records why that is fragile: the cron's log redirect failed, so the command never started. **No
task ran from April 21 to November 12.**

The tasks now run inside two scheduler workers (Symfony Scheduler), supervised by systemd, which
restarts a worker that dies. The existing monitoring alerts when a worker is not running. The
"when did this task last run" bookkeeping stayed in its database table, so a deploy or a restart
doesn't reset any task's clock.

## Measure before optimising

Moving the tasks was a chance to make them faster, but the measurements didn't point at the slow
task. The slowest one on production took
45 seconds once, and a dry run of it over all 1,507 projects takes 0.75 seconds — the 45 seconds
were real file deletions. The waste was elsewhere: notifying a user's followers about
a new project loaded each follower with its own query and saved each notification separately.
That is now one query and a write per 200 notifications, on a worker.

Not everything moved, either. Two listeners that bump a counter after a translation request stay
where they are: queueing them would cost a database write to save a database write.

## Released apps keep working

The Android app in people's pockets expects the old answer: the finished project, in the same
request. So the ticket is opt-in. A client that wants one sends the standard HTTP header
`Prefer: respond-async` ([RFC 7240](https://www.rfc-editor.org/rfc/rfc7240)) and gets `202 Accepted`
with a job to poll; everyone else gets exactly the old behaviour. The website sends the header.

## Deploy traps

Code that runs in a worker keeps running the *old* code until the worker restarts, so every deploy
has to restart the workers. Symfony's answer is `messenger:stop-workers`: it sets a flag in a cache,
each worker finishes its current job, sees the flag and exits, and systemd starts it again on the
new code.

Trap one: that flag lives in the application's cache directory, and my deploy tool gives every
release its own directory. The new release sets the flag in a place the old workers never look.
Moving the flag's cache into the database was not enough on its own — trap two: Symfony derives
the key prefix of every cache pool configured through `framework.cache` from the project directory, so each release still read and wrote a
*different key* in the shared table. I found that while checking facts for this post.

The [Messenger docs](https://symfony.com/doc/current/messenger.html) suggest a fixed global
`cache.prefix_seed`. A review caught why that would have hurt here: the main application cache
on production is a Redis server shared by all releases, and until then every deploy had quietly
started it empty. A global seed would have carried serialized database objects and cached API
answers across deploys. So only the flag's cache gets a fixed name; everything else keeps a fresh
start per release.

The first deploy failed for a third, more mundane reason: I had tried to restart the workers with
`sudo systemctl`, and a broader rule later in the server's sudoers file overrode the one I had
added. In sudoers the last matching rule wins. The shared flag needs no sudo at all, which is the
better design anyway.

## Two Messenger details worth knowing

- **Don't route Symfony's own mail message to a queue if you send through a chain of providers.**
  `mailer->send()` would then return as soon as the mail is queued, so the code that falls back to
  the next provider on an error never sees one. Queue your own message instead, and let the
  handler run the fallback.
- **`RecoverableMessageHandlingException` retries forever.** It ignores `max_retries` — the docs say
  so, I had missed it. For "try again later, but not forever", throw an ordinary exception.

## What it looks like

The queues and workers:

```php
// config/packages/messenger.php
$queue = static fn (string $name, array $retry = []): array => [
  'dsn' => '%env(MESSENGER_TRANSPORT_DSN)%', // doctrine://default?auto_setup=0
  'options' => ['queue_name' => $name],
  'retry_strategy' => $retry + ['max_retries' => 3, 'delay' => 10_000, 'multiplier' => 3, 'max_delay' => 600_000],
];

$containerConfigurator->extension('framework', ['messenger' => [
  'failure_transport' => 'failed',
  'transports' => [
    'mail' => $queue('mail'),
    'default' => $queue('default'),
    'scratch' => $queue('scratch', ['max_retries' => 2, 'delay' => 60_000]),
    'uploads' => $queue('uploads', ['max_retries' => 1]),
    'failed' => ['dsn' => '%env(MESSENGER_TRANSPORT_DSN)%', 'options' => ['queue_name' => 'failed']],
  ],
  'routing' => [
    SendMail::class => 'mail',
    ConvertScratchProject::class => 'scratch',
    CompleteProjectUpload::class => 'uploads',
    ExportCodeView::class => 'default',
    NotifyFollowersOfNewProject::class => 'default',
  ],
]]);
```

The restart flag, shared by every release and nothing else (a plain service, so Symfony doesn't
derive its key prefix from the release directory):

```php
// config/services.php
$services->set('cache.messenger.restart_workers_signal', DoctrineDbalAdapter::class)
  ->args([service('database_connection'), 'messenger-restart', 0]);
```

One systemd template runs every worker, `catroweb-worker@mail`, `catroweb-worker@scratch` and so
on:

```ini
[Service]
User=www-data
WorkingDirectory=/var/www/share/current
ExecStart=/usr/bin/php bin/console messenger:consume %i --time-limit=3600 --memory-limit=512M --env=prod
Restart=always
KillMode=mixed
TimeoutStopSec=330
```

The full change is [Catroweb #7680](https://github.com/Catrobat/Catroweb/pull/7680).
