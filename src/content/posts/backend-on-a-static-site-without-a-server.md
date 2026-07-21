---
title: "You can add a backend to a static site without running one"
description: "Live presence, shared reactions and per-post likes on two static GitHub Pages sites — using Supabase from the browser, for free, without leaking visitors to a third party on load."
pubDate: 2026-07-26
tags: ["web", "databases", "security", "til"]
draft: false
---

Both my sites are static. The portfolio is React on Vite, this blog is Astro,
and both deploy to GitHub Pages on every push — no server, nothing to patch,
nothing to pay for. I wanted to keep it that way, and still add a couple of live
touches: a little "who else is here right now" indicator with shared emoji
reactions on the portfolio, and per-post likes on the blog.

Adding live features normally means standing up *something* — a WebSocket
server, a database, and the ops that come with both. I knew the managed-backend
services existed; what I didn't expect was how little there'd be to it.
[Supabase](https://supabase.com) does all of it straight from the browser, with
no infrastructure of mine, on the free tier — and, the part I'd half-resigned
myself to giving up, without breaking the privacy stance I hold the rest of the
site to.

## The one idea: the backend is someone else's, and the client talks to it directly

GitHub Pages can't hold a WebSocket open. It doesn't need to. Supabase gives you
a hosted Postgres plus a realtime layer that the *visitor's browser* connects to
directly, identified by a **publishable key** that's designed to live in client
code. There's no server of yours in the middle — the static site stays a
pile of files on a CDN, and the liveness is borrowed from a service.

I needed two different shapes of "backend", and they map cleanly onto two
Supabase features — one that touches no database at all, one that does.

## Ephemeral: presence + broadcast, zero database

The live room — a count of who's here, plus emoji that float up everyone's
screen at once — never persists anything. It's pure Realtime, and neither half
involves a Postgres row:

- **Presence** tracks a scrap of state per client. `presenceState()` returns an
  object keyed by client; count the keys and that's how many people are here.
- **Broadcast** fans a message out to everyone on the channel.

```js
const channel = client.channel("portfolio", {
  config: {
    broadcast: { self: false },             // don't echo my own reactions back to me
    presence: { key: crypto.randomUUID() }, // one key per client, or they collapse into one
  },
});
channel
  .on("broadcast", { event: "reaction" }, ({ payload }) => floatEmoji(payload.emoji))
  .on("presence", { event: "sync" }, () => setCount(Object.keys(channel.presenceState()).length))
  .subscribe((status) => {
    if (status === "SUBSCRIBED") channel.track({ joined: true }); // now I show up in presence
  });

channel.send({ type: "broadcast", event: "reaction", payload: { emoji: "🦆" } });
```

No table, no schema, nothing stored — when you disconnect, it's gone. And a
public channel needs no policies to work: Supabase's *Realtime Authorization*
(RLS on `realtime.messages`) is opt-in, only there if you mark a channel
`private`. For an anonymous toy, you skip it.

## Persistent: a counter, with the write path nailed shut

Per-post likes on the blog have to survive, so that *is* a real row. This is
where you have to stop and think, because the publishable key is sitting in every
visitor's browser. The naive version — let the client `UPDATE` a `likes`
column — means anyone can take that key and set `likes = 99999` with one `curl`.

The fix is two layers. First, RLS on, with the anon role granted **read only** —
no `INSERT`/`UPDATE`/`DELETE` at all. Then a single write path: a Postgres
function that only ever moves the count by one.

```sql
create function bump_like(post_slug text, dir integer)
  returns integer
  language plpgsql
  security definer            -- runs as the function's owner, not the caller
  set search_path = public    -- pin it, or the path can be hijacked (CVE-2018-1058)
as $$
declare
  step integer := case when dir < 0 then -1 else 1 end;  -- clamp to ±1; no big deltas
  new_count integer;
begin
  insert into til_likes (slug, likes) values (post_slug, greatest(0, step))
  on conflict (slug) do update
    set likes = greatest(0, til_likes.likes + step)
  returning likes into new_count;
  return new_count;
end;
$$;

grant execute on function bump_like to anon;  -- callable with the public key
```

`SECURITY DEFINER` is the load-bearing bit. The function runs with the privileges
of its **owner** — the table owner — who isn't subject to the table's RLS, so it
can write even though the caller can't. (It's not that definer functions "bypass
RLS" by magic; it's whose role the query runs as.) Pin the `search_path` or you
reopen a [known hijack class](https://www.postgresql.org/docs/current/sql-createfunction.html).
Net result: the only thing the public key can do to that table is read it, or
nudge a row up and down by one.

## The privacy part — which is the reason I bothered to write this

Realtime means the visitor's browser opens a connection to a third party, which
hands over an IP. That's the *same* thing I refuse Google Fonts over. So the rule
I gave both features was: **nothing connects on page load.**

- The room connects only when you click *join*. Until then there is zero contact
  with Supabase — same as today's site.
- The like count is fetched only when the button scrolls into view (an
  `IntersectionObserver`, or Astro's `client:visible`), never on load. A bounce
  or a link-preview never pings anything.
- There's no user auth, so no session and no cookie is set. The only local state
  is a first-party "you liked this" flag in `localStorage`.
- I picked an EU region (Frankfurt) so the data path stays in-bloc, and the
  server stores one integer per slug — no profiles.

Opt-in is the trick that makes this honest: it turns "passive tracking of every
visitor" into "a thing the visitor chose to switch on", which is also a much
cleaner consent story. And to keep the cost off everyone who *doesn't* opt in, I
`import()` the Supabase SDK lazily inside the join handler so it's a separate
chunk, never in the main bundle — the blog's like button skips the SDK entirely
and just `fetch`es the PostgREST endpoint.

## When not to do this

- **It isn't "no backend" — it's someone else's backend.** You've added a
  third-party dependency, its outages, and its terms to a site whose whole appeal
  was being static. Say that out loud before you commit to it.
- **The free tier sleeps.** A project pauses after 7 days of no activity. Fine for
  a toy that degrades gracefully — my like button just shows a blank count until
  it wakes — and wrong for anything load-bearing.
- **The publishable key can still be scripted.** RLS stops *arbitrary* writes, but
  nothing stops someone calling `bump_like` in a loop to inflate a number. For a
  like button, who cares. For votes, anything paid, anything abuse-sensitive, you
  need real rate-limiting — an edge function, a captcha, IP logic — and now you're
  running, well, a backend.
- **It only scales to sprinkles.** If more than a couple of features need it, or
  any one of them is essential, stop pretending and use an actual server.

The rule of thumb I landed on: if the feature can vanish and the page is still
fine, ride a free realtime backend straight from the client. If its absence
breaks the experience, run the backend yourself.

## Follow-up resources

- [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast) — fan-out messages with no database.
- [Supabase Presence](https://supabase.com/docs/guides/realtime/presence) — tracking who's connected.
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) — why public channels need no policies, and how to lock private ones.
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security) — the read-only-for-anon half of the lockdown.
- [Postgres `CREATE FUNCTION`](https://www.postgresql.org/docs/current/sql-createfunction.html) — `SECURITY DEFINER` and the `search_path` warning, from the source.

Turns out "static site" was never the constraint I thought it was — only a
reminder to keep the live parts optional.
