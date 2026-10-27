# Online setup (Supabase)

Accounts, leaderboards, the daily challenge, shared ghosts and online races
all run on one free Supabase project. Until it's set up, the game works
exactly as before with those features hidden.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project (the free plan is fine).
2. Open **SQL Editor**, paste the whole of `schema.sql` from this folder and run it.
   It creates the tables, the lap checks and the daily challenge. It's safe to run again after changes.

## 2. Sign-in

Players either **play as a guest** (pick a name, no account details at all) or **continue with Google**. A guest
can add Google later and keeps their laps; until then the guest account lives in that browser only. There are no
passwords or emails.

1. **Authentication → URL Configuration**:
   - **Site URL**: `https://www.latebrake.in/play.html`
   - **Redirect URLs**: add `https://www.latebrake.in/play.html`, `https://late-brake.vercel.app/play.html` and, for testing, `http://localhost:5173/play.html`
2. **Authentication → Sign In / Providers → User Signups**: turn on **Allow anonymous sign-ins** (guests) and
   **Allow manual linking** (it lets a guest add Google), then **Save changes**.
3. Under **Auth Providers**, turn **Email** off. The game doesn't use it, and leaving it on lets anyone use your
   project to send sign-in emails.

Guests count as monthly active users like everyone else. Supabase allows 30 new guests an hour from one IP address;
if fake guests start filling the leaderboards, turn on a CAPTCHA under **Attack Protection**.

### Google

The sign-in dialog shows **Continue with Google** once the Google provider is on.

1. In [Google Cloud Console](https://console.cloud.google.com), pick or create a project, then
   **Google Auth Platform → Get started**: app name `Late Brake`, your support email, audience **External**.
   Then **Audience → Publish app** so anyone can sign in (the basic email and profile scopes need no review).
2. **Google Auth Platform → Clients → Create client**, type **Web application**:
   - **Authorized JavaScript origins**: `https://www.latebrake.in`, `https://late-brake.vercel.app`, `http://localhost:5173`
   - **Authorized redirect URIs**: `https://<project ref>.supabase.co/auth/v1/callback` (Supabase shows the
     exact one under **Authentication → Sign In / Providers → Google**)
3. In Supabase, **Authentication → Sign In / Providers → Google**: turn it on and paste the **Client ID** and
   **Client Secret**. The redirect URLs from step 1 above apply to Google too.

Google's sign-in screen says you're continuing to `<project ref>.supabase.co`. A Supabase custom domain (a paid
add-on) changes that to your own.

## 3. Connect the game

**Project Settings → API Keys**: copy the **publishable** key (`sb_publishable_…`; older projects have a legacy
**anon** key, `eyJ…`, which works too) into `src/config.js`, with the Project URL (`https://<project ref>.supabase.co`):

```js
supabase: { url: 'https://xxxx.supabase.co', anonKey: 'sb_publishable_…' },
```

The publishable key is meant to be public: the database rules in `schema.sql` decide what it can do. Never put a
secret key (`sb_secret_…` or the legacy `service_role` key) in the game.

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
