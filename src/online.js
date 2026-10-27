// Online features: accounts, leaderboards, the daily challenge and shared
// ghosts, backed by Supabase (see supabase/README.md). Off unless
// CONFIG.supabase is set. ?online=mock swaps in a pretend backend kept in
// this browser, for trying the screens locally.

import { CONFIG } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const GHOST_STEP = 3; // upload every 3rd ghost sample (10 per second), plenty to replay

let api = null;

export const onlineEnabled = () => !!CONFIG.supabase || new URLSearchParams(location.search).get('online') === 'mock';

// Resolves to the API, or null when online features are off or unreachable.
export async function getOnline() {
  if (api !== null) return api || null;
  if (!onlineEnabled()) {
    api = false;
    return null;
  }
  try {
    api = new URLSearchParams(location.search).get('online') === 'mock'
      ? (await import('./online-mock.js')).createMockOnline()
      : await createSupabaseOnline(CONFIG.supabase);
  } catch (err) {
    console.warn('Online features unavailable', err);
    api = false;
  }
  return api || null;
}

async function createSupabaseOnline({ url, anonKey }) {
  const { createClient } = await import(SUPABASE_JS);
  // A guest who picked a Google account that already has a driver comes back
  // with this error; read it before the client tidies the URL.
  const linkError = new URLSearchParams(location.hash.slice(1)).get('error_code') || new URLSearchParams(location.search).get('error_code');
  const db = createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  let user = null;        // { id, email, name, guest }
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(user));
  const back = () => location.origin + location.pathname;

  async function loadProfile(session) {
    if (!session?.user) { user = null; emit(); return; }
    const { data } = await db.from('profiles').select('name').eq('id', session.user.id).maybeSingle();
    user = { id: session.user.id, email: session.user.email, name: data?.name || null, guest: !!session.user.is_anonymous };
    emit();
  }
  // Supabase warns against calling it again inside this callback (it can
  // deadlock), so the profile loads just after.
  db.auth.onAuthStateChange((_event, session) => { setTimeout(() => loadProfile(session), 0); });
  await loadProfile((await db.auth.getSession()).data.session);
  // That Google account already has a driver: sign in to it instead (the
  // guest's laps stay with the guest).
  if (linkError === 'identity_already_exists') {
    history.replaceState(null, '', back() + location.search);
    await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back() } });
  }

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    db,
    get user() { return user; },
    onUser(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Guest play: an account with no email, kept in this browser.
    async playAsGuest() {
      check(await db.auth.signInAnonymously());
    },
    // Google sign-in: leaves for Google and comes back to this page signed in.
    // A guest gets Google added to their account instead, keeping their laps.
    async signInWithGoogle() {
      const options = { redirectTo: back() };
      check(await (user?.guest ? db.auth.linkIdentity({ provider: 'google', options }) : db.auth.signInWithOAuth({ provider: 'google', options })));
    },
    // Sign-in methods switched on in the Supabase dashboard, e.g.
    // { google: true, anonymous_users: true } (guests).
    async providers() {
      const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
      return res.ok ? (await res.json()).external || {} : {};
    },
    async signOut() {
      await db.auth.signOut();
      user = null;
      emit();
    },
    async setName(name) {
      check(await db.from('profiles').upsert({ id: user.id, name }));
      user = { ...user, name };
      emit();
    },

    // { day, track } for today (UTC). The server decides, so everyone agrees.
    async challenge() {
      const rows = check(await db.rpc('challenge_today'));
      return Array.isArray(rows) ? rows[0] : rows;
    },

    // Top laps on a circuit, all time or in today's challenge.
    async leaderboard(track, { challenge = false, limit = 10 } = {}) {
      const q = challenge
        ? db.from('challenge_laps').select('user_id, time, set_at, profiles(name)').eq('day', (await this.challenge()).day)
        : db.from('best_laps').select('user_id, time, set_at, profiles(name)').eq('track', track);
      const rows = check(await q.order('time', { ascending: true }).limit(limit));
      return rows.map((r) => ({ userId: r.user_id, name: r.profiles?.name || '?', time: r.time, at: r.set_at }));
    },

    // Your own lap on a board and where it ranks, or null.
    async myLap(track, { challenge = false } = {}) {
      if (!user) return null;
      const table = challenge ? 'challenge_laps' : 'best_laps';
      const day = challenge ? (await this.challenge()).day : null;
      const scope = (q) => (challenge ? q.eq('day', day) : q.eq('track', track));
      const row = check(await scope(db.from(table).select('time').eq('user_id', user.id)).maybeSingle());
      if (!row) return null;
      const { count } = await scope(db.from(table).select('user_id', { count: 'exact', head: true }).lt('time', row.time));
      return { userId: user.id, name: user.name, time: row.time, rank: (count || 0) + 1 };
    },

    // Uploads a valid lap. Rescued laps never come here.
    async submitLap(track, lap, { challenge = false } = {}) {
      return check(await db.rpc('submit_lap', {
        p_track: track, p_time: lap.time, p_sectors: lap.sectors, p_ghost: thinGhost(lap.ghost), p_challenge: challenge,
      }));
    },

    // Someone's best lap on a circuit, to race as a ghost.
    async ghost(track, userId) {
      const row = check(await db.from('best_laps').select('time, ghost, profiles(name)').eq('track', track).eq('user_id', userId).maybeSingle());
      return row && { name: row.profiles?.name || '?', time: row.time, ghost: row.ghost };
    },
  };
}

// Fewer samples for upload; the replay interpolates between them. Samples
// must stay evenly spaced, so the last fraction of a step is dropped.
export function thinGhost(g) {
  const pts = [];
  for (let i = 0; i < g.pts.length / 3; i += GHOST_STEP) pts.push(g.pts[i * 3], g.pts[i * 3 + 1], g.pts[i * 3 + 2]);
  return { t0: g.t0, every: g.every * GHOST_STEP, pts };
}
