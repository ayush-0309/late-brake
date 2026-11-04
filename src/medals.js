// Medals per circuit and the car colours they unlock. A clean lap (inside
// track limits, not rescued) as fast as a circuit's bronze, silver or gold
// time earns that medal; the times are in track.js. Kept in this browser like
// the lap records, so storage can be blocked and every call is guarded.

const KEY = 'latebrake:medals';

export const MEDALS = ['Bronze', 'Silver', 'Gold'];

// Car colours, unlocked by medals across all circuits or bought outright.
// A gold counts as three medals (it beats the silver and bronze times too),
// so 18 is every circuit on gold. `needs: Infinity` is shop only: no medals
// win it. `usd` is the list price in US dollars;
// other currencies pay a share of it (src/prices.js, made from it by
// tools/make-prices.mjs). Coffee (`tip`) can only be bought: it's how a
// player buys the developer a coffee from the home page, priced as low as
// Dodo allows, and the colour is what makes it a sale Dodo can take.
export const COLOURS = [
  { id: 'red', name: 'Late Brake Red', paint: '#e8112d', needs: 0, usd: 0 },
  { id: 'green', name: 'Racing Green', paint: '#0f7a45', needs: 6, usd: 1.99 },
  { id: 'pearl', name: 'Pearl', paint: '#eef0f2', needs: Infinity, usd: 2.99 },
  { id: 'purple', name: 'Purple Sector', paint: '#8a2be2', needs: 12, usd: 3.99 },
  { id: 'pink', name: 'Hot Pink', paint: '#ff3fa4', needs: Infinity, usd: 4.99 },
  { id: 'volt', name: 'Volt', paint: '#b5e61d', needs: Infinity, usd: 6.99 },
  { id: 'gold', name: 'Champion Gold', paint: '#c8961e', needs: 18, usd: 9.99 },
  { id: 'coffee', name: 'Coffee', paint: '#6f4e37', needs: Infinity, usd: 0.99, tip: true },
];

// Until November 2026 every colour was won with medals, at these counts. A
// player who had won one by then keeps it: worked out once, from the medals
// this browser held, and saved under KEPT.
const KEPT = 'latebrake:kept-colours';
const OLD_NEEDS = { green: 2, pearl: 4, purple: 7, pink: 10, volt: 14 };
let kept = new Set();
try {
  const saved = localStorage.getItem(KEPT);
  if (saved) kept = new Set(JSON.parse(saved));
  else {
    const n = medalCount();
    kept = new Set(Object.keys(OLD_NEEDS).filter((id) => OLD_NEEDS[id] <= n));
    localStorage.setItem(KEPT, JSON.stringify([...kept]));
  }
} catch {}

// { [track id]: 1 bronze | 2 silver | 3 gold }
export function loadMedals() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

// Kept colours were won with medals, so they go with them.
export function clearMedals() {
  kept = new Set();
  try {
    localStorage.removeItem(KEY);
    localStorage.setItem(KEPT, '[]');
  } catch {}
}

export function medalCount(medals = loadMedals()) {
  return Object.values(medals).reduce((sum, m) => sum + m, 0);
}

// The medal a lap time is worth on a circuit: 0 none, 1 bronze, 2 silver, 3 gold.
export function medalFor(track, time) {
  let m = 0;
  track.medals.forEach((target, k) => { if (time <= target) m = k + 1; });
  return m;
}

// A clean lap finished: the medal it newly earns and the car colours that
// unlocks, or null when it's no better than the medal already held.
export function earnMedal(track, time) {
  const medals = loadMedals();
  const m = medalFor(track, time);
  if (m <= (medals[track.id] || 0)) return null;
  const before = medalCount(medals);
  medals[track.id] = m;
  try {
    localStorage.setItem(KEY, JSON.stringify(medals));
  } catch {}
  const after = medalCount(medals);
  return { medal: m, unlocked: COLOURS.filter((c) => c.needs > before && c.needs <= after && !kept.has(c.id)) };
}

// Whether a colour can be used: enough medals, kept, or bought (`owned`: ids).
export function unlocked(colour, owned) {
  return colour.needs <= medalCount() || kept.has(colour.id) || owned.has(colour.id);
}

// The colour to paint the car: the chosen one if it's unlocked, else the first.
export function colourFor(id, owned) {
  const c = COLOURS.find((x) => x.id === id);
  return c && unlocked(c, owned) ? c : COLOURS[0];
}

// A rival's car in an online race: the colour they picked, unless it's the
// free red or the same as yours, when it's their grid slot's (`slot`) so the
// cars can be told apart. Only ids from COLOURS count, never a paint sent in.
export function rivalPaint(id, mine, slot) {
  const c = COLOURS.find((x) => x.id === id);
  return c && c.needs > 0 && c !== mine ? c.paint : slot;
}
