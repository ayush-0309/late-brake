// Sets up the car colours on Dodo Payments: one product per colour, priced in
// every currency in src/prices.js, then asks Dodo's checkout what it would
// charge in each currency and checks that matches what the Garage shows. Run
// it once in test mode and once in live mode, and again whenever
// tools/make-prices.mjs changes the prices:
//
//   node tools/dodo-products.mjs          test mode
//   node tools/dodo-products.mjs --live   live mode
//
// It asks for that mode's API key (Dodo → Developer → API Keys), which isn't
// shown or saved, or reads it from DODO_API_KEY. It finds the products it
// made before by their metadata and updates them, so running it again is
// safe. At the end it prints the DODO_PRODUCTS value for Supabase.
//
// Each product's own price is in rupees, so Indian payments need no
// conversion. Every other currency gets a fixed price of its own (Dodo's
// Localized Pricing, by currency). Dodo's own PPP stays off: the prices
// already include it. Adaptive Currency has to be on (Settings → Business),
// or the checkout charges rupees whatever the player picked.

import { COLOURS } from '../src/medals.js';
import { PRICES } from '../src/prices.js';
import { CURRENCIES, WHOLE, units } from './currencies.mjs';

// A problem prints as its message alone, without Node's stack trace.
process.on('uncaughtException', (err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});

const BASE = 'INR';
const live = process.argv.includes('--live');
const HOST = process.env.DODO_URL || `https://${live ? 'live' : 'test'}.dodopayments.com`; // DODO_URL: for trying it against a pretend server
const paid = COLOURS.filter((c) => c.usd > 0);

// Reads a line from the terminal without echoing it.
function askSecret(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal, or set DODO_API_KEY');
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.off('data', onData);
          process.stdin.pause();
          process.stdout.write('\n');
          return resolve(text.trim());
        }
        text = ch === '\u007f' ? text.slice(0, -1) : text + ch;
      }
    });
    process.stdin.resume();
  });
}

const key = process.env.DODO_API_KEY?.trim() || await askSecret(`Dodo ${live ? 'LIVE' : 'test'} mode API key: `);
if (!key) throw new Error('No API key');

const GAP = Number(process.env.DODO_GAP ?? 1000); // ms between requests: Dodo's firewall blocks a script that goes much quicker
const TRIES = 10;                                  // how many times to ask while it's blocking us, a minute or so apart
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCall = 0;
async function api(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    await sleep(Math.max(0, lastCall + GAP - Date.now()));
    lastCall = Date.now();
    const res = await fetch(HOST + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (res.status === 429) {
      if (attempt === TRIES) throw new Error('Dodo is still blocking requests from this computer. Wait 15 minutes and run this again: it carries on where it stopped.');
      const wait = Number(res.headers.get('retry-after')) || 60;
      console.log(`Dodo asked to slow down. Trying again in ${wait} seconds…`);
      await sleep(wait * 1000);
      continue;
    }
    const text = await res.text();
    if (res.status === 401) throw new Error(`Dodo didn't accept the API key. Is it a ${live ? 'live' : 'test'} mode key?`);
    if (res.status === 403 && text.includes('INSUFFICIENT_PERMISSION')) {
      // Dodo names the access it wanted, like "Required: products:write".
      const needs = text.match(/Required:\W*([\w.-]+):(read|write)/i);
      throw new Error(`The API key isn't allowed to ${method} ${path.split('?')[0]}${needs ? `: it needs ${needs[2].toLowerCase() === 'write' ? 'Write' : 'Read'} access to "${needs[1]}"` : ''}. In Dodo, Developer → API Keys → Edit Permissions, then run this again.`);
    }
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  }
}

// What a colour's product should be.
const product = (c) => ({
  name: `${c.name} car colour`,
  description: 'A car colour for Late Brake. Cosmetic only: it changes how your car looks, nothing else.',
  tax_category: 'digital_products',
  price: {
    type: 'one_time_price', currency: BASE, price: units(BASE, PRICES[BASE][c.id]),
    discount_bps: 0, tax_inclusive: true, purchasing_power_parity: false,
  },
  pricing_mode: 'by_currency',
  metadata: { latebrake_colour: c.id },
});

console.log(`Dodo ${live ? 'live' : 'test'} mode. This goes slowly so Dodo doesn't block it, and can take about 6 minutes.\n`);

const existing = [];
for (let page = 0; ; page++) {
  const { items } = await api('GET', `/products?page_size=100&page_number=${page}`);
  existing.push(...items);
  if (items.length < 100) break;
}

const ids = {};
for (const c of paid) {
  const found = existing.find((p) => p.metadata?.latebrake_colour === c.id);
  if (found) {
    await api('PATCH', `/products/${found.product_id}`, product(c));
    ids[c.id] = found.product_id;
  } else {
    ids[c.id] = (await api('POST', '/products', product(c))).product_id;
  }

  // One fixed price per currency: add the missing ones, fix changed ones and
  // archive any for a currency the shop no longer sells in.
  const { items: rules } = await api('GET', `/products/${ids[c.id]}/localized-prices`);
  const left = new Map(rules.map((r) => [r.currency, r]));
  let added = 0, changed = 0;
  for (const [code, prices] of Object.entries(PRICES)) {
    if (code === BASE) continue;
    const amount = units(code, prices[c.id]);
    const rule = left.get(code);
    left.delete(code);
    if (!rule) {
      await api('POST', `/products/${ids[c.id]}/localized-prices`, { currency: code, amount });
      added++;
    } else if (rule.amount !== amount) {
      await api('PATCH', `/products/${ids[c.id]}/localized-prices/${rule.id}`, { amount });
      changed++;
    }
  }
  for (const rule of left.values()) await api('DELETE', `/products/${ids[c.id]}/localized-prices/${rule.id}`);
  console.log(`${found ? 'Updated' : 'Created'} ${c.name} (${ids[c.id]}): ${added} prices added, ${changed} changed, ${left.size} removed`);
}

// What the checkout would charge for one of each colour, in every currency.
const money = (code, amount) => `${amount / (WHOLE.has(code) ? 1 : 100)} ${code}`;
console.log('\nChecking what the checkout charges in each currency…');
const wrong = [];
for (const cur of CURRENCIES) {
  const expected = paid.reduce((sum, c) => sum + units(cur.code, PRICES[cur.code][c.id]), 0);
  const quote = await api('POST', '/checkouts/preview', {
    product_cart: paid.map((c) => ({ product_id: ids[c.id], quantity: 1 })),
    billing_currency: cur.code,
    billing_address: { country: cur.country },
  });
  if (quote.currency !== cur.code || quote.total_price !== expected) {
    wrong.push(`${cur.code}: the Garage shows ${money(cur.code, expected)}, Dodo would charge ${money(quote.currency, quote.total_price)}`);
  }
}
if (wrong.length) {
  process.exitCode = 1;
  if (wrong.length === CURRENCIES.length - 1 && !wrong.some((w) => !w.endsWith(' INR'))) {
    console.log('\nDodo charges rupees whatever the currency: turn on Adaptive Currency (Settings → Business) and run this again.');
  } else {
    console.log(`\n${wrong.length === 1 ? 'One currency doesn\'t' : `${wrong.length} currencies don't`} match, for one of each colour:\n${wrong.join('\n')}`);
  }
} else {
  console.log(`All ${CURRENCIES.length} currencies charge what the Garage shows.`);
}

console.log(`\nSupabase → Edge Functions → Secrets, DODO_PRODUCTS (${live ? 'live' : 'test'} mode):\n${JSON.stringify(ids)}`);
