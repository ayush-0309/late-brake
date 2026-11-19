// The daily challenge's twists, records and streak. Each day's challenge is
// one circuit (picked by the server, see challenge_today() in
// supabase/schema.sql) with one twist that changes the car or the rules.
// The twist comes from the date the same way the circuit does, so everyone
// gets the same one. It changes every day, and with six circuits and six
// twists each pairing comes round once in 36 days. No DOM here, so it can
// run headless too.

import { CAR } from './car.js';
import { buildLine } from './line.js';
import { TRACKS } from './track.js';

// `tune` multiplies CAR's handling (car.js); `offLimit` replaces the track
// limit (session.js: metres the car centre may go past the edge). The line
// and the AI drivers are worked out for the changed car, so the painted
// braking zones are right for it.
export const TWISTS = [
  { id: 'wet', name: 'Wet track', blurb: 'Less grip everywhere: brake early, go gently on the power',
    tune: { grip: 0.7, downforce: 0.7, traction: 0.7 } },
  { id: 'lowdf', name: 'Low downforce', blurb: 'Quick on the straights, nervous in the fast corners',
    tune: { downforce: 0.6, aeroDrag: 0.75 } },
  // More traction than this and the AI spins its wheels out of slow
  // corners, so the extra power shows at the top end.
  { id: 'rocket', name: 'Rocket engine', blurb: '40 km/h more top speed: the corners come up sooner',
    tune: { power: 1.4, traction: 1.04 } },
  // Braking is limited by grip, not the brakes, so less grip is what makes
  // it stop later (and corner slower).
  { id: 'heavy', name: 'Heavy car', blurb: 'Slow to pick up speed, longer to stop, slower through corners',
    tune: { traction: 0.8, power: 0.85, grip: 0.85, downforce: 0.85 } },
  // Quicker, further steering, and the car may turn past its grip (yawCap)
  // and is slower to straighten (align): a tap of the keys makes it dart
  // and the rear step out. Steered smoothly, it's no slower.
  { id: 'twitchy', name: 'Twitchy steering', blurb: 'The car darts at every input and the rear steps out: steer gently',
    tune: { steerMax: 1.4, steerIn: 2.5, steerOut: 2.5, align: 0.35, yawCap: 1.5 } },
  // Half the usual allowance: the car centre 0.6 m past the edge has both
  // outside wheels over it (OFF_LIMIT is all four).
  { id: 'strict', name: 'Strict limits', blurb: 'Two wheels over the white line deletes the lap',
    offLimit: 0.6 },
];

// Bronze, silver and gold for each circuit and twist: the best flying lap of
// a lone AI driver at easy, medium and hard skill with the twist on, rounded
// up to the half second. Made by `node tools/medal-times.mjs --challenge`.
export const CHALLENGE_MEDALS = {
  'at-1969': { wet: [94, 87.5, 84.5], lowdf: [79.5, 74.5, 71.5], rocket: [76.5, 71.5, 68.5], heavy: [87, 80.5, 77.5], twitchy: [79.5, 74, 70.5], strict: [79, 74, 71] }, // Spielberg
  'it-1922': { wet: [111.5, 104, 99.5], lowdf: [95.5, 89, 85.5], rocket: [92, 85.5, 81.5], heavy: [105, 97.5, 92.5], twitchy: [96.5, 89.5, 85], strict: [96.5, 89.5, 85.5] }, // Monza
  'gb-1948': { wet: [137.5, 128.5, 122.5], lowdf: [116, 108, 103], rocket: [111.5, 104, 99], heavy: [125.5, 117, 111.5], twitchy: [114, 106.5, 101.5], strict: [114, 106.5, 101.5] }, // Silverstone
  'be-1925': { wet: [152, 141.5, 134.5], lowdf: [128.5, 119.5, 114], rocket: [123.5, 114.5, 109], heavy: [139.5, 130, 123.5], twitchy: [127.5, 118.5, 113.5], strict: [127.5, 118.5, 113] }, // Spa-Francorchamps
  'mc-1929': { wet: [103.5, 99, 97], lowdf: [87, 84, 81.5], rocket: [85.5, 82, 79.5], heavy: [94.5, 90.5, 88], twitchy: [85, 81, 80], strict: [86, 82.5, 80.5] }, // Monaco
  'br-1940': { wet: [105.5, 98.5, 94], lowdf: [89, 83.5, 79.5], rocket: [85.5, 79.5, 76], heavy: [96, 89.5, 85.5], twitchy: [87, 81.5, 78], strict: [87, 81, 78] }, // Interlagos
};

