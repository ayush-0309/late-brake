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

## Selling car colours (optional)

Players can buy locked car colours in the Garage with Dodo Payments (UPI, cards and more). Dodo is the merchant of
record: it handles tax, invoices and payment methods, and pays you out. The checkout opens over the game, and a bank
step can take players away for a moment before bringing them back. It stays off until `shop: true` in
`src/config.js`. Buying needs a Google account, so a purchase follows the player to any device.

Prices are in the player's currency, 44 of them, guessed from the device's time zone and changeable in the Garage.
The list price is in US dollars (`usd` in `COLOURS`, `src/medals.js`); other countries pay a share of it set by their
price level (purchasing power parity), from 30% in India to 100% in the US and Switzerland, and never under about a
dollar, since fees take most of a smaller payment. `tools/make-prices.mjs` works this out into `src/prices.js`.
Players can pick any currency, and Dodo's checkout lets them switch too, so someone abroad could pay a cheaper
country's price; for a cosmetic that's an accepted cost of fair prices.

1. **Dodo account.** Sign up at https://dodopayments.com and complete business verification. Dodo reviews your
   website before live payments: have terms, a privacy policy, a refund policy and a contact page, with prices shown.
   Everything below starts in **Test mode** (no real money).
2. **Adaptive Currency.** In Dodo, **Settings → Business**: turn on **Adaptive Currency**, which lets the checkout
   charge in the player's currency. Leave Dodo's **Purchasing Power Parity** off: the game's prices already include it.
3. **API key.** **Developer → API Keys → Add API key**, with **Write** access to Products and to checkouts and at least
   **Read** to Payments, and copy it. It goes only into Supabase and the products tool below, never into the game.
4. **Products.** In a terminal in the game's folder, run `node tools/dodo-products.mjs` and paste the key when it
   asks (it isn't shown or saved). It makes one product per colour, priced in rupees with tax included, gives each a
   fixed price in every other currency from `src/prices.js`, then checks that Dodo's checkout charges what the
   Garage shows. It ends by printing the product ids for step 8. Running it again updates the same products.
5. **Table.** Run `schema.sql` again in the **SQL Editor**. It adds `purchases` and leaves everything else as it is.
6. **Function.** **Edge Functions → Deploy a new function → Via Editor**, name it `shop`, paste
   `functions/shop/index.ts` and deploy (if it's there already, open it, paste the new code and deploy again). Then
   open its settings and turn **Verify JWT** off (Dodo's webhook has no Supabase token; the function checks the
   player itself). With the Supabase CLI instead: `supabase functions deploy shop --no-verify-jwt`.
7. **Webhook.** In Dodo, **Developer → Webhooks → Add endpoint**: URL
   `https://<project ref>.supabase.co/functions/v1/shop`, events **payment.succeeded** and **refund.succeeded**.
   Copy its signing secret (`whsec_…`). This makes a payment count even if the player closes the page before the
   game checks it, and takes a colour back when you refund it.
8. **Secrets.** **Edge Functions → Secrets** in Supabase:
   - `DODO_API_KEY`: the key from step 3
   - `DODO_WEBHOOK_SECRET`: the `whsec_…` secret from step 7
   - `DODO_MODE`: `test`
   - `DODO_PRODUCTS`: the line step 4 printed, like
     `{"green":"pdt_…","pearl":"pdt_…","purple":"pdt_…","pink":"pdt_…","volt":"pdt_…","gold":"pdt_…"}`
9. **Switch it on.** Set `shop: true` in `src/config.js` and deploy the site.

Test with Dodo's test cards, then for real money switch Dodo to **Live mode**: turn on Adaptive Currency there too,
make a live API key, run `node tools/dodo-products.mjs --live` with it, add the webhook again, and update the four
secrets (`DODO_MODE` to `live`). The game needs no change. Payments and refunds are in the Dodo dashboard; each
checkout is also a row in `purchases`, with the amount and currency paid.

**Changing prices.** Edit the `usd` list prices in `src/medals.js`, or the settings at the top of
`tools/make-prices.mjs`, then run `node tools/make-prices.mjs`. It also picks up today's exchange rates and the
World Bank's latest price levels, so run it every few months even without changes. Check the table it prints, run
`node tools/dodo-products.mjs` and `node tools/dodo-products.mjs --live`, then commit and deploy straight away, so
the Garage and the checkout agree.

## Publishing blog posts on time

Posts go live at the time in their front matter (India time), when the publish-blog GitHub Action rebuilds the
blog. GitHub's own timer for it starts runs hours late or not at all, so this project's cron starts it instead, a
minute after every quarter hour from 08:31 to 19:16 India time (`publish-blog.sql`). GitHub's timer stays on as
a backup.

1. On GitHub: your picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**. Name it `Late Brake blog publisher`, pick the longest expiration offered, choose
   **Only select repositories → late-brake**, and under **Repository permissions** set **Actions** to
   **Read and write**. Generate it and copy it (GitHub shows it once).
2. In Supabase, **SQL Editor**, run this with the token in place of `TOKEN`. It goes into the Vault, encrypted,
   and not into the cron job:
   ```sql
   select vault.create_secret('TOKEN', 'github_publish_token');
   ```
3. Run the whole of `publish-blog.sql` from this folder in the SQL Editor.
4. After the next quarter hour, **Integrations → Cron → Jobs** shows `publish-blog` with a run that succeeded, and
   GitHub's **Actions → Publish blog** shows a run started by `workflow_dispatch`. If GitHub has no run, this shows
   GitHub's answer (204 means it accepted):
   ```sql
   select created, status_code, content from net._http_response order by created desc limit 5;
   ```

When the token expires, GitHub answers 401: make a new one the same way and save it with
`select vault.update_secret((select id from vault.secrets where name = 'github_publish_token'), 'TOKEN');`.

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
