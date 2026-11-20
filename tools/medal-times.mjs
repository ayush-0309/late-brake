// Prints each circuit's medal times: the best flying lap of a lone AI driver
// at easy, medium and hard skill, rounded up to the half second. Paste the
// result into `medals` in SETTINGS (src/track.js).
//   node tools/medal-times.mjs
//
// With --challenge, the daily challenge's medal times for its timed goals
// (three clean laps, the sector sprint) on every circuit, judged the way the
// game judges them. Paste that into GOAL_MEDALS (src/challenge.js).
//   node tools/medal-times.mjs --challenge

import { TRACKS, buildTrack } from '../src/track.js';
import { buildLine } from '../src/line.js';
import { RaceSession } from '../src/race.js';
import { Session } from '../src/session.js';
import { createDriver, DIFFICULTY } from '../src/ai.js';
import { DT } from '../src/car.js';
import { GOALS, createGoalRun, duelGhost } from '../src/challenge.js';

const PARKED = { throttle: 0, brake: 1, steer: 0 }; // the player stays on the grid
const LAPS = 4;
const LEVELS = ['easy', 'medium', 'hard'];
const halfUp = (t) => Math.ceil(t * 2) / 2;

if (process.argv.includes('--challenge')) {
  const goals = GOALS.filter((g) => g.id === 'clean' || g.id === 'sprint');
  console.log('export const GOAL_MEDALS = {');
  for (const def of TRACKS) {
    const t = buildTrack(def);
    const rows = goals.map((goal) => {
      const round = goal.id === 'sprint' ? (x) => Math.ceil(x * 10) / 10 : halfUp;
      return `${goal.id}: [${LEVELS.map((level) => round(goalResult(t, goal, DIFFICULTY[level]))).join(', ')}]`;
    });
    console.log(`  '${def.id}': { ${rows.join(', ')} }, // ${def.name}, duel ghost ${duelGhost(t).time.toFixed(3)}`);
  }
  console.log('};');
} else {
  for (const def of TRACKS) {
    const t = buildTrack(def);
    const line = t.line ||= buildLine(t);
    const times = [];
    for (const level of LEVELS) {
      const s = new RaceSession(t, null, { opponents: 1, laps: 99, difficulty: level });
      const r = s.rivals[0];
      r.driver = createDriver(t, line, DIFFICULTY[level]); // no per-driver spread
      for (let k = 0; k < 20 * 60 / DT && r.laps < LAPS; k++) s.step(PARKED);
      times.push(halfUp(r.bestLap));
    }
    console.log(`${def.id}  ${def.name.padEnd(18)} medals: [${times.join(', ')}],`);
  }
}

// The AI's best result at a goal over a few laps, judged as the game does.
// A goal the AI can't finish is a bug in the goal: it stops here.
function goalResult(t, goal, skill) {
  const s = new Session(t, null, { challenge: true });
  const driver = createDriver(t, t.line ||= buildLine(t), skill);
  const run = createGoalRun(goal, t);
  let best = Infinity;
  for (let k = 0; k < 20 * 60 / DT && s.laps.length < 6; k++) {
    if (s.phase !== 'running') { s.step(PARKED); continue; }
    const a = driver.control(s.car, [], DT);
    if (a.reset) s.resetToTrack();
    s.step({ ...a, sens: 1 });
    for (const e of s.events) {
      const r = run.event(e, s);
      if (r?.result) best = Math.min(best, r.result.time);
    }
    s.events.length = 0;
  }
  if (!isFinite(best)) throw new Error(`${t.name}, ${goal.name}, skill ${skill}: never finished`);
  return best;
}
