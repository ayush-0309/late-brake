// A pretend backend for trying the online screens without a Supabase
// project: load the game with ?online=mock. Everything lives in this
// browser's localStorage, sign-in is instant, and a few made-up drivers
// fill the leaderboards. Same interface as the real one in online.js.

import { TRACKS } from './track.js';
import { thinGhost } from './online.js';

const KEY = 'latebrake:mock-online';
// Roughly how fast the made-up drivers are on each circuit (seconds).
const PACE = { 'at-1969': 74, 'it-1922': 89, 'gb-1948': 106, 'be-1925': 118, 'mc-1929': 81, 'br-1940': 81 };
const FAKES = ['K. Ahn', 'P. Duval', 'M. Esposito', 'T. Brennan', 'N. Haddad'];

export function createMockOnline() {
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  const data = load();
  data.best ||= {};
  data.daily ||= {};
  data.names ||= {};
  for (const [id, base] of Object.entries(PACE)) {
    data.best[id] ||= FAKES.map((name, k) => ({ userId: `fake-${k}`, name, time: base + k * 0.83 + (k % 2) * 0.31, ghost: null }));
  }
  save(data);

  // ?mockuser=Name signs this tab in as that driver (two tabs, two drivers).
  const tabUser = new URLSearchParams(location.search).get('mockuser');
  let user = tabUser ? { id: 'tab-' + tabUser, email: `${tabUser}@example.com`, name: tabUser } : data.user || null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(user));
  const today = () => new Date().toISOString().slice(0, 10);

  return {
    mock: true,
    get user() { return user; },
    onUser(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async playAsGuest() {
      user = { id: 'guest-' + Date.now().toString(36), email: null, name: null, guest: true };
      data.user = user;
      save(data);
      setTimeout(emit, 300);
    },
    // A guest keeps their id (and laps) and gains the Google account.
    async signInWithGoogle() {
      const email = 'driver@gmail.com';
      const id = user?.guest ? user.id : 'me-' + email;
      user = { id, email, name: data.names[id] || null, guest: false };
      data.user = user;
      save(data);
      setTimeout(emit, 300);
    },
    async providers() {
      return { google: true, anonymous_users: true };
    },
    async signOut() {
      user = null;
      delete data.user;
      save(data);
      emit();
    },
    async setName(name) {
      if (!/^[A-Za-z0-9 ._-]{2,20}$/.test(name)) throw new Error('Names are 2–20 letters, numbers, spaces, dots, dashes or underscores.');
      const taken = Object.entries(data.names).some(([id, n]) => n.toLowerCase() === name.toLowerCase() && id !== user.id);
      if (taken || FAKES.includes(name)) throw new Error('That name is taken.');
      data.names[user.id] = name;
      user = { ...user, name };
      data.user = user;
      save(data);
      emit();
    },
    // Same rule as the server: circuits sorted by id, picked by day of the year.
    async challenge() {
      const ids = TRACKS.map((t) => t.id).sort();
      const d = new Date();
      const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
      return { day: today(), track: ids[doy % ids.length] };
    },
    async leaderboard(track, { challenge = false, limit = 10 } = {}) {
      const rows = challenge ? data.daily[today()] || [] : data.best[track] || [];
      return rows.slice().sort((a, b) => a.time - b.time).slice(0, limit)
        .map(({ userId, name, time }) => ({ userId, name, time }));
    },
    async myLap(track, { challenge = false } = {}) {
      if (!user) return null;
      const rows = challenge ? data.daily[today()] || [] : data.best[track] || [];
      const mine = rows.find((r) => r.userId === user.id);
      return mine && { userId: user.id, name: user.name, time: mine.time, rank: rows.filter((r) => r.time < mine.time).length + 1 };
    },
    async submitLap(track, lap, { challenge = false } = {}) {
      if (!user?.name) throw new Error('Pick a name first');
      const list = challenge ? (data.daily[today()] ||= []) : (data.best[track] ||= []);
      const mine = list.find((r) => r.userId === user.id);
      const improved = !mine || lap.time < mine.time;
      if (improved) {
        const row = { userId: user.id, name: user.name, time: lap.time, ghost: thinGhost(lap.ghost) };
        if (mine) Object.assign(mine, row); else list.push(row);
        save(data);
      }
      const best = Math.min(lap.time, mine?.time ?? Infinity);
      return { improved, rank: list.filter((r) => r.time < best).length + 1, day: today() };
    },
    async ghost(track, userId) {
      const row = (data.best[track] || []).find((r) => r.userId === userId);
      return row?.ghost ? { name: row.name, time: row.time, ghost: row.ghost } : null;
    },
  };
}
