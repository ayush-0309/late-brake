// Player settings, kept in localStorage. Storage can be blocked, so reads
// fall back to defaults and writes fail quietly.

const KEY = 'latebrake:settings';

export const DEFAULTS = {
  camera: 'chase',        // 'chase' turns with the car, 'fixed' keeps north up
  sensitivity: 'normal',  // steering: 'low' | 'normal' | 'high'
  ghost: true,
  line: 'off',            // racing line: 'full' | 'braking' | 'off'
};

export const LINE_MODES = ['full', 'braking', 'off'];

// Multiplier on steering rate and lock, see stepCar.
export const SENSITIVITY = { low: 0.85, normal: 1, high: 1.2 };

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {}
  const s = { ...DEFAULTS };
  if (saved.camera === 'chase' || saved.camera === 'fixed') s.camera = saved.camera;
  if (saved.sensitivity in SENSITIVITY) s.sensitivity = saved.sensitivity;
  if (typeof saved.ghost === 'boolean') s.ghost = saved.ghost;
  if (LINE_MODES.includes(saved.line)) s.line = saved.line;
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
