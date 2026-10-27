// Player settings, kept in localStorage. Storage can be blocked, so reads
// fall back to defaults and writes fail quietly.

const KEY = 'latebrake:settings';

export const DEFAULTS = {
  camera: 'chase',        // 'chase' turns with the car, 'cockpit' is first person, 'fixed' keeps north up
  sensitivity: 'normal',  // steering: 'low' | 'normal' | 'high'
  ghost: true,
  line: 'off',            // racing line: 'full' | 'braking' | 'off'
  mode: 'trial',          // 'trial' (time trial) | 'race' (against AI)
  opponents: 3,           // AI rivals in a race, 1–3
  raceLaps: 3,
  difficulty: 'medium',   // 'easy' | 'medium' | 'hard'
  colour: 'red',          // car colour, an id from COLOURS in medals.js, painted only once unlocked
};

export const LINE_MODES = ['full', 'braking', 'off'];
export const CAMERAS = ['chase', 'cockpit', 'fixed'];

// Multiplier on steering rate and lock, see stepCar.
export const SENSITIVITY = { low: 0.85, normal: 1, high: 1.2 };

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {}
  const s = { ...DEFAULTS };
  if (CAMERAS.includes(saved.camera)) s.camera = saved.camera;
  if (saved.sensitivity in SENSITIVITY) s.sensitivity = saved.sensitivity;
  if (typeof saved.ghost === 'boolean') s.ghost = saved.ghost;
  if (LINE_MODES.includes(saved.line)) s.line = saved.line;
  if (['trial', 'race', 'online'].includes(saved.mode)) s.mode = saved.mode;
  if ([1, 2, 3].includes(saved.opponents)) s.opponents = saved.opponents;
  if ([3, 5, 10].includes(saved.raceLaps)) s.raceLaps = saved.raceLaps;
  if (['easy', 'medium', 'hard'].includes(saved.difficulty)) s.difficulty = saved.difficulty;
  if (typeof saved.colour === 'string') s.colour = saved.colour;
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
