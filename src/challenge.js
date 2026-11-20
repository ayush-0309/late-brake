// The daily challenge: one circuit and one goal a day, the same for
// everyone, with its records and the medal streak. The server picks the
// circuit (challenge_today() in supabase/schema.sql); the goal comes from the
// date the same way, so everyone gets the same one. No DOM here, so it can
// run headless too.

import { TRACKS } from './track.js';
import { Session } from './session.js';
import { buildLine } from './line.js';
import { createDriver, DIFFICULTY } from './ai.js';
import { DT } from './car.js';
import { formatTime, formatMedalTime } from './storage.js';

// What each day asks. A run gives one result, a time in seconds (lower is
// better), and a medal (0 none, 1 bronze, 2 silver, 3 gold): createGoalRun()
// judges it. `race` runs the goal as a race (race.js), where the player
// always starts at the back.
export const GOALS = [
  { id: 'back', name: 'From the back', blurb: 'Start last of six. Two laps to get to the front',
    race: { opponents: 5, laps: 2, difficulty: 'easy' } },
  { id: 'duel', name: 'Ghost duel', blurb: 'One lap, head to head with a gold-pace ghost' },
  { id: 'clean', name: 'Three clean laps', blurb: "Three laps in a row inside the limits. One off and it's back to zero" },
  { id: 'sprint', name: 'Sector sprint', blurb: 'From the lights to the end of sector 1. Retry as often as you like' },
];
const CLEAN_LAPS = 3;

// Bronze, silver and gold for the timed goals on each circuit: the AI at
// easy, medium and hard skill (the sprint rounded up to the tenth, three
// clean laps to the half second). Made by `node tools/medal-times.mjs
// --challenge`. The duel's come from its ghost (duelGhost()), and From the
// back is judged on the finishing position: 3rd, 2nd, 1st.
export const GOAL_MEDALS = {
  'at-1969': { clean: [237, 221, 212], sprint: [29.6, 28.2, 27.6] }, // Spielberg
  'it-1922': { clean: [289, 268, 256], sprint: [35.6, 33.8, 33.4] }, // Monza
  'gb-1948': { clean: [342, 318.5, 303.5], sprint: [36.4, 34.1, 32.6] }, // Silverstone
  'be-1925': { clean: [382, 355, 338], sprint: [40.9, 38.4, 36.8] }, // Spa-Francorchamps
  'mc-1929': { clean: [258, 247.5, 241], sprint: [31.3, 30, 29.7] }, // Monaco
  'br-1940': { clean: [260.5, 243.5, 233], sprint: [29.5, 27.9, 26.9] }, // Interlagos
};

// The day of the year (1 = 1 January) of a 'YYYY-MM-DD' day, UTC.
function dayOfYear(day) {
  const d = new Date(day + 'T00:00:00Z');
  return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1;
}

// The goal on a challenge day. The server picks the circuit as the day of the
// year modulo the number of circuits; the goal steps on each day too, one
// extra step each time the circuits come round, so a circuit meets a
// different goal each time.
export function goalFor(day) {
  const doy = dayOfYear(day);
  return GOALS[(doy + Math.floor(doy / TRACKS.length)) % GOALS.length];
}

// The challenge on a day, worked out the way the server does it (circuits
// sorted by id, picked by day of the year), so the menu can show it before
// the server has answered: { day, track: circuit id, goal }.
export function challengeOn(day) {
  const ids = TRACKS.map((t) => t.id).sort();
  return { day, track: ids[dayOfYear(day) % ids.length], goal: goalFor(day) };
}

export const todayUTC = () => new Date().toISOString().slice(0, 10);

// The duel's ghost: the hard AI's first lap from the grid, as a player's run
// starts. The physics is deterministic, so it's the same lap every time and
// for everyone; worked out once per circuit.
const ghosts = new Map();
export function duelGhost(track) {
  if (!ghosts.has(track.id)) {
    const s = new Session(track, null);
    const driver = createDriver(track, track.line ||= buildLine(track), DIFFICULTY.hard);
    let lap = null;
    for (let k = 0; k < 20 * 60 / DT && !lap; k++) {
      if (s.phase !== 'running') { s.step({ throttle: 0, brake: 0, steer: 0 }); continue; }
      const a = driver.control(s.car, [], DT);
      if (a.reset) s.resetToTrack();
      s.step({ ...a, sens: 1 });
      lap = s.events.find((e) => e.type === 'lap');
      s.events.length = 0;
    }
    ghosts.set(track.id, { name: 'Gold-pace ghost', time: lap.time, ghost: lap.ghost });
  }
  return ghosts.get(track.id);
}

// Bronze, silver and gold for a goal on a circuit: times, or for From the
// back the finishing positions.
export function goalMedals(goal, track) {
  if (goal.id === 'back') return [3, 2, 1];
  if (goal.id === 'duel') {
    const t = duelGhost(track).time;
    return [t + 3, t + 1, t];
  }
  return GOAL_MEDALS[track.id]?.[goal.id] || [Infinity, Infinity, Infinity];
}

