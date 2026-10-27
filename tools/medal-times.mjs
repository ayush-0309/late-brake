// Prints each circuit's medal times: the best flying lap of a lone AI driver
// at easy, medium and hard skill, rounded up to the half second. Paste the
// result into `medals` in SETTINGS (src/track.js).
//   node tools/medal-times.mjs

import { TRACKS, buildTrack } from '../src/track.js';
import { buildLine } from '../src/line.js';
import { RaceSession } from '../src/race.js';
import { createDriver, DIFFICULTY } from '../src/ai.js';
import { DT } from '../src/car.js';

const PARKED = { throttle: 0, brake: 1, steer: 0 }; // the player stays on the grid
const LAPS = 4;

for (const def of TRACKS) {
  const t = buildTrack(def);
  const line = t.line ||= buildLine(t);
  const times = [];
  for (const level of ['easy', 'medium', 'hard']) {
    const s = new RaceSession(t, null, { opponents: 1, laps: 99, difficulty: level });
    const r = s.rivals[0];
    r.driver = createDriver(t, line, DIFFICULTY[level]); // no per-driver spread
    for (let k = 0; k < 20 * 60 / DT && r.laps < LAPS; k++) s.step(PARKED);
    times.push(Math.ceil(r.bestLap * 2) / 2);
  }
  console.log(`${def.id}  ${def.name.padEnd(18)} medals: [${times.join(', ')}],`);
}
