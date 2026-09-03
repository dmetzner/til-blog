---
title: "You can add a backend to a static site without running one"
description: "A \"who else is here\" room and per-post likes on two sites that have no server at all — and nothing at all connects until the visitor asks it to."
pubDate: 2026-07-26
tags: ["web", "databases", "security", "til"]
draft: false
---

Both my sites are static. The portfolio and this blog are each just a pile of
files, rebuilt and shipped on every push — nothing to patch, nothing to pay for,
nothing that can be up at 3am doing something I didn't ask for. I wanted to keep
it exactly that way and still add two live touches: a small "who else is here
right now" room with shared emoji on the portfolio, and per-post likes here.

Normally that means running something. It doesn't have to. A hosted service can
talk to the *visitor's* browser directly, so my sites stay files on a CDN and the
liveness is borrowed — and there was far less to it than I expected.

The room stores
nothing at all — no table, no records; it's people connected at the same time,
and when you close the tab your presence is simply gone. The likes have to
survive, so that's a real stored number.

That one needs thought, because the key my sites use is public. It ships inside
the page; anyone can read it. If the browser is allowed to write the like count
directly, then anyone can set any post's count to 99,999 from a terminal. So the
table is **read-only** to the public, and the only way to change it is one small
function whose entire power is to move a number by exactly one. Ask it to add a
thousand and it adds one — the same
[key-is-a-name-tag-not-a-password](/posts/one-supabase-project-three-static-apps/)
idea, one function narrower.

## The privacy part, which is why I bothered

A live connection means the visitor's browser reaches out to a third party, and
that hands over their IP address. That is *exactly* the thing I refuse Google
Fonts over, so refusing it there and shrugging here would be nonsense. The rule I
gave both features: **nothing connects on page load.**

- The room connects when you click *join*. Before that, there is no contact at
  all.
- The like count is fetched only once the button is actually on your screen. Open
  a post, read the top, leave — nothing was ever asked.
- There are no accounts, so no session and no cookie. The only thing stored on
  your side is a first-party note that you liked something, so the button
  remembers.
- The data sits in Frankfurt, and what's stored is one number per post. There is
  nothing resembling a profile because there's nothing to build one from.

And as a bonus, the code for it never even loads for anyone who doesn't opt in.

## When not to do this

- **It isn't "no backend" — it's someone else's.** You've added a third party,
  their outage, and their terms to a site whose appeal was having none of that.
  Say it out loud before you commit.
- **The free tier goes to sleep** after a week without traffic. Fine for
  something that can be blank for a moment, wrong for anything load-bearing.
- **A narrow write path isn't a rate limit.** Nothing stops someone calling my
  +1 function in a loop. For a like button, who cares. For votes, or anything
  with money attached, you need a real limiter — and at that point you're
  running a backend after all.
- **It only scales to sprinkles.** More than a couple of features, or one that
  actually matters, and you should stop pretending.

The rule of thumb I landed on: if the feature can vanish and the page is still
fine, borrow a backend from the browser. If its absence breaks the experience,
run one yourself.

## The code, and the SQL that nails the write path shut

The room is pure Realtime — presence counts connected clients, broadcast fans out
the emoji, no Postgres row either way:

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

A public channel needs no policies at all: Realtime Authorization (RLS on
`realtime.messages`) is opt-in, and only applies to channels you mark `private`.

The likes table has RLS on with the anon role granted **read only** — no insert,
update or delete — and exactly one function as the write path:

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

`SECURITY DEFINER` is the load-bearing bit: the function runs as its **owner** —
the table owner — who isn't subject to the table's RLS, so it can write where the
caller can't. Pin `search_path` or you reopen a
[known hijack class](https://www.postgresql.org/docs/current/sql-createfunction.html).

On the client side, the Supabase SDK is `import()`ed lazily inside the join
handler so it's a separate chunk and never in the main bundle. The blog's like
button skips the SDK entirely and just `fetch`es the PostgREST endpoint when it
scrolls into view (`IntersectionObserver`, or Astro's `client:visible`).

## Follow-up resources

- [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast) — fan-out messages with no database.
- [Supabase Presence](https://supabase.com/docs/guides/realtime/presence) — tracking who's connected.
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) — why public channels need no policies, and how to lock private ones.
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security) — the read-only-for-anon half of the lockdown.
- [Postgres `CREATE FUNCTION`](https://www.postgresql.org/docs/current/sql-createfunction.html) — `SECURITY DEFINER` and the `search_path` warning, from the source.

Turns out "static site" was never the constraint I thought it was — only a
reminder to keep the live parts optional.
