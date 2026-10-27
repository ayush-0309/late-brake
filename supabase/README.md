# Online setup (Supabase)

Accounts, leaderboards, the daily challenge, shared ghosts and online races
all run on one free Supabase project. Until it's set up, the game works
exactly as before with those features hidden.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project (the free plan is fine).
2. Open **SQL Editor**, paste the whole of `schema.sql` from this folder and run it.
   It creates the tables, the lap checks and the daily challenge. It's safe to run again after changes.

## 2. Sign-in by email link

1. **Authentication → Providers**: make sure **Email** is on. Passwords aren't used; players get a sign-in link.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://ayush-0309.github.io/late-brake/play.html`
   - **Redirect URLs**: add `https://ayush-0309.github.io/late-brake/play.html` and, for testing, `http://localhost:5173/play.html`
3. Supabase's built-in email sender is rate-limited (a few emails an hour). Before launch, add your own SMTP
   under **Project Settings → Authentication → SMTP** (Resend, Postmark, Amazon SES and others work).

## 3. Connect the game

**Project Settings → API**: copy the **Project URL** and the **anon public** key into `src/config.js`:

```js
supabase: { url: 'https://xxxx.supabase.co', anonKey: 'eyJ…' },
```

The anon key is meant to be public: the database rules in `schema.sql` decide what it can do. Never put the
`service_role` key in the game.

## 4. Online races

Races use Supabase Realtime (broadcast and presence on a channel per room). Nothing to set up: it's on by
default. On the free plan, Realtime allows about 200 players connected at once and 100 messages a second
across the project; each racer sends 10 messages a second, so plan an upgrade before a big launch.

## How laps are checked

Laps only get in through `submit_lap()`, which rejects:

- times faster than each circuit's `min_time` (about 10% under the game's own ideal lap; adjust them in
  `tracks` if the car's handling changes),
- sectors that don't add up to the lap time,
- ghosts whose length doesn't match the lap.

The game runs in the player's browser, so a determined cheat can still fake a plausible lap. If that becomes
a problem, the next step is replaying uploaded ghosts on a server to check them against the track.

Rescued laps (kept with a rewarded ad) are never uploaded.

## Trying it without Supabase

Add `?online=mock` to the game's URL for a pretend backend kept in your browser. For online races between two
tabs of one browser, open both with `?online=mock&net=local` plus `&mockuser=Alpha` and `&mockuser=Bravo`.
