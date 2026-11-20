// Menu and dialogs for the online features: sign-in, display name, daily
// challenge card, leaderboards (click a time to race that ghost) and sharing
// your ghost. Everything stays hidden when online features are off.
// Time trials need no account. Racing (AI drivers or other players), the daily
// challenge, the leaderboards and the shop need a Google account with a name.

import { getOnline, onlineEnabled, GUEST_NAME } from './online.js';
import { formatTime, loadTrack } from './storage.js';
import { track } from './analytics.js';
import { CONFIG } from './config.js';
import { buyColour, resumeCheckout, PAYMENT_FAILED } from './shop.js';
import { COLOURS, MEDALS } from './medals.js';
import { GOALS, goalFor, challengeOn, todayUTC, goalMedals, medalTarget, loadChallengeResult, streak, bestStreak, todaysMedal, STREAK_GOAL } from './challenge.js';

// `game`: { tracks, selected(), select(track), startRun(opts), toast(...), ownedChanged() }
export function createOnlineUI(game) {
  const $ = (id) => document.getElementById(id);
  let online = null;
  let challenge = null;      // { day, track, goal } today
  let boardTab = 'all';      // 'all' | 'today'
  let boardFor = null;
  // Sign-in methods switched on in Supabase; Google is assumed until it says,
  // so the sign-in dialog is never left empty.
  let providers = { google: true };
  let leaveArmed = 0;        // a guest's first tap on "Leave guest account"
  let owned = new Set();     // car colours this player has bought
  let why = null;            // what the sign-in is for: 'race' | 'online' | 'challenge', or null

  if (!onlineEnabled()) {
    return { ready: Promise.resolve(null), canPlay: async () => true, needsName: () => false, signedIn: () => false, lapDone() {}, submitChallenge() {}, refresh() {}, owned, shopOpen: false, get user() { return null; } };
  }

  // What fills in once Supabase answers (the sign-in button, the challenge
  // card, the leaderboard) has its room from the start, so the menu doesn't
  // jump when it arrives.
  const late = ['accountBtn', 'challengeCard', 'board'];
  for (const id of late) $(id).hidden = false;
  $('boardList').innerHTML = '<li class="board-empty">Loading…</li>';
  // Today's challenge as the server will have it; it confirms below.
  challenge = challengeOn(todayUTC());
  renderChallenge();

  const ready = (async () => {
    online = await getOnline();
    if (!online) {
      for (const id of late) $(id).hidden = true;
      return null;
    }
    online.onUser(onUser);
    onUser(online.user);
    online.providers().then((p) => { providers = { ...providers, ...p }; renderMethods(); }, () => {});
    try {
      const c = await online.challenge();
      challenge = c && { day: c.day, track: c.track, goal: GOALS.find((g) => g.id === c.goal) || goalFor(c.day) };
    } catch (err) {
      console.warn('No daily challenge', err);
      challenge = null;
    }
    renderChallenge();
    refresh();
    openSharedGhost();
    if (shopOpen()) finishCheckout();
    return online;
  })();

  // ---------- account ----------

  // A Google account picks its own name first, including an old guest's that
  // just added Google with a made-up "Guest 48213" one. Guests (accounts from
  // before November 2026) count as not signed in: they can add Google.
  const needsName = (user) => !!user && !user.guest && (!user.name || GUEST_NAME.test(user.name));
  const signedIn = (user) => !!user && !user.guest && !!user.name && !needsName(user);

  function onUser(user) {
    $('accountLabel').textContent = !user ? 'Sign in' : needsName(user) ? 'Pick a name' : user.name || 'Guest';
    $('accountBtn').classList.toggle('signed-in', !!user);
    if (!$('account').hidden) renderAccount();
    if (needsName(user)) openAccount();
    if (signedIn(user)) sendLocalBests();
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

  // Back from the checkout, or a reload cut it short: add the colour if it's
  // paid, and say what happened either way.
  async function finishCheckout() {
    const result = await resumeCheckout(online);
    if (result?.status === 'failed') game.toast('Car colour', 'Payment failed', PAYMENT_FAILED, '');
    const colour = result?.paid && COLOURS.find((c) => c.id === result.colour);
    if (!colour) return;
    owned = new Set([...owned, colour.id]);
    game.ownedChanged();
    game.toast('Car colour', colour.name, 'Bought. It\'s in your garage', 'best');
  }

  const shopOpen = () => !!online && (CONFIG.shop || !!online.mock);

  // Buying a colour (shop.js takes the payment): true once it's the player's.
  async function buy(colour, currency) {
    if (!(await buyColour(online, colour, currency))) return false;
    owned = new Set([...owned, colour.id]);
    track('Buy colour', { colour: colour.name, currency });
    game.ownedChanged();
    return true;
  }

  function openAccount(reason = null) {
    why = reason;
    renderAccount();
    $('account').hidden = false;
    // The first thing to press or fill in; just the close button over your own details.
    const first = (!online.user || needsName(online.user)) && [...$('account').querySelectorAll('.primary, .google-btn, input')].find((el) => el.offsetParent);
    (first || $('accountClose')).focus({ preventScroll: true });
  }

  function closeAccount() {
    if (needsName(online.user)) return; // a Google account still picking its name
    $('account').hidden = true;
  }

  // Whether a run can start. Time trials are open to everyone; `need` (racing
  // AI drivers or online, or the daily challenge) needs a Google account with
  // its name, so it brings up the sign-in instead. A Google account still
  // without its name picks one first either way. With online features not
  // working the game plays on.
  async function canPlay(need = null) {
    await ready;
    if (!online) return true;
    if (needsName(online.user) || (need && !signedIn(online.user))) {
      track('Sign in', { step: 'asked', for: need || 'name' });
      openAccount(need);
      return false;
    }
    return true;
  }

  function renderAccount() {
    const user = online.user;
    const view = !user ? 'signin' : needsName(user) ? 'name' : 'me';
    // A guest gets the Google button too, to keep their laps.
    const shown = view === 'me' && user.guest && providers.google ? ['me', 'signin'] : [view];
    for (const v of ['signin', 'name', 'me']) $(`account-${v}`).hidden = !shown.includes(v);
    clearTimeout(leaveArmed);
    leaveArmed = 0;
    $('signOutBtn').hidden = view !== 'me';
    $('accountClose').hidden = view === 'name';
    $('signOutBtn').textContent = user?.guest ? 'Leave guest account' : 'Sign out';
    $('accountError').textContent = '';
    renderMethods();
    if (view === 'me') {
      $('accountName').textContent = user.name;
      $('accountEmail').textContent = user.guest ? 'Guest account, in this browser only' : user.email || '';
    }
    if (view === 'name') $('nameInput').value = user.name && !GUEST_NAME.test(user.name) ? user.name : '';
  }

  // Google shows once it's switched on in Supabase. The text says what
  // signing in is for, when a run asked for it.
  const WHY = {
    race: 'Racing AI drivers needs a Google account.',
    online: 'Online races need a Google account, so the other drivers see your name.',
    challenge: 'The daily challenge has its own leaderboard, so it needs a Google account.',
  };
  function renderMethods() {
    $('googleSignin').hidden = !providers.google;
    $('signinText').textContent = online.user?.guest
      ? 'Continue with Google to keep your laps and name on any device. Races, the daily challenge and the leaderboards need a Google account.'
      : `${WHY[why] || 'Sign in with Google to race AI drivers and other players, play the daily challenge and put your laps on the leaderboards.'} Time trials are free to play without an account.`;
  }

  // The button shows before Supabase has loaded; a tap that early waits for it.
  $('accountBtn').addEventListener('click', () => ready.then((o) => o && openAccount()));
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
  $('googleBtn').addEventListener('click', signInVia('google', () => online.signInWithGoogle()));

  $('nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim();
    if (!/^[A-Za-z0-9 ._-]{2,20}$/.test(name)) return error('2–20 letters, numbers, spaces, dots, dashes or underscores.');
    if (/^guest/i.test(name)) return error('Names starting with "Guest" are kept for guest accounts.');
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
    await online.signOut();
    openAccount(); // the way back in, or to another account
  });

  function error(msg) { $('accountError').textContent = msg; }
  function busy(id, on) { for (const el of $(id).querySelectorAll('button, input')) el.disabled = on; }

  // ---------- daily challenge ----------

  // The circuit and today's goal, what each medal needs (ticked off once
  // won), the streak of days with a medal (towards the Hot Streak colour),
  // and how today has gone: the best result, its medal and what the next needs.
  function renderChallenge() {
    const t = challenge && game.tracks.find((x) => x.id === challenge.track);
    $('challengeCard').hidden = !t;
    if (!t) return;
    const { day, goal } = challenge;
    $('challengeTrack').textContent = t.name;
    $('challengeTwist').innerHTML = `<b>${goal.name}</b> ${goal.blurb}`;
    const got = todaysMedal(day), medals = goalMedals(goal, t);
    $('challengeMedals').innerHTML = medals.map((v, k) =>
      `<span class="medal-target${got > k ? ' got' : ''}" title="${MEDALS[k]}${got > k ? ': won today' : ''}"><i class="medal m${k + 1}"></i><b>${medalTarget(goal, v)}</b>${got > k ? '<span class="tick" aria-label="won">✓</span>' : ''}</span>`).join('');
    $('challengeResult').innerHTML = challengeResult(loadChallengeResult(day), got, medals, goal);
    const n = streak(day), won = bestStreak() >= STREAK_GOAL;
    $('challengeStreak').textContent = won ? `Streak ${n}` : `Streak ${n} of ${STREAK_GOAL}`;
    $('challengeStreak').title = won
      ? 'Days in a row with a challenge medal'
      : `A medal here ${STREAK_GOAL} days in a row wins the Hot Streak car colour`;
    const end = new Date(day + 'T00:00:00Z').getTime() + 864e5;
    const hours = Math.max(0, Math.ceil((end - Date.now()) / 36e5));
    $('challengeEnds').textContent = `Ends in ${hours} h`;
  }

  // "Today  [medal] Bronze  0:28.412  0.212 s to silver", or what the first
  // medal needs before any try.
  function challengeResult(res, got, medals, goal) {
    const race = goal.id === 'back';
    const lbl = '<span class="lbl">Today</span>';
    if (!res) return `${lbl}<span class="next">${race ? 'No race yet. Top 3 wins a medal' : `No result yet. ${MEDALS[0]} needs ${medalTarget(goal, medals[0])}`}</span>`;
    const gap = got < 3 ? res.time - medals[got] : 0;
    const next = got === 3 ? 'Top medal'
      : race ? ['Top 3 for bronze', '2nd for silver', 'Win for gold'][got]
      : gap > 0 ? `${gap.toFixed(3)} s to ${MEDALS[got].toLowerCase()}` : '';
    return lbl
      + (got ? `<span class="won m${got}"><i class="medal m${got}"></i>${MEDALS[got - 1]}</span>` : '<span class="won">No medal yet</span>')
      + `<b class="best">${formatTime(res.time)}</b>`
      + (next ? `<span class="next">${next}</span>` : '');
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
    renderChallenge();
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
    $('boardSignin').hidden = signedIn(online.user);
  }

  $('boardSignin').addEventListener('click', () => openAccount());

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
    // A lap from today's board was driven with today's twist, so is raced with it.
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

  // A finished lap: upload it if it's a personal best (or today's challenge),
  // once signed in with Google.
  async function lapDone(t, e) {
    if (!signedIn(online?.user) || !e.valid || e.rescued || !e.isBest || !e.ghost) return;
    try {
      const res = await online.submitLap(t.id, { time: e.time, sectors: e.sectors, ghost: e.ghost });
      markSent(t.id, e.time);
      track('Leaderboard lap', { track: t.name, board: 'circuit' });
      if (res.improved) game.toast('Leaderboard', `#${res.rank}`, `on ${t.name}`, 'info');
      refresh();
    } catch (err) {
      console.warn('Lap upload failed', err);
    }
  }

  // Today's best challenge result, on today's board. What the time is (a
  // lap, a race, three laps, a sprint) depends on the day's goal.
  async function submitChallenge(time) {
    if (!signedIn(online?.user)) return;
    try {
      const res = await online.submitChallenge(time);
      track('Leaderboard lap', { track: challenge?.track || '', board: 'challenge' });
      if (res.improved) game.toast("Today's challenge", `#${res.rank}`, 'Your best today', 'info');
      refresh();
    } catch (err) {
      console.warn('Challenge upload failed', err);
    }
  }

  // Time trials need no account, so laps set before signing in go up once a
  // Google account has its name: each circuit's best, unless this browser has
  // already sent that account one as quick. A lap the server turns down isn't
  // tried again; one lost to the network is, next time.
  const SENT = 'latebrake:sent'; // { [user id]: { [track id]: time sent } }
  let sending = false;
  function sentTimes() {
    try {
      return JSON.parse(localStorage.getItem(SENT)) || {};
    } catch {
      return {};
    }
  }
  function markSent(trackId, time) {
    const sent = sentTimes(), id = online.user.id;
    sent[id] = { ...sent[id], [trackId]: time };
    try { localStorage.setItem(SENT, JSON.stringify(sent)); } catch {}
  }
  async function sendLocalBests() {
    if (sending) return;
    sending = true;
    const id = online.user.id;
    let any = false;
    for (const t of game.tracks) {
      const best = loadTrack(t.id)?.best;
      const sent = sentTimes()[id]?.[t.id];
      if (!best?.ghost || best.rescued || (sent !== undefined && sent <= best.time)) continue;
      try {
        await online.submitLap(t.id, { time: best.time, sectors: best.sectors, ghost: best.ghost });
        any = true;
      } catch (err) {
        console.warn('Lap upload failed', t.id, err);
        if (/fetch|network/i.test(err.message)) continue;
      }
      if (online.user?.id !== id) break; // signed out meanwhile
      markSent(t.id, best.time);
    }
    sending = false;
    if (any) refresh();
  }

  return {
    ready, canPlay, lapDone, submitChallenge, refresh, buy, needsName, signedIn,
    get challenge() { return challenge; }, // { day, track, goal } or null
    continueWithGoogle: () => online.signInWithGoogle(),
    get owned() { return owned; },
    get shopOpen() { return shopOpen(); },
    get user() { return online?.user || null; },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
