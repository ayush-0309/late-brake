// Buying a car colour with Dodo Payments: the shop Edge Function starts a
// checkout session and Dodo's checkout opens over the game. Paying takes the
// player through any bank step and back to this page, where resumeCheckout
// asks the function whether it was paid. Prices are in the currency the player
// picks (src/prices.js), and the checkout charges in that currency.

import { PRICES } from './prices.js';

const CHECKOUT_JS = 'https://cdn.jsdelivr.net/npm/dodopayments-checkout@2.0.0/dist/index.js';
const PENDING = 'latebrake:checkout'; // a checkout to look up again after a reload
const WAIT = [0, 1500, 3000, 5000];   // ms before each ask while a payment is processing
export const PAYMENT_FAILED = "That payment didn't go through, so you haven't been charged. Try again or use another card.";

let sdk = null;       // Dodo's checkout, set up once per page
let finished = null;  // ends the wait on the open checkout

export const CURRENCIES = Object.keys(PRICES);

// Time zones and the currency paid there, for a first guess at the player's
// currency. A name without a region carries on the one before it, and
// "Region/*" is every zone in it. Anywhere else gets US dollars.
const ZONES = {
  EUR: 'Europe/Amsterdam Andorra Athens Berlin Bratislava Brussels Busingen Dublin Helsinki Lisbon Ljubljana Luxembourg Madrid Malta Mariehamn Monaco Paris Podgorica Riga Rome San_Marino Tallinn Vatican Vienna Vilnius Zagreb Atlantic/Azores Canary Madeira Africa/Ceuta',
  GBP: 'Europe/London Belfast Guernsey Isle_of_Man Jersey',
  INR: 'Asia/Kolkata Calcutta',
  CAD: 'America/Toronto Montreal Vancouver Edmonton Winnipeg Regina Halifax St_Johns Moncton Glace_Bay Goose_Bay Whitehorse Dawson Dawson_Creek Fort_Nelson Creston Yellowknife Inuvik Iqaluit Rankin_Inlet Resolute Cambridge_Bay Swift_Current Atikokan Nipigon Thunder_Bay Rainy_River Pangnirtung Blanc-Sablon Canada/*',
  AUD: 'Australia/*',
  NZD: 'Pacific/Auckland Chatham NZ',
  CHF: 'Europe/Zurich Vaduz',
  SEK: 'Europe/Stockholm',
  NOK: 'Europe/Oslo Arctic/Longyearbyen',
  DKK: 'Europe/Copenhagen Atlantic/Faroe America/Nuuk Godthab Danmarkshavn Scoresbysund Thule',
  PLN: 'Europe/Warsaw',
  CZK: 'Europe/Prague',
  HUF: 'Europe/Budapest',
  RON: 'Europe/Bucharest',
  TRY: 'Europe/Istanbul Asia/Istanbul',
  JPY: 'Asia/Tokyo',
  KRW: 'Asia/Seoul',
  HKD: 'Asia/Hong_Kong',
  SGD: 'Asia/Singapore',
  MYR: 'Asia/Kuala_Lumpur Kuching',
  IDR: 'Asia/Jakarta Makassar Jayapura Pontianak',
  PHP: 'Asia/Manila',
  THB: 'Asia/Bangkok',
  VND: 'Asia/Ho_Chi_Minh Saigon',
  AED: 'Asia/Dubai',
  SAR: 'Asia/Riyadh',
  QAR: 'Asia/Qatar',
  ILS: 'Asia/Jerusalem Tel_Aviv',
  EGP: 'Africa/Cairo',
  MAD: 'Africa/Casablanca',
  ZAR: 'Africa/Johannesburg',
  NGN: 'Africa/Lagos',
  BRL: 'America/Sao_Paulo Araguaina Bahia Belem Boa_Vista Campo_Grande Cuiaba Eirunepe Fortaleza Maceio Manaus Noronha Porto_Velho Recife Rio_Branco Santarem Brazil/*',
  MXN: 'America/Mexico_City Bahia_Banderas Cancun Chihuahua Ciudad_Juarez Hermosillo Matamoros Mazatlan Merida Monterrey Ojinaga Tijuana Mexico/*',
  CLP: 'America/Santiago Punta_Arenas Pacific/Easter Chile/*',
  PEN: 'America/Lima',
  UYU: 'America/Montevideo',
  DOP: 'America/Santo_Domingo',
  CRC: 'America/Costa_Rica',
  BDT: 'Asia/Dhaka Dacca',
  LKR: 'Asia/Colombo',
  NPR: 'Asia/Kathmandu Katmandu',
  KZT: 'Asia/Almaty Aqtau Aqtobe Atyrau Oral Qostanay Qyzylorda',
};
const BY_ZONE = {};
for (const [currency, zones] of Object.entries(ZONES)) {
  let region = '';
  for (const z of zones.split(' ')) {
    if (z.includes('/')) region = z.split('/')[0];
    BY_ZONE[z.includes('/') ? z : `${region}/${z}`] = currency;
  }
}

