---
title: "Three small apps can share one Supabase project"
description: "Three small apps can share one Supabase project safely if schemas stay additive and browser keys are treated as public."
pubDate: 2026-07-21
tags: ["databases", "security", "web", "til"]
draft: false
---

I have three sites — a portfolio, this blog, and
[Verso](https://verso.metzner.uk), a book library. None of them runs a server;
each one is just a pile of files sitting on someone else's CDN. And all three
talk to the *same* free database, in Frankfurt.

Which sounds like a recipe for a mess. It's been fine, and I think it comes down
to two rules.

**Only ever add.** Every change any app makes to the database is additive: a new
table, a new function, never a change to something another app owns and never a
deletion. The database is a shared *address book*, not a shared design. Re-running
one app's setup does nothing to the other two, because the other two aren't
mentioned in it.

**The key in the browser isn't a secret.** Every visitor can read the key my
sites use — it ships inside the page, by design. It's a name tag, not a password.
The real access control sits inside the database itself, decided row by row: a
stranger holding my key sees nothing at all unless they own a library or were
invited to one. That distinction is the whole trick. If you think of the key as
the lock, sharing a database across public sites is terrifying. If the rows
defend themselves, it's boring.

What surprised me is how little the three uses overlap. The portfolio has a live
"who's here" room with floating emoji and stores *nothing* — no tables at all.
This blog has like counters: one table, and a single function whose only power is
to move a number by one, so nobody with the key can set it to a million. Verso is
the real one: accounts, libraries, books, and shared access.

Sharing is the part I'd build again. There's no "invite a collaborator by email",
which would mean letting people search for strangers. Instead the owner mints a
short code, and redeeming it is the only way to join. Someone who has a code
becomes a viewer of exactly one library, and nothing else in the database moves.

Accounts exist in Verso only. The portfolio and the blog have no logins, no
sessions, no cookies — turning accounts on for one app didn't disturb the other
two at all, because they never ask who you are.

## When this stops being a good idea

- **One project is one blast radius.** A quota blowup, a paused project (the free
  tier sleeps after a week of no traffic), or one bad change hits all three at
  once. Fine for things that can be down; not fine for anything load-bearing.
- **The limits are pooled.** Storage, traffic, connections — shared. Three small
  features fit comfortably. Three real products would not.
- **The accounts are shared too.** All three sites sit on one account system. If I
  ever wanted genuinely separate user bases, that's a second project, not a
  setting.

So: a namespace you can happily share across small sites. Verso later became
[the app I actually put behind a login](/posts/bot-proofing-auth-on-a-static-site/).

## The SQL that does the work

Everything is `if not exists`, so re-running a migration is a no-op:

```sql
create table if not exists public.libraries (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name     text not null,
  created_at timestamptz not null default now()
);
```

Access control is row-level security, not client code — "owner reads and writes,
members read, editors also write":

```sql
alter table public.books enable row level security;

create policy "books_read" on public.books for select
  using (public.can_read_library(library_id));
create policy "books_insert" on public.books for insert
  with check (public.can_edit_library(library_id));
```

`can_read_library` / `can_edit_library` are `security definer` helpers so a policy
doesn't recurse through `library_members` — a policy that queries the table it's
protecting will loop.

The invite redemption is the same idea: `security definer` lets the function add a
membership row *without* users holding a general insert right, so a valid code is
the only door:

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

`/shelf?join=CODE` deep-links the whole flow.
