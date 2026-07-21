---
title: "One Supabase project, three static apps"
description: "A portfolio, a blog and a book-library PWA all share one free Supabase project — three completely different backends living in the same database without stepping on each other."
pubDate: 2026-07-21
tags: ["databases", "security", "web", "til"]
draft: false
---

I have three static sites — a React portfolio, this Astro blog, and now
[Verso](https://verso.metzner.uk), a book-library PWA. None of them runs a
server. All three deploy as a pile of files to a CDN. And all three talk to the
*same* Supabase project, in Frankfurt, on the free tier.

That last part sounds like a recipe for a mess: three apps, one database, one set
of credentials. What I learned building Verso is that it's fine — as long as you
treat the schema as additive and let RLS, not the API key, be the security
boundary.

## Three apps, three different shapes of backend

The interesting thing is that the three uses barely overlap:

- **Portfolio** — a live "who's here" room with floating emoji. Pure Realtime
  presence + broadcast. **Zero tables.** Nothing is stored.
- **This blog** — per-post likes. One `til_likes` table, and a single
  `bump_like` function that moves a counter by ±1.
- **Verso** — the big one. Email+password *auth*, and four tables
  (`libraries`, `library_members`, `books`, `invites`) with row-level security,
  plus a `redeem_invite` RPC so you can share a library read-only.

Three apps, and the only thing they have in common is the connection URL and a
publishable key. They never read each other's data because they never ask for
it.

## Additive schema: `create ... if not exists`

The rule that keeps them from colliding is boring and load-bearing: **every
migration is additive.** New tables, new functions, never a destructive change to
something another app owns. Verso's schema opens with:

```sql
create table if not exists public.libraries (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name     text not null,
  created_at timestamptz not null default now()
);
```

`if not exists` everywhere means re-running the migrations is a no-op, and the
blog's `til_likes` table simply isn't in Verso's field of view. The database is a
shared *namespace*, not a shared schema. Nobody `drop`s anything.

## RLS is the security boundary — the key is public on purpose

The thing that trips people up: the anon / publishable key sits in plain sight in
every visitor's browser. That is *by design*. It's not a secret; it's an
identifier. The actual access control lives in Postgres, in row-level security
policies.

Verso's rule is "owner reads/writes everything, members read, editors also
write," and it's enforced at the row level, not in the client:

```sql
alter table public.books enable row level security;

create policy "books_read" on public.books for select
  using (public.can_read_library(library_id));
create policy "books_insert" on public.books for insert
  with check (public.can_edit_library(library_id));
```

`can_read_library` / `can_edit_library` are `security definer` helpers so the
policies don't recurse through `library_members` (a policy that queries the same
table it's protecting will loop). Once RLS is on, it doesn't matter that a
stranger has the key — they can only see rows the policies let them see, and for
Verso that's *nothing* unless they own or are a member of a library.

## Owner-only-edit sharing, via invite codes

Sharing is the neat part. There's no "add a collaborator by email" flow that
needs to look up strangers. Instead the owner mints a short code:

```sql
create or replace function public.redeem_invite(invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select * into inv from public.invites where code = invite_code;
  if inv.code is null then raise exception 'invalid invite'; end if;
  if inv.created_by <> auth.uid() then
    insert into public.library_members (library_id, user_id, role)
      values (inv.library_id, auth.uid(), inv.role)
      on conflict (library_id, user_id) do update set role = excluded.role;
  end if;
  return inv.library_id;
end; $$;
```

A signed-in user redeems the code and becomes a `viewer`. The
`security definer` lets the function insert a membership row *without* granting
users a general "insert into `library_members`" right — the only way in is
through a valid code. `/shelf?join=CODE` deep-links the whole thing.

## Auth belongs to one app, and stays there

Only Verso uses Supabase Auth. The portfolio and the blog have no accounts, no
sessions, no cookies — the portfolio's room and the blog's likes work
anonymously with the same key. Turning auth *on* for Verso didn't disturb them at
all, because auth in Supabase is just another schema (`auth.users`) that the
other two apps never query. A logged-in Verso session and an anonymous like on
the blog coexist without either knowing about the other.

## When this stops being a good idea

- **One project = one blast radius.** A quota blowup, a paused project (the free
  tier sleeps after 7 days idle), or a bad migration hits all three at once.
  For toys that degrade gracefully, fine; for anything load-bearing, split them.
- **Shared limits.** Connection counts, storage, egress — all pooled. Three
  sprinkle-features fit comfortably; three real products would not.
- **The key can still be scripted.** RLS stops *unauthorized* reads and writes,
  but nothing stops someone hammering a public RPC. For likes and invites, who
  cares. For anything abuse-sensitive, you need real rate-limiting.

The rule of thumb: one project is a *namespace* you can happily share across
small static apps, as long as each app owns its own tables, never drops anyone
else's, and leans on RLS — not the secrecy of a key — to keep the data straight.
