// Best laps and ghosts live in localStorage, one key per track.
// Storage can be missing or blocked (private mode), so every call is guarded.

const PREFIX = 'latebrake:v1:';

export function loadTrack(id) {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveTrack(id, data) {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(data));
  } catch {
    // Out of space or blocked: the run still works, it just won't persist.
  }
}

export function clearTrack(id) {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {}
}

export function formatTime(t, sign = false) {
  if (t === null || t === undefined || !Number.isFinite(t)) return '--:--.---';
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const body = sign
    ? (m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3))
    : `${m}:${s.toFixed(3).padStart(6, '0')}`;
  return sign ? (neg ? '−' : '+') + body : body;
}
