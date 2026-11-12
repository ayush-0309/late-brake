-- Optional, run once after schema.sql: gives every guest account (anyone could
-- play as one until November 2026) a made-up name ("Guest 48213"), so the
-- names they took are free again for Google accounts. Their laps stay; only
-- the name on the leaderboards changes, and if they add Google later they pick
-- a name then. Guests who already added Google aren't touched.
--
-- To see whose name would change first, run just this line:
--   select p.name from public.profiles p join auth.users u on u.id = p.id where u.is_anonymous and p.name !~ '^Guest [0-9]{5}$';

do $$
declare
  g record;
begin
  for g in
    select p.id from public.profiles p join auth.users u on u.id = p.id
    where u.is_anonymous and p.name !~ '^Guest [0-9]{5}$'
  loop
    loop
      begin
        update public.profiles set name = 'Guest ' || (10000 + floor(random() * 90000))::int where id = g.id;
        exit;
      exception when unique_violation then
        null; -- that number is taken: try another
      end;
    end loop;
  end loop;
end $$;
