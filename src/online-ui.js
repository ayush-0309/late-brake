// Menu and dialogs for the online features: sign-in, display name, daily
// challenge card, leaderboards (click a time to race that ghost) and sharing
// your ghost. Everything stays hidden when online features are off.
// With them on, playing needs a guest or Google account with a name.

import { getOnline, onlineEnabled } from './online.js';
import { formatTime } from './storage.js';
import { track } from './analytics.js';
import { CONFIG } from './config.js';
import { buyColour, resumeCheckout } from './shop.js';
import { COLOURS } from './medals.js';

// `game`: { tracks, selected(), select(track), startRun(opts), toast(...), ownedChanged() }
export function createOnlineUI(game) {
  const $ = (id) => document.getElementById(id);
  let online = null;
  let challenge = null;      // { day, track } today
  let boardTab = 'all';      // 'all' | 'today'
  let boardFor = null;
  // Sign-in methods switched on in Supabase; both assumed until it says, so
  // the sign-in dialog is never left empty.
  let providers = { anonymous_users: true, google: true };
  let leaveArmed = 0;        // a guest's first tap on "Leave guest account"
  let owned = new Set();     // car colours this player has bought

  if (!onlineEnabled()) {
    return { ready: Promise.resolve(null), canPlay: async () => true, lapDone() {}, refresh() {}, owned, shopOpen: false, get user() { return null; } };
  }

  const ready = (async () => {
    online = await getOnline();
    if (!online) return null;
    $('accountBtn').hidden = false;
    online.onUser(onUser);
    onUser(online.user);
    online.providers().then((p) => { providers = { ...providers, ...p }; renderMethods(); }, () => {});
    try {
      challenge = await online.challenge();
    } catch (err) {
      console.warn('No daily challenge', err);
    }
    renderChallenge();
    refresh();
    openSharedGhost();
    if (shopOpen()) finishCheckout();
    return online;
  })();

  // ---------- account ----------

  function onUser(user) {
    $('accountLabel').textContent = user ? user.name || 'Pick a name' : 'Sign in';
    $('accountBtn').classList.toggle('signed-in', !!user);
    if (!$('account').hidden) renderAccount();
    // Signing in and picking a name come before anything else.
    if (!user?.name) openAccount();
    refresh();
    loadOwned();
  }

  // ---------- car colours ----------

  // Colours bought on this account; they follow it to any device.
  async function loadOwned() {
    const forUser = online.user?.id;
    const ids = forUser ? await online.ownedColours().catch(() => []) : [];
    if (online.user?.id !== forUser) return; // signed in or out meanwhile
    owned = new Set(ids);
    game.ownedChanged();
  }

  // A purchase a reload interrupted, now paid: say so and add it.
  async function finishCheckout() {
    const id = await resumeCheckout(online);
    const colour = COLOURS.find((c) => c.id === id);
    if (!colour) return;
    owned = new Set([...owned, colour.id]);
    game.ownedChanged();
    game.toast('Car colour', colour.name, 'Bought. It\'s in your garage', 'best');
  }

  const shopOpen = () => !!online && (CONFIG.shop || !!online.mock);

  // Buying a colour (shop.js takes the payment): true once it's the player's.
  async function buy(colour) {
    if (!(await buyColour(online, colour))) return false;
    owned = new Set([...owned, colour.id]);
    track('Buy colour', { colour: colour.name });
    game.ownedChanged();
    return true;
  }

  function openAccount() {
    renderAccount();
    $('account').hidden = false;
    // The first thing to press or fill in; just the close button over your own details.
    const first = !online.user?.name && [...$('account').querySelectorAll('.primary, .google-btn, input')].find((el) => el.offsetParent);
    (first || $('accountClose')).focus({ preventScroll: true });
  }

  function closeAccount() {
    if (!online.user?.name) return; // still choosing how to play
    $('account').hidden = true;
  }

  // Whether a run can start: yes once signed in with a name, or when online
  // features aren't working (the game still plays then). Otherwise it brings
  // up the sign-in dialog.
  async function canPlay() {
    await ready;
    if (!online || online.user?.name) return true;
    openAccount();
    return false;
  }

  function renderAccount() {
    const user = online.user;
    const view = !user ? 'signin' : !user.name ? 'name' : 'me';
    // A guest gets the Google button too, to keep their laps.
    const shown = view === 'me' && user.guest && providers.google ? ['me', 'signin'] : [view];
    for (const v of ['signin', 'name', 'me']) $(`account-${v}`).hidden = !shown.includes(v);
    clearTimeout(leaveArmed);
    leaveArmed = 0;
    $('signOutBtn').hidden = view !== 'me';
    $('accountClose').hidden = view !== 'me';
    $('signOutBtn').textContent = user?.guest ? 'Leave guest account' : 'Sign out';
    $('accountError').textContent = '';
    renderMethods();
    if (view === 'me') {
      $('accountName').textContent = user.name;
      $('accountEmail').textContent = user.guest ? 'Guest' : user.email || '';
    }
    if (view === 'name') $('nameInput').value = user?.name || '';
  }

  // Guest play and Google show once they're switched on in Supabase.
  function renderMethods() {
    const user = online.user;
    $('guestSignin').hidden = !providers.anonymous_users || !!user;
    $('googleSignin').hidden = !providers.google;
    $('signinText').textContent = user?.guest
      ? 'Guest accounts live in this browser only. Sign in with Google to keep your laps on any device.'
      : 'Play as a guest to start straight away, or sign in with Google to keep your laps on any device.';
  }

  $('accountBtn').addEventListener('click', openAccount);
  $('accountClose').addEventListener('click', closeAccount);
  $('account').addEventListener('click', (e) => { if (e.target === $('account')) closeAccount(); });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !$('account').hidden) { e.stopImmediatePropagation(); closeAccount(); }
  }, true);

  const signInVia = (step, go) => async () => {
    busy('account-signin', true);
    track('Sign in', { step });
    try {
      await go();
    } catch (err) {
      error(err.message);
    } finally {
      busy('account-signin', false);
    }
  };
  $('guestBtn').addEventListener('click', signInVia('guest', () => online.playAsGuest()));
  $('googleBtn').addEventListener('click', signInVia('google', () => online.signInWithGoogle()));

  $('nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim();
    if (!/^[A-Za-z0-9 ._-]{2,20}$/.test(name)) return error('2–20 letters, numbers, spaces, dots, dashes or underscores.');
    busy('nameForm', true);
    try {
      await online.setName(name);
      track('Sign in', { step: 'name set' });
      closeAccount();
      game.toast('Signed in', name, 'Your best laps now go on the leaderboards', 'info');
    } catch (err) {
      error(/duplicate|unique|taken/i.test(err.message) ? 'That name is taken.' : err.message);
    } finally {
      busy('nameForm', false);
    }
  });

  // There's no way back into a guest account, so leaving takes two taps
  // (confirm() is often blocked inside game portals' frames).
  $('signOutBtn').addEventListener('click', async () => {
    if (online.user?.guest && !leaveArmed) {
      $('signOutBtn').textContent = 'Tap again to leave';
      leaveArmed = setTimeout(() => { leaveArmed = 0; $('signOutBtn').textContent = 'Leave guest account'; }, 3000);
      return;
    }
    clearTimeout(leaveArmed);
    leaveArmed = 0;
    await online.signOut(); // back to the sign-in dialog
  });

  function error(msg) { $('accountError').textContent = msg; }
  function busy(id, on) { for (const el of $(id).querySelectorAll('button, input')) el.disabled = on; }

  // ---------- daily challenge ----------

  function renderChallenge() {
    const t = challenge && game.tracks.find((x) => x.id === challenge.track);
    $('challengeCard').hidden = !t;
    if (!t) return;
    $('challengeTrack').textContent = t.name;
    const end = new Date(challenge.day + 'T00:00:00Z').getTime() + 864e5;
    const hours = Math.max(0, Math.ceil((end - Date.now()) / 36e5));
    $('challengeEnds').textContent = `Ends in ${hours} h`;
  }

  $('challengeBtn').addEventListener('click', () => {
    const t = game.tracks.find((x) => x.id === challenge?.track);
    if (!t) return;
    track('Challenge', { step: 'start' });
    game.select(t);
    game.startRun({ challenge: true, mode: 'trial' });
  });

  // ---------- leaderboards ----------

  async function refresh() {
    if (!online) return;
    const t = game.selected();
    const isChallenge = challenge?.track === t.id;
    if (!isChallenge) boardTab = 'all';
    $('boardTabs').hidden = !isChallenge;
    for (const b of $('boardTabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === boardTab));
    $('board').hidden = false;
    const key = `${t.id}:${boardTab}:${online.user?.id || ''}`;
    boardFor = key;
    $('boardList').innerHTML = '<li class="board-empty">Loading…</li>';
    let rows = [], mine = null;
    try {
      const opts = { challenge: boardTab === 'today', limit: 5 };
      [rows, mine] = await Promise.all([online.leaderboard(t.id, opts), online.myLap(t.id, opts)]);
    } catch (err) {
      if (boardFor === key) $('boardList').innerHTML = '<li class="board-empty">Leaderboard unavailable</li>';
      return;
    }
    if (boardFor !== key) return; // a newer request took over
    const me = online.user?.id;
    const row = (r, pos) => `<li><button class="board-row${r.userId === me ? ' me' : ''}" data-user="${escapeHtml(r.userId)}" title="Race this lap as a ghost">
          <span class="p">${pos}</span><span class="n">${escapeHtml(r.name)}</span><span class="t">${formatTime(r.time)}</span><span class="go" aria-hidden="true">▶</span></button></li>`;
    let html = rows.map((r, i) => row(r, i + 1)).join('');
    // Outside the top five: your own place underneath.
    if (mine && !rows.some((r) => r.userId === me)) html += `<li class="board-gap" aria-hidden="true">⋯</li>${row(mine, mine.rank)}`;
    $('boardList').innerHTML = html || `<li class="board-empty">${boardTab === 'today' ? 'No times today yet. Be the first.' : 'No times yet. Set the first.'}</li>`;
    $('shareBtn').hidden = !(mine && boardTab === 'all');
  }

  $('boardTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    boardTab = b.dataset.tab;
    refresh();
  });

  // Click a time: race that driver's best lap as a ghost.
  $('boardList').addEventListener('click', async (e) => {
    const row = e.target.closest('.board-row');
    if (!row) return;
    const t = game.selected();
    const g = await online.ghost(t.id, row.dataset.user).catch(() => null);
    if (!g) return game.toast('Ghost', 'Not available', 'Only uploaded laps can be raced', 'info');
    track('Race ghost', { track: t.name, from: 'leaderboard' });
    game.startRun({ versus: g, mode: 'trial' });
  });

  $('shareBtn').addEventListener('click', async () => {
    const t = game.selected();
    const url = `${location.origin}${location.pathname}?track=${encodeURIComponent(t.id)}&vs=${encodeURIComponent(online.user.id)}`;
    const text = `Beat my lap at ${t.name} in Late Brake`;
    track('Share ghost', { track: t.name });
    try {
      if (navigator.share) await navigator.share({ title: 'Late Brake', text, url });
      else {
        await navigator.clipboard.writeText(url);
        game.toast('Link copied', 'Share it', 'Friends race your ghost straight away', 'info');
      }
    } catch {}
  });

  // play.html?track=…&vs=<user id>: straight into a race against that ghost.
  async function openSharedGhost() {
    const p = new URLSearchParams(location.search);
    const vs = p.get('vs'), t = game.tracks.find((x) => x.id === p.get('track'));
    if (!vs || !t) return;
    const g = await online.ghost(t.id, vs).catch(() => null);
    if (!g) return game.toast('Shared lap', 'Not found', 'It may have been beaten and replaced', 'info');
    track('Race ghost', { track: t.name, from: 'link' });
    game.select(t);
    game.offerVersus(g);
  }

  // A finished lap: upload it if it's a personal best (or today's challenge).
  async function lapDone(t, e, session) {
    if (!online?.user?.name || !e.valid || e.rescued) return;
    const challengeRun = session.challenge && challenge?.track === t.id;
    if (!e.isBest && !challengeRun) return;
    const ghost = e.ghost;
    if (!ghost) return;
    try {
      const res = await online.submitLap(t.id, { time: e.time, sectors: e.sectors, ghost }, { challenge: !!challengeRun });
      if (res.improved) {
        game.toast(challengeRun ? "Today's challenge" : 'Leaderboard', `#${res.rank}`, challengeRun ? 'Your best today' : `on ${t.name}`, 'info');
      }
      refresh();
    } catch (err) {
      console.warn('Lap upload failed', err);
    }
  }

  return {
    ready, canPlay, lapDone, refresh, buy,
    continueWithGoogle: () => online.signInWithGoogle(),
    get owned() { return owned; },
    get shopOpen() { return shopOpen(); },
    get user() { return online?.user || null; },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
