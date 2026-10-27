// Car colour purchases with Dodo Payments (see supabase/README.md, "Selling
// car colours"). The game calls it as the signed-in player:
//   { action: 'checkout', colour, returnUrl }   starts a Dodo checkout session
//   { action: 'status', sessionId }             asks Dodo whether it was paid
// Dodo's webhook calls it too: payment.succeeded, so a payment counts even
// when the player closed the page before the game could check, and
// refund.succeeded, which takes a refunded colour back.
//
// Secrets: DODO_API_KEY, DODO_WEBHOOK_SECRET (whsec_…), DODO_MODE ('test' or
// 'live') and DODO_PRODUCTS, a JSON map of colour to Dodo product id, e.g.
// {"green":"pdt_…","pearl":"pdt_…"}. Prices are set on those products.
// Deploy with JWT verification off (the webhook has no Supabase token); the
// game's calls are checked here instead.

import { createClient } from 'npm:@supabase/supabase-js@2';

const API_KEY = Deno.env.get('DODO_API_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('DODO_WEBHOOK_SECRET') ?? '';
const MODE = Deno.env.get('DODO_MODE') === 'live' ? 'live' : 'test';
const PRODUCTS: Record<string, string> = JSON.parse(Deno.env.get('DODO_PRODUCTS') || '{}');
const DODO = MODE === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Pages a finished checkout may send the player back to.
const SITES = ['https://www.latebrake.in', 'https://latebrake.in', 'https://late-brake.vercel.app', 'http://localhost:5173'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const dodo = (path: string, init: RequestInit = {}) =>
  fetch(DODO + path, { ...init, headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!API_KEY) return reply({ error: "Payments aren't set up yet" }, 503);

  if (req.headers.get('webhook-signature')) return webhook(req.headers, await req.text());

  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return reply({ error: 'Sign in first' }, 401);
  if (user.is_anonymous) return reply({ error: 'Continue with Google first, so the colour stays yours' }, 403);

  const body = await req.json().catch(() => ({}));
  if (body.action === 'checkout') return checkout(user, body.colour, body.returnUrl);
  if (body.action === 'status') return status(user.id, body.sessionId);
  return reply({ error: 'Unknown action' }, 400);
});

async function checkout(user: { id: string; email?: string }, colour: string, returnUrl: string) {
  const product = PRODUCTS[colour];
  if (!product) return reply({ error: "That colour isn't for sale" }, 400);
  const { data: owned } = await db.from('purchases').select('id')
    .eq('user_id', user.id).eq('colour', colour).eq('status', 'paid').limit(1);
  if (owned?.length) return reply({ error: 'You already own this colour' }, 409);

  const back = SITES.some((s) => String(returnUrl).startsWith(s + '/')) ? returnUrl : `${SITES[0]}/play.html`;
  const res = await dodo('/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      product_cart: [{ product_id: product, quantity: 1 }],
      customer: user.email ? { email: user.email } : undefined,
      return_url: back,
      metadata: { user_id: user.id, colour },
    }),
  });
  const session = await res.json().catch(() => ({}));
  if (!res.ok || !session.checkout_url) return reply({ error: session.message || 'Payment provider unavailable' }, 502);
  const { error } = await db.from('purchases').insert({ id: session.session_id, user_id: user.id, colour });
  if (error) return reply({ error: 'Could not start the checkout' }, 500);
  return reply({ sessionId: session.session_id, checkoutUrl: session.checkout_url, mode: MODE });
}

// Asks Dodo about one of the player's checkout sessions, and records it once paid.
async function status(userId: string, sessionId: string) {
  const { data: row } = await db.from('purchases').select('colour, status')
    .eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (!row) return reply({ error: 'Checkout not found' }, 404);
  if (row.status !== 'created') return reply({ paid: row.status === 'paid', status: row.status, colour: row.colour });
  const res = await dodo(`/checkouts/${encodeURIComponent(sessionId)}`);
  const session = await res.json().catch(() => ({}));
  if (!res.ok) return reply({ error: 'Payment provider unavailable' }, 502);
  if (session.payment_status === 'succeeded') await markPaid(sessionId, { payment_id: session.payment_id });
  return reply({ paid: session.payment_status === 'succeeded', status: session.payment_status ?? null, colour: row.colour });
}

// Standard Webhooks: "v1,<base64 HMAC-SHA256>" over "{id}.{timestamp}.{body}",
// keyed with the base64 part of the whsec_ secret.
async function webhook(headers: Headers, raw: string) {
  const id = headers.get('webhook-id') ?? '', ts = headers.get('webhook-timestamp') ?? '';
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 5 * 60;
  const expected = WEBHOOK_SECRET && fresh ? await sign(WEBHOOK_SECRET, `${id}.${ts}.${raw}`) : '';
  const valid = !!expected && (headers.get('webhook-signature') ?? '').split(' ')
    .some((s) => s.startsWith('v1,') && same(s.slice(3), expected));
  if (!valid) return reply({ error: 'Bad signature' }, 401);

  const event = JSON.parse(raw);
  const p = event.data ?? {};
  if (event.type === 'payment.succeeded') {
    if (p.checkout_session_id) await markPaid(p.checkout_session_id, p);
    else if (p.metadata?.user_id && p.metadata?.colour) {
      // Not from a checkout session we know: record it from its metadata.
      await db.from('purchases').upsert({ id: p.payment_id, user_id: p.metadata.user_id, colour: p.metadata.colour });
      await markPaid(p.payment_id, p);
    }
  }
  if (event.type === 'refund.succeeded' && p.payment_id && !p.is_partial) {
    await db.from('purchases').update({ status: 'refunded' }).eq('payment_id', p.payment_id);
  }
  return reply({ ok: true });
}

async function markPaid(id: string, payment: { payment_id?: string; total_amount?: number; currency?: string }) {
  await db.from('purchases').update({
    status: 'paid',
    payment_id: payment.payment_id ?? null,
    amount: payment.total_amount ?? null,
    currency: payment.currency ?? null,
    paid_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'created'); // never undoes a refund
}

async function sign(secret: string, message: string) {
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...sig));
}

// Compares in constant time, so the check doesn't leak how much matched.
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
