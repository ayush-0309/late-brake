// Medals per circuit and the car colours they unlock. A clean lap (inside
// track limits, not rescued) as fast as a circuit's bronze, silver or gold
// time earns that medal; the times are in track.js. Kept in this browser like
// the lap records, so storage can be blocked and every call is guarded.

const KEY = 'latebrake:medals';

export const MEDALS = ['Bronze', 'Silver', 'Gold'];

// Car colours, unlocked by medals across all circuits or bought outright.
// A gold counts as three medals (it beats the silver and bronze times too),
// so 18 is every circuit on gold. `price` is in rupees, as shown in the
// game; what's charged is the price on each colour's Dodo Payments product,
// so keep the two in step.
export const COLOURS = [
  { id: 'red', name: 'Late Brake Red', paint: '#e8112d', needs: 0, price: 0 },
  { id: 'green', name: 'Racing Green', paint: '#0f7a45', needs: 2, price: 99 },
  { id: 'pearl', name: 'Pearl', paint: '#eef0f2', needs: 4, price: 149 },
  { id: 'purple', name: 'Purple Sector', paint: '#8a2be2', needs: 7, price: 199 },
  { id: 'pink', name: 'Hot Pink', paint: '#ff3fa4', needs: 10, price: 249 },
  { id: 'volt', name: 'Volt', paint: '#b5e61d', needs: 14, price: 349 },
  { id: 'gold', name: 'Champion Gold', paint: '#c8961e', needs: 18, price: 499 },
];

// { [track id]: 1 bronze | 2 silver | 3 gold }
export function loadMedals() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function clearMedals() {
  try {
    localStorage.removeItem(KEY);
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
  return { medal: m, unlocked: COLOURS.filter((c) => c.needs > before && c.needs <= after) };
}

// Whether a colour can be used: enough medals, or bought (`owned`: ids).
export function unlocked(colour, owned) {
  return colour.needs <= medalCount() || owned.has(colour.id);
}

// The colour to paint the car: the chosen one if it's unlocked, else the first.
export function colourFor(id, owned) {
  const c = COLOURS.find((x) => x.id === id);
  return c && unlocked(c, owned) ? c : COLOURS[0];
}