// The currency to show prices in: the one the player picked, else a guess
// from the device's time zone (worked out here, nothing is sent).
export function shopCurrency(picked) {
  if (PRICES[picked]) return picked;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {}
  const guess = BY_ZONE[zone] || BY_ZONE[`${zone.split('/')[0]}/*`];
  return PRICES[guess] ? guess : 'USD';
}

// "Indian Rupee", or the code where the browser has no name for it.
export function currencyName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) || code;
  } catch {
    return code;
  }
}

// A colour's price, like "₹99" or "€1.49", written the way the browser writes money.
export function priceText(colour, currency) {
  const amount = PRICES[currency][colour.id];
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// True once the colour is the player's, false if they closed checkout
// without paying. Throws if the payment failed or is still processing. A
// finished payment leaves the page, so it ends in resumeCheckout instead.
export async function buyColour(online, colour, currency) {
  const session = await online.startCheckout(colour.id, location.origin + location.pathname, currency);
  // The pretend backend (?online=mock) has no checkout to open.
  if (!session.mock) {
    remember(session.sessionId);
    await openCheckout(session);
  }
  const result = await settle(online, session.sessionId);
  if (!result.paid && result.status === 'processing') {
    throw new Error('Your payment is still processing. The colour appears as soon as it clears.');
  }
  if (result.status === 'failed') throw new Error(PAYMENT_FAILED);
  return result.paid;
}

// Back from Dodo's checkout, or a reload cut one short: what became of the
// payment, as { paid, status, colour }, or null if there's none to look up.
export async function resumeCheckout(online) {
  const id = read(PENDING);
  if (!id) return null;
  // Dodo's return page adds these; they're not needed once we're back.
  const url = new URL(location.href);
  for (const p of ['payment_id', 'status', 'email', 'license_key']) url.searchParams.delete(p);
  history.replaceState(history.state, '', url);
  return settle(online, id, true).catch(() => null);
}

// Asks until the payment settles (paid, failed or never made) or the waits
// run out; a payment still processing stays remembered for next time. `back`:
// just returned from the checkout, where Dodo may not have a final status yet.
async function settle(online, sessionId, back = false) {
  const open = (s) => s === 'processing' || (back && s !== 'failed' && s !== 'cancelled');
  let result;
  for (const ms of WAIT) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    result = await online.checkPayment(sessionId);
    if (result.paid || !open(result.status)) break;
  }
  if (result.paid || result.status !== 'processing') remember(null);
  return result;
}

async function openCheckout(session) {
  await loadScript();
  if (!sdk) {
    sdk = window.DodoPaymentsCheckout.DodoPayments;
    // Initialize once: every call adds another message listener.
    sdk.Initialize({
      mode: session.mode,
      displayType: 'overlay',
      onEvent: ({ event_type: type }) => {
        if (type === 'checkout.closed') finished?.();
      },
    });
  }
  await new Promise((resolve) => {
    finished = resolve;
    sdk.Checkout.open({ checkoutUrl: session.checkoutUrl });
  });
  finished = null;
}

let loading = null;
function loadScript() {
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_JS;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error("Couldn't load the payment window. Check your connection.")); };
    document.head.appendChild(s);
  });
  return loading;
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function remember(sessionId) {
  try {
    if (sessionId) localStorage.setItem(PENDING, sessionId);
    else localStorage.removeItem(PENDING);
  } catch {}
}
