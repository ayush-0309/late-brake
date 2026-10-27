-- Late Brake online: accounts, leaderboards, the daily challenge.
-- Run this once in your Supabase project's SQL editor (see README.md here).

-- Display names. Sign-in itself is Supabase Auth (email links).
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null unique check (name ~ '^[A-Za-z0-9 ._-]{2,20}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Circuits, with the fastest lap time the server will believe (about 10%
-- under the game's own ideal lap). Raise or lower these if the handling changes.
create table if not exists public.tracks (
  id text primary key,
  name text not null,
  min_time real not null
);
insert into public.tracks (id, name, min_time) values
  ('at-1969', 'Red Bull Ring', 62),
  ('it-1922', 'Monza', 75),
  ('gb-1948', 'Silverstone', 89),
  ('be-1925', 'Spa-Francorchamps', 99),
  ('mc-1929', 'Monaco', 68),
  ('br-1940', 'Interlagos', 68)
on conflict (id) do update set name = excluded.name, min_time = excluded.min_time;
alter table public.tracks enable row level security;
drop policy if exists "tracks are public" on public.tracks;
create policy "tracks are public" on public.tracks for select using (true);

-- Each driver's best lap per circuit, with the ghost to race against.
create table if not exists public.best_laps (
  user_id uuid not null references public.profiles on delete cascade,
  track text not null references public.tracks,
  time real not null,
  sectors real[] not null,
  ghost jsonb not null,
  set_at timestamptz not null default now(),
  primary key (user_id, track)
);
create index if not exists best_laps_by_time on public.best_laps (track, time);
alter table public.best_laps enable row level security;
drop policy if exists "laps are public" on public.best_laps;
create policy "laps are public" on public.best_laps for select using (true);

-- Best lap per driver in each day's challenge.
create table if not exists public.challenge_laps (
  day date not null,
  user_id uuid not null references public.profiles on delete cascade,
  track text not null references public.tracks,
  time real not null,
  ghost jsonb not null,
  set_at timestamptz not null default now(),
  primary key (day, user_id)
);
create index if not exists challenge_laps_by_time on public.challenge_laps (day, time);
alter table public.challenge_laps enable row level security;
drop policy if exists "challenge laps are public" on public.challenge_laps;
create policy "challenge laps are public" on public.challenge_laps for select using (true);

-- Today's challenge circuit (UTC): circuits in id order, picked by day of the year.
create or replace function public.challenge_today()
returns table (day date, track text)
language sql stable set search_path = public as $$
  with d as (select (now() at time zone 'utc')::date as day)
  select d.day, t.id
  from d, (select id, row_number() over (order by id) - 1 as k, count(*) over () as n from tracks) t
  where t.k = extract(doy from d.day)::int % t.n;
$$;
grant execute on function public.challenge_today() to anon, authenticated;

-- The only way laps get in: checked here, so nobody can write times
-- straight into the tables. Keeps the better of the old and new lap.
create or replace function public.submit_lap(
  p_track text, p_time real, p_sectors real[], p_ghost jsonb, p_challenge boolean default false
) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  floor_time real;
  samples int;
  today date := (now() at time zone 'utc')::date;
  improved boolean := false;
  best real;
  rank int;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from profiles where id = uid) then raise exception 'Pick a name first'; end if;

  select min_time into floor_time from tracks where id = p_track;
  if floor_time is null then raise exception 'Unknown circuit'; end if;
  if p_time < floor_time or p_time > 1200 then raise exception 'Lap time out of range'; end if;
  if coalesce(array_length(p_sectors, 1), 0) <> 3
     or abs((select sum(x) from unnest(p_sectors) x) - p_time) > 0.05 then
    raise exception 'Sectors do not add up';
  end if;
  if jsonb_typeof(p_ghost -> 'pts') <> 'array' or pg_column_size(p_ghost) > 300000 then
    raise exception 'Bad ghost';
  end if;
  samples := jsonb_array_length(p_ghost -> 'pts') / 3;
  if samples < 30 or abs((samples - 1) * (p_ghost ->> 'every')::real - p_time) > 1.5 then
    raise exception 'Ghost does not match the lap';
  end if;

  if p_challenge then
    if p_track <> (select c.track from challenge_today() c) then raise exception 'Not today''s circuit'; end if;
    insert into challenge_laps as c (day, user_id, track, time, ghost)
      values (today, uid, p_track, p_time, p_ghost)
      on conflict (day, user_id) do update set time = excluded.time, ghost = excluded.ghost, set_at = now()
      where c.time > excluded.time
      returning true into improved;
    select time into best from challenge_laps where day = today and user_id = uid;
    select count(*) + 1 into rank from challenge_laps where day = today and time < best;
  else
    insert into best_laps as b (user_id, track, time, sectors, ghost)
      values (uid, p_track, p_time, p_sectors, p_ghost)
      on conflict (user_id, track) do update set time = excluded.time, sectors = excluded.sectors, ghost = excluded.ghost, set_at = now()
      where b.time > excluded.time
      returning true into improved;
    select time into best from best_laps where track = p_track and user_id = uid;
    select count(*) + 1 into rank from best_laps where track = p_track and time < best;
  end if;

  return json_build_object('improved', coalesce(improved, false), 'rank', rank, 'day', today);
end;
$$;
revoke all on function public.submit_lap(text, real, real[], jsonb, boolean) from public;
grant execute on function public.submit_lap(text, real, real[], jsonb, boolean) to authenticated;