// The twist on a challenge day ('YYYY-MM-DD', UTC). The server picks the
// circuit as the day of the year modulo the number of circuits; the twist
// steps on each day too, one extra step each time the circuits come round,
// so a circuit meets a different twist every time.
export function twistFor(day) {
  const d = new Date(day + 'T00:00:00Z');
  const doy = Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1;
  return TWISTS[(doy + Math.floor(doy / TRACKS.length)) % TWISTS.length];
}

// Bronze, silver and gold on a circuit with a twist.
export function challengeMedals(track, twist) {
  return CHALLENGE_MEDALS[track.id]?.[twist.id] || track.medals;
}

// The challenge on a day, worked out the way the server does it (circuits
// sorted by id, picked by day of the year), so the menu can show it before
// the server has answered: { day, track: circuit id, twist }.
export function challengeOn(day) {
  const ids = TRACKS.map((t) => t.id).sort();
  const d = new Date(day + 'T00:00:00Z');
  const doy = Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1;
  return { day, track: ids[doy % ids.length], twist: twistFor(day) };
}

export const todayUTC = () => new Date().toISOString().slice(0, 10);

// CAR with a twist's changes, or null when it leaves the car alone.
const tunes = new Map();
export function tuneFor(twist) {
  if (!twist?.tune) return null;
  if (!tunes.has(twist.id)) {
    tunes.set(twist.id, Object.fromEntries(Object.entries(CAR).map(([k, v]) => [k, v * (twist.tune[k] ?? 1)])));
  }
  return tunes.get(twist.id);
}

// The circuit as the challenge runs it: the same track with the twist's
// racing line and medal times. Made once per circuit and twist; everything
// else (shape, scenery) comes from the circuit itself.
const derived = new Map();
export function challengeTrack(base, twist) {
  const key = `${base.id}:${twist.id}`;
  if (!derived.has(key)) {
    const t = Object.create(base);
    const tune = tuneFor(twist);
    if (tune) {
      t.line = buildLine(base, tune);
      t.linePaths = null; // the 2D renderer's paths for the line, made from it
    } else {
      t.line = base.line ||= buildLine(base);
    }
    t.medals = challengeMedals(base, twist);
    t.twist = twist;
    derived.set(key, t);
  }
  return derived.get(key);
}

// ---------- records, kept in this browser like the circuit records ----------
//
// { run: { day, best, bestSectors } (today's best lap and ghost),
//   days: { [day]: 1 bronze | 2 silver | 3 gold }, bestStreak }

const KEY = 'latebrake:challenge';
const KEEP_DAYS = 60;
export const STREAK_GOAL = 7; // days in a row with a medal that win the streak colour

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

// Today's best lap and sectors, the challenge's answer to loadTrack().
export function loadChallengeRun(day) {
  const run = load().run;
  return run?.day === day ? run : null;
}

export function saveChallengeRun(day, data) {
  const all = load();
  all.run = { day, ...data };
  save(all);
}

const dayBefore = (day) => new Date(Date.parse(day + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);

// Days in a row with a medal, up to today. A streak isn't broken until a
// whole day passes without one, so before today's medal it counts to
// yesterday.
export function streak(today, days = load().days || {}) {
  let day = days[today] ? today : dayBefore(today), n = 0;
  while (days[day]) { n++; day = dayBefore(day); }
  return n;
}

export function bestStreak() {
  return load().bestStreak || 0;
}

// A clean challenge lap: the medal it newly earns today, the streak, and
// whether that streak has just reached the goal for the first time, or null
// when it's no better than today's medal so far.
export function earnChallengeMedal(day, medal) {
  const all = load();
  const days = all.days || {};
  if (medal <= (days[day] || 0)) return null;
  days[day] = medal;
  const cutoff = new Date(Date.parse(day + 'T00:00:00Z') - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
  const now = streak(day, days);
  const before = all.bestStreak || 0;
  all.days = days;
  all.bestStreak = Math.max(before, now);
  save(all);
  return { medal, streak: now, reachedGoal: before < STREAK_GOAL && now >= STREAK_GOAL };
}

export function todaysMedal(day) {
  return load().days?.[day] || 0;
}
