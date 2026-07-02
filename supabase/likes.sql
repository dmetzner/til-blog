-- Per-post "like" counts for til.metzner.uk.
-- Run once in the Supabase dashboard → SQL Editor (same EU project as the
-- portfolio's live room). Re-running is safe (idempotent).
--
-- Security model: the anon/publishable key may only READ the aggregate count.
-- All writes go through bump_like(), a SECURITY DEFINER function that hard-clamps
-- the delta to ±1 — so the public key can never be used to set arbitrary totals.

create table if not exists public.til_likes (
  slug  text primary key,
  likes integer not null default 0
);

alter table public.til_likes enable row level security;

-- Read-only access for the anon role; no insert/update/delete is ever granted.
revoke all on table public.til_likes from anon;
grant select on table public.til_likes to anon;

drop policy if exists "anon reads like counts" on public.til_likes;
create policy "anon reads like counts"
  on public.til_likes for select
  to anon
  using (true);

-- The only write path. dir is clamped to ±1, the count floored at 0, and the
-- row upserted. Runs as the table owner (security definer), bypassing RLS for
-- the write while anon still has no direct table-write grant.
--
-- post_slug is validated against the slug grammar BEFORE any insert so the
-- public key can't create unbounded arbitrary-length rows (storage-exhaustion
-- on the shared project). Real post slugs are lowercase alphanumerics, hyphens,
-- and optional subdirectory slashes.
create or replace function public.bump_like(post_slug text, dir integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  step integer := case when dir < 0 then -1 else 1 end;
  new_count integer;
begin
  if post_slug !~ '^[a-z0-9]+(?:[-/][a-z0-9]+)*$' or length(post_slug) > 120 then
    raise exception 'invalid slug';
  end if;

  insert into public.til_likes as t (slug, likes)
    values (post_slug, greatest(0, step))
  on conflict (slug)
    do update set likes = greatest(0, t.likes + step)
  returning t.likes into new_count;
  return new_count;
end;
$$;

grant execute on function public.bump_like(text, integer) to anon;
