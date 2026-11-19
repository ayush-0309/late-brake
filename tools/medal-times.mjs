// Prints each circuit's medal times: the best flying lap of a lone AI driver
// at easy, medium and hard skill, rounded up to the half second. Paste the
// result into `medals` in SETTINGS (src/track.js).
//   node tools/medal-times.mjs
//
// With --challenge, the same for every daily-challenge twist on every
// circuit, driving a time trial with the twist on (its car, line and track
// limits). Paste that into CHALLENGE_MEDALS (src/challenge.js).
//   node tools/medal-times.mjs --challenge

import { TRACKS, buildTrack } from '../src/track.js';
import { buildLine } from '../src/line.js';
import { RaceSession } from '../src/race.js';
import { Session } from '../src/session.js';
import { createDriver, DIFFICULTY } from '../src/ai.js';
import { DT } from '../src/car.js';
import { TWISTS, tuneFor, challengeTrack } from '../src/challenge.js';

const PARKED = { throttle: 0, brake: 1, steer: 0 }; // the player stays on the grid
const LAPS = 4;
const LEVELS = ['easy', 'medium', 'hard'];
const halfUp = (t) => Math.ceil(t * 2) / 2;

if (process.argv.includes('--challenge')) {
  console.log('export const CHALLENGE_MEDALS = {');
  for (const def of TRACKS) {
    const base = buildTrack(def);
    const rows = [];
    for (const twist of TWISTS) {
      const t = challengeTrack(base, twist);
      const times = LEVELS.map((level) => halfUp(trialLap(t, twist, DIFFICULTY[level])));
      rows.push(`${twist.id}: [${times.join(', ')}]`);
    }
    console.log(`  '${def.id}': { ${rows.join(', ')} }, // ${def.name}`);
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

// The AI drives a time trial on `t` with the twist on; its best clean lap.
// A twist the AI can't lap cleanly is a bug in the twist: it stops here.
function trialLap(t, twist, skill) {
  const s = new Session(t, null, { challenge: true, tune: tuneFor(twist), offLimit: twist.offLimit });
  const driver = createDriver(t, t.line, skill);
  for (let k = 0; k < 20 * 60 / DT && s.laps.length < LAPS; k++) {
    if (s.phase !== 'running') { s.step(PARKED); continue; }
    const a = driver.control(s.car, [], DT);
    if (a.reset) s.resetToTrack();
    s.step({ ...a, sens: 1 });
  }
  const clean = s.laps.filter((l) => l.valid).map((l) => l.time);
  if (!clean.length) throw new Error(`${t.name}, ${twist.name}, skill ${skill}: no clean lap in ${LAPS}`);
  return Math.min(...clean);
}
