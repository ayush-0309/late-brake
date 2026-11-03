// Works out what each car colour costs in every currency the shop sells in
// (tools/currencies.mjs) and writes the table to src/prices.js, which the
// Garage shows. The list price is the US dollar price in COLOURS
// (src/medals.js). Each country pays a share of it set by its price level
// (purchasing power parity: prices in India are about a quarter of US ones),
// converted at today's exchange rate and rounded to a price that looks normal
// there, like ₹99, €1.49 or ¥199.
//
//   node tools/make-prices.mjs
//
// Check the table it prints, commit src/prices.js, then run
// tools/dodo-products.mjs so the checkout charges the same amounts.
//
// Price levels: the World Bank's PPP conversion factor for private
// consumption (PA.NUS.PRVT.PP) over the official exchange rate (PA.NUS.FCRF),
// in the latest year with both. Exchange rates: ExchangeRate-API
// (open.er-api.com).

import { writeFileSync } from 'node:fs';
import { COLOURS } from '../src/medals.js';
import { CURRENCIES } from './currencies.mjs';

const MIN_SHARE = 30; // no country pays less than this % of the list price (Dodo's own PPP floor)
const MIN_USD = 0.99; // nor less than this in dollars: fees would take most of a smaller payment
const DODO_MIN_USD = 0.5; // Dodo's smallest payment anywhere, the floor for the coffee (a `tip` colour)
const STEPS = [1, 1.2, 1.5, 1.8, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9]; // round numbers to price at, times 10ⁿ

const paid = COLOURS.filter((c) => c.usd > 0);

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// { USA: { 2025: 1, 2024: 1, … }, … }
async function worldBank(indicator, codes) {
  const [, rows] = await getJSON(`https://api.worldbank.org/v2/country/${codes.join(';')}/indicator/${indicator}?format=json&date=2015:2035&per_page=2000`);
  const out = {};
  for (const r of rows ?? []) if (r.value != null) (out[r.countryiso3code] ||= {})[r.date] = r.value;
  return out;
}

const countries = [...new Set(CURRENCIES.flatMap((c) => c.wb))];
const [ppp, fx, latest] = await Promise.all([
  worldBank('PA.NUS.PRVT.PP', countries),
  worldBank('PA.NUS.FCRF', countries),
  getJSON('https://open.er-api.com/v6/latest/USD'),
]);
if (latest.result !== 'success') throw new Error('No exchange rates from open.er-api.com');

// Prices in a country as a share of US prices, and the year that's from.
function priceLevel(country) {
  const year = Object.keys(ppp[country] ?? {}).filter((y) => fx[country]?.[y]).sort().pop();
  if (!year) throw new Error(`The World Bank has no price level for ${country}`);
  return { level: ppp[country][year] / fx[country][year], year };
}

// The prices a currency can have, cheapest first, each with the round number
// it comes from: 1.99 where a unit of the currency is worth a lot (dollars,
// euros), 99 where it isn't (rupees, yen), and round from 1,000 up (₩1,800,
// Rp18.000). Under 100 of a small unit only 19, 29 … 89, since 34 or 44
// looks odd as a price.
function ladder(rate) {
  const out = [];
  for (let k = -1; k <= 7; k++) {
    for (const m of STEPS) {
      const n = Math.round(m * 10 ** k * 100) / 100;
      if (rate >= 10 && (n < 10 || (n < 100 && !Number.isInteger(m)))) continue;
      const price = n >= 1000 ? n : rate < 10 ? Math.round(n * 100 - 1) / 100 : n - 1;
      out.push({ n, price });
    }
  }
  return out;
}

const years = new Set();
const table = {};
for (const cur of CURRENCIES) {
  const rate = latest.rates[cur.code];
  if (!rate) throw new Error(`No exchange rate for ${cur.code}`);
  const levels = cur.wb.map(priceLevel);
  levels.forEach((l) => years.add(l.year));
  const level = levels.reduce((sum, l) => sum + l.level, 0) / levels.length;
  const share = Math.min(100, Math.max(MIN_SHARE, Math.round(level * 20) * 5));
  const floor = Math.max(cur.min, MIN_USD * rate);
  const steps = ladder(rate);
  const prices = {};
  let last = 0;
  for (const c of paid) {
    // The nearest price, but never below the floor, and each colour dearer
    // than the one before. The coffee only has to be one Dodo can charge.
    const x = (c.usd * share) / 100 * rate;
    let i = steps.reduce((best, s, j) => Math.abs(Math.log(s.n / x)) < Math.abs(Math.log(steps[best].n / x)) ? j : best, 0);
    if (c.tip) {
      while (steps[i].price < Math.max(cur.min, DODO_MIN_USD * rate)) i++;
      prices[c.id] = steps[i].price;
      continue;
    }
    while (steps[i].price < floor || steps[i].price <= last) i++;
    last = prices[c.id] = steps[i].price;
  }
  table[cur.code] = { share, rate, prices };
}

const day = new Date(latest.time_last_update_unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const rows = Object.entries(table).map(([code, { share, prices }]) =>
  `  ${code}: { ${paid.map((c) => `${c.id}: ${prices[c.id]}`).join(', ')} }, // ${share}%`);
writeFileSync(new URL('../src/prices.js', import.meta.url), `// What each car colour costs in every currency the shop sells in, in whole units
// of the currency (dollars, rupees), taxes included, with the share of the US
// price that's paid there. Shown in the Garage, and charged by each colour's
// Dodo Payments product (tools/dodo-products.mjs sets them).
//
// Generated by tools/make-prices.mjs from World Bank price levels (${[...years].sort().join(', ')}) and
// exchange rates of ${day}: don't edit, change the tool and run it again.

export const PRICES = {
${rows.join('\n')}
};
`);

console.log(`Prices at exchange rates of ${day}:\n`);
for (const [code, { share, rate, prices }] of Object.entries(table)) {
  const usd = paid.filter((c) => !c.tip).map((c) => prices[c.id] / rate);
  console.log(`${code.padEnd(4)}${String(share).padStart(4)}%  ${paid.map((c) => String(prices[c.id]).padStart(8)).join('')}   ($${usd[0].toFixed(2)} to $${usd.at(-1).toFixed(2)})`);
}
console.log('\nWrote src/prices.js. Commit it, then run tools/dodo-products.mjs to set the same prices on Dodo.');