// A medal target as shown on the card and the HUD.
export function medalTarget(goal, value) {
  if (goal.id === 'back') return ['3rd', '2nd', 'Win'][3 - value];
  return goal.id === 'duel' ? formatTime(value) : formatMedalTime(value);
}

const medalFor = (medals, time) => medals.reduce((m, target, k) => (time <= target ? k + 1 : m), 0);

// Judges one challenge run. event() takes each session event and returns
// what it means for the goal, or null:
//   { result: { time, medal }, ... }   the run's result (time in seconds)
//   { done: true }                     the attempt is over (the duel and sprint start again)
//   { count, lapTime } / { reset }     three clean laps: the count so far, or back to zero
// plus details for the toast (position, gap, next). hud() is the line under
// the sectors: { label, value }.
export function createGoalRun(goal, track) {
  const medals = goalMedals(goal, track);
  const ghost = goal.id === 'duel' ? duelGhost(track) : null;
  let chain = [];       // three clean laps: the clean laps in a row so far
  let best = null;      // this run's best result
  const next = (medal) => (medal < 3 ? { medal: medal + 1, target: medals[medal] } : null);
  const judge = (time, extra = {}) => {
    const medal = extra.position ? (extra.position <= 3 ? 4 - extra.position : 0) : medalFor(medals, time);
    if (!best || time < best.time) best = { time, medal };
    return { result: { time, medal }, next: next(medal), ...extra };
  };

  return {
    goal, medals, ghost,
    event(e, s) {
      switch (goal.id) {
        case 'back':
          if (e.type !== 'finish') return null;
          return judge(s.playerFinishedAt + s.penalty, { position: e.position, done: true });
        case 'duel':
          if (e.type !== 'lap' || e.lap !== 1) return null;
          if (!e.valid || e.rescued) return { done: true, off: true };
          return judge(e.time, { gap: e.time - ghost.time, done: true });
        case 'clean':
          if (e.type === 'invalid') {
            const had = chain.length;
            chain = [];
            return had ? { reset: true } : null;
          }
          if (e.type !== 'lap' || !e.valid || e.rescued) return null;
          chain.push(e.time);
          if (chain.length < CLEAN_LAPS) return { count: chain.length, lapTime: e.time };
          return judge(chain.slice(-CLEAN_LAPS).reduce((a, b) => a + b, 0), { count: chain.length, lapTime: e.time });
        case 'sprint':
          if (e.type === 'invalid' && s.lap === 1) return { done: true, off: true };
          if (e.type !== 'sector' || e.index !== 0 || s.lap !== 1) return null;
          return judge(e.time, { done: true });
      }
      return null;
    },
    hud() {
      const n = next(best?.medal || 0);
      const chase = n ? `${['Bronze', 'Silver', 'Gold'][n.medal - 1]} ${medalTarget(goal, n.target)}` : 'Gold won';
      switch (goal.id) {
        case 'back': return { label: 'From the back', value: 'Win for gold' };
        case 'duel': return { label: 'Ghost', value: formatTime(ghost.time) };
        case 'clean': return { label: 'Clean laps', value: `${Math.min(chain.length, CLEAN_LAPS)} of ${CLEAN_LAPS}` };
        default: return { label: 'Sprint to S1', value: chase };
      }
    },
  };
}

// ---------- records, kept in this browser like the circuit records ----------
//
// { result: { day, time, medal } (today's best), days: { [day]: 1 bronze |
//   2 silver | 3 gold }, bestStreak }

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

// Today's best result: { time, medal }, or null.
export function loadChallengeResult(day) {
  const r = load().result;
  return r?.day === day ? r : null;
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

export function todaysMedal(day) {
  return load().days?.[day] || 0;
}

// A result for today's challenge. Keeps the best one (a better medal first,
// then a lower time) and today's medal, and says what changed: `best` (it's
// today's best result), `medal` (a medal better than today's so far, else 0),
// the streak, and whether the streak has just reached the goal.
export function recordChallengeResult(day, time, medal) {
  const all = load();
  const old = all.result?.day === day ? all.result : null;
  const best = !old || medal > old.medal || (medal === old.medal && time < old.time);
  if (best) all.result = { day, time, medal };
  const days = all.days || {};
  const newMedal = medal > (days[day] || 0) ? medal : 0;
  if (newMedal) days[day] = medal;
  const cutoff = new Date(Date.parse(day + 'T00:00:00Z') - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
  const now = streak(day, days);
  const before = all.bestStreak || 0;
  all.days = days;
  all.bestStreak = Math.max(before, now);
  save(all);
  return { best, medal: newMedal, streak: now, reachedGoal: before < STREAK_GOAL && now >= STREAK_GOAL };
}
