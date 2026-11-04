import { TRACKS, buildTrack } from './track.js';
import { DT } from './car.js';
import { Session, COUNTDOWN } from './session.js';
import { RaceSession } from './race.js';
import { OnlineRaceSession } from './online-race.js';
import { createLobby } from './lobby-ui.js';
import { createInput } from './input.js';
import { createRenderer, drawTrackPreview, drawCarPreview } from './render.js';
import { loadTrack, saveTrack, clearTrack, formatTime } from './storage.js';
import { loadSettings, saveSettings, SENSITIVITY, LINE_MODES, CAMERAS } from './settings.js';
import { createAudio } from './audio.js';
import { createView3D } from './view3d.js';
import { createPlatform } from './platform.js';
import { initAnalytics, track, reportError } from './analytics.js';
import { createOnlineUI } from './online-ui.js';
import { MEDALS, COLOURS, loadMedals, clearMedals, medalCount, earnMedal, unlocked, colourFor } from './medals.js';
import { CURRENCIES, shopCurrency, currencyName, priceText } from './shop.js';

const $ = (id) => document.getElementById(id);
const tracks = TRACKS.map(buildTrack);
const settings = loadSettings();
let colour = colourFor(settings.colour, new Set()); // what the car is painted in; bought colours count once signed in
const input = createInput($('touch'), { onPad });
const renderer = createRenderer($('game'), $('minimap'));
const audio = createAudio();
initAnalytics();

// Ads (on game portals) pause the game and its sound while they play.
let adPlaying = false;
const platform = createPlatform({
  onAdStart() { adPlaying = true; audio.suspend(); },
  onAdEnd() { adPlaying = false; if (session && !paused) audio.resume(); },
});
let runsStarted = 0;
let runOpts = {};          // what the current run is: { versus, challenge, mode }
let pendingVersus = null;  // a shared ghost waiting for the next Start

// play.html?track=<id> opens straight onto that circuit.
const wanted = new URLSearchParams(location.search).get('track');
let selected = tracks.find((t) => t.id === wanted) || tracks[0];
let session = null;       // the live run, null while in the menu
let backdrop = null;      // parked car drawn behind the menu
let paused = false;
let acc = 0;
let last = performance.now();
let toastTimer = 0;
let lastLit = -1;
let stuckTime = 0;        // seconds stopped off track or against a wall
let stuckHinted = false;  // the reset hint shows once per run

// Keep going off track and the timing panel suggests the racing line (or a
// restart) while the car drives on.
const HELP_AFTER = 3;        // trips off track (or hard wall hits)...
const HELP_WINDOW = 120;     // ...within this many seconds of driving
const HELP_SHOWN = 10;       // seconds of driving the suggestion stays up
const HELP_MAX_IGNORED = 2;  // left unused this often: stop suggesting
let incidents = [];          // session clock times of recent trips off
let helpOffered = false;     // at most once per run
let helpUntil = 0;           // session clock time the suggestion goes; 0 when it isn't up
let helpIgnored = 0;
let resumeTimer = 0;         // the 3, 2, 1 after Resume; 0 when not counting

// ---------- menu ----------

function buildMenu() {
  syncSettings();
  syncMode();
  const list = $('trackList');
  list.innerHTML = '';
  const medals = loadMedals();
  $('medalCount').textContent = medalCount(medals);
  $('garageBtn').setAttribute('aria-label', `Garage, ${medalCount(medals)} medals`);
  for (const t of tracks) {
    const saved = loadTrack(t.id);
    const m = medals[t.id];
    const card = document.createElement('button');
    card.className = 'track-card' + (t === selected ? ' selected' : '');
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', String(t === selected));
    card.innerHTML = `
      <canvas aria-hidden="true"></canvas>
      <div>
        <div class="track-name">${t.name}</div>
        <div class="track-sub">${t.country} · ${(t.length / 1000).toFixed(2)} km</div>
      </div>
      <div class="track-best"><span class="label">Best</span><b>${m ? `<i class="medal m${m}" title="${MEDALS[m - 1]} medal"></i>` : ''}${saved?.best ? formatTime(saved.best.time) : '—'}</b></div>`;
    card.addEventListener('click', () => select(t));
    card.addEventListener('dblclick', () => requestRun());
    list.appendChild(card);
  }
  updateDetail();
  // Draw previews once the cards have been laid out.
  requestAnimationFrame(() => {
    list.querySelectorAll('canvas').forEach((c, i) => drawTrackPreview(c, tracks[i]));
    drawTrackPreview($('detailMap'), selected, { detail: true });
  });
}

function select(t) {
  if (t === selected) return;
  selected = t;
  backdrop = new Session(t, null);
  renderer.setTrack(t);
  const cards = $('trackList').children;
  tracks.forEach((tr, i) => {
    cards[i].classList.toggle('selected', tr === t);
    cards[i].setAttribute('aria-selected', String(tr === t));
  });
  cards[tracks.indexOf(t)].scrollIntoView({ block: 'nearest' });
  updateDetail();
  drawTrackPreview($('detailMap'), t, { detail: true });
  onlineUI.refresh();
}

function syncMode() {
  for (const b of document.querySelectorAll('.mode[data-mode]')) {
    const on = b.dataset.mode === settings.mode;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  }
  show('raceOptions', settings.mode === 'race' || settings.mode === 'online');
  // Online, the host's "fill with AI" decides how many rivals there are.
  $('rivalsOption').hidden = settings.mode === 'online';
  $('startBtn').firstChild.textContent = settings.mode === 'online' ? 'Open lobby ' : 'Start ';
}
for (const b of document.querySelectorAll('.mode[data-mode]')) {
  b.addEventListener('click', () => { if (!b.disabled) setSetting('mode', b.dataset.mode); });
}

function updateDetail() {
  const t = selected, saved = loadTrack(t.id);
  $('detailCountry').textContent = t.country;
  $('detailName').textContent = t.name;
  $('detailBlurb').textContent = t.blurb;
  $('detailLength').textContent = `${(t.length / 1000).toFixed(3)} km`;
  $('versusNote').hidden = !(pendingVersus && pendingVersus.track === t);
  if (pendingVersus) $('versusNote').textContent = `Racing ${pendingVersus.ghost.name}'s ghost · ${formatTime(pendingVersus.ghost.time)}`;
  $('detailBest').textContent = saved?.best
    ? formatTime(saved.best.time) + (saved.best.rescued ? ' · rescued' : '')
    : 'No time yet';
  const bs = saved?.bestSectors;
  $('detailSectors').textContent = bs?.every((x) => x != null)
    ? bs.map((x) => formatTime(x).replace(/^0:/, '')).join(' · ')
    : '—';
  // The lap times that win each medal here, ticked off once won.
  const got = loadMedals()[t.id] || 0;
  $('detailMedals').innerHTML = t.medals.map((time, k) =>
    `<span class="medal-target${got > k ? ' got' : ''}"><i class="medal m${k + 1}"></i>${MEDALS[k]} <b>${formatTime(time).replace(/\.?0+$/, '')}</b></span>`).join('');
}

function openMenu({ keepRoom = false } = {}) {
  if (!keepRoom) lobby.leave();
  if (session) track('Quit to menu', { track: selected.name, laps: String(session.laps.length) });
  platform.gameplayStop();
  clearTimeout(resultsTimer);
  document.body.classList.remove('racing');
  session = null;
  audio.silence();
  paused = false;
  stopResumeCount();
  hideHelp();
  backdrop = new Session(selected, null);
  renderer.setTrack(selected);
  show('menu', true);
  show('pause', false);
  show('results', false);
  show('hud', false);
  show('lights', false);
  hideToast();
  buildMenu();
  $('startBtn').focus({ preventScroll: true });
}

// A new run when the player asks for one: a chance for an ad break first
// (never before the very first run), then the start lights.
// `opts` (versus, challenge, mode) default to what the last run was, so a
// restart keeps racing the same ghost or challenge.
async function requestRun(opts) {
  if (adPlaying) return;
  if (!session && !(await onlineUI.canPlay())) return; // guest or Google first
  if (session?.online) return toast('Online race', "Can't restart", 'Finish the race or leave it from the pause menu', 'info');
  if (!session && settings.mode === 'online' && !(opts && !(opts instanceof Event) && opts.mode)) return lobby.open();
  if (opts instanceof Event || opts === undefined) opts = session ? runOpts : menuRunOpts();
  if (runsStarted > 0) {
    paused = true;
    stopResumeCount();
    await platform.commercialBreak();
  }
  startRun(opts);
}

// What Start in the menu means: a shared ghost if one is waiting for this
// circuit, otherwise the chosen mode.
function menuRunOpts() {
  if (pendingVersus && pendingVersus.track === selected) return { versus: pendingVersus.ghost, mode: 'trial' };
  return {};
}

function startRun(opts = {}) {
  runOpts = opts;
  runsStarted++;
  audio.unlock();
  audio.resume();
  lastLit = -1;
  stuckTime = 0;
  stuckHinted = false;
  incidents = [];
  helpOffered = false;
  const saved = loadTrack(selected.id);
  const mode = opts.mode || settings.mode;
  session = opts.online ? new OnlineRaceSession(selected, saved, opts.online)
    : mode === 'race'
    ? new RaceSession(selected, saved, { opponents: settings.opponents, laps: settings.raceLaps, difficulty: settings.difficulty, name: onlineUI.user?.name })
    : new Session(selected, saved, { versus: opts.versus, challenge: opts.challenge });
  resultsShownAt = 0;
  renderer.setTrack(selected);
  paused = false;
  stopResumeCount();
  hideHelp();
  acc = 0;
  show('menu', false);
  show('pause', false);
  show('settings', false);
  show('controls', false);
  show('results', false);
  document.body.classList.toggle('racing', session.mode === 'race');
  show('hud', true);
  hideToast();
  $('trackLabel').textContent = opts.versus ? `vs ${opts.versus.name}` : opts.challenge ? 'Daily challenge' : selected.name;
  document.activeElement?.blur?.();
  platform.gameplayStart();
  track('Run start', { track: selected.name, mode: opts.challenge ? 'challenge' : opts.versus ? 'versus' : mode, camera: settings.camera, line: settings.line });
}

// Pausing is instant; resuming counts 3, 2, 1 first, with the car still
// frozen, so it doesn't set off the moment the menu goes (unless the start
// lights are still counting). Pausing again during the count stops it.
function setPaused(p) {
  if (!session || adPlaying || (!p && !paused)) return;
  stopResumeCount();
  show('pause', p);
  if (p) {
    paused = true;
    platform.gameplayStop();
    audio.suspend();
    $('resumeBtn').focus({ preventScroll: true });
    return;
  }
  show('settings', false);
  show('controls', false);
  show('lights', false); // a GO left from the start would sit under the count
  document.activeElement?.blur?.();
  let n = session.phase === 'countdown' ? 0 : 3;
  const tick = () => {
    const el = $('resumeCount');
    if (n === 0) {
      stopResumeCount();
      paused = false;
      platform.gameplayStart();
      audio.resume();
      return;
    }
    el.textContent = n--;
    el.classList.remove('tick');
    void el.offsetWidth; // restarts the animation for each number
    el.classList.add('tick');
    show('resumeCount', true);
  };
  resumeTimer = setInterval(tick, 700);
  tick();
}

function stopResumeCount() {
  clearInterval(resumeTimer);
  resumeTimer = 0;
  show('resumeCount', false);
}

// Escape, P and the pad's pause button: pause while driving or counting
// down, resume from the pause menu.
const togglePause = () => setPaused(!paused || !!resumeTimer);

// ---------- controls ----------

// Every key, touch button and gamepad button. It opens on the way this
// player drives: gamepad once one is plugged in, touch on a phone.
let controlsOpener = null; // focused again on closing (Settings can open it)
function openControls() {
  controlsOpener = document.activeElement;
  const pad = [...(navigator.getGamepads?.() || [])].some((p) => p?.connected);
  showControls(pad ? 'pad' : document.body.classList.contains('touch') ? 'touch' : 'keys');
  show('controls', true);
  $('controlsDone').focus({ preventScroll: true });
}

function showControls(tab) {
  for (const b of $('controlsTabs').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.tab === tab));
  for (const el of $('controls').querySelectorAll('.controls-table, .controls-note')) el.hidden = el.dataset.tab !== tab;
}

function closeControls() {
  show('controls', false);
  const back = controlsOpener?.getClientRects().length ? controlsOpener : session ? $('resumeBtn') : $('startBtn');
  back.focus({ preventScroll: true });
}

document.querySelectorAll('[data-open="controls"]').forEach((b) => b.addEventListener('click', openControls));
$('controlsTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showControls(b.dataset.tab);
});
$('controlsClose').addEventListener('click', closeControls);
$('controlsDone').addEventListener('click', closeControls);
$('controls').addEventListener('click', (e) => { if (e.target === $('controls')) closeControls(); });

// ---------- settings ----------

function openSettings() {
  syncSettings();
  show('settings', true);
  $('settingsDone').focus({ preventScroll: true });
}

function closeSettings() {
  show('settings', false);
  (session ? $('resumeBtn') : $('startBtn')).focus({ preventScroll: true });
}

function setSetting(name, value) {
  if (name === 'sound') {
    audio.unlock();
    audio.setMuted(value !== 'true');
    syncMute();
  } else {
    settings[name] = name === 'ghost' ? value === 'true'
      : name === 'opponents' || name === 'raceLaps' ? Number(value) : value;
    saveSettings(settings);
  }
  colour = colourFor(settings.colour, onlineUI.owned);
  syncSettings();
  syncMode();
}

function syncSettings() {
  const values = { ...settings, sound: !audio.muted };
  for (const group of document.querySelectorAll('[data-setting]')) {
    const v = String(values[group.dataset.setting]);
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === v));
  }
}

for (const group of document.querySelectorAll('[data-setting]')) {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSetting(group.dataset.setting, b.dataset.value);
  });
}
document.querySelectorAll('[data-open="settings"]').forEach((b) => b.addEventListener('click', openSettings));
$('settingsClose').addEventListener('click', closeSettings);
$('settingsDone').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });
// Two taps to delete: browser confirm() dialogs are often blocked inside
// game portals' frames.
let resetArmed = 0;
$('resetRecords').addEventListener('click', () => {
  const btn = $('resetRecords');
  if (!resetArmed) {
    btn.textContent = 'Tap again to delete';
    resetArmed = setTimeout(() => { resetArmed = 0; btn.textContent = 'Reset all'; }, 3000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = 0;
  btn.textContent = 'Reset all';
  for (const t of tracks) clearTrack(t.id);
  clearMedals();
  colour = colourFor(settings.colour, onlineUI.owned);
  if (session) {
    session.best = null;
    session.bestSectors = [null, null, null];
  }
  buildMenu();
  toast('Lap records', 'Cleared', '', 'info');
});

// ---------- garage ----------

let offered = null; // the locked colour shown for sale
const price = (c) => priceText(c, shopCurrency(settings.currency));

function openGarage() {
  renderGarage();
  show('garage', true);
  ($('colourList').querySelector('[aria-checked="true"]') || $('garageDone')).focus({ preventScroll: true });
}

function closeGarage() {
  show('garage', false);
  $('garageBtn').focus({ preventScroll: true });
}

// Car colours to pick from. A locked one says how many medals unlock it
// and, when the shop is open, its price in the player's currency. Shop-only
// colours (Coffee among them) are left out while the shop is shut.
function renderGarage() {
  const count = medalCount(), max = tracks.length * MEDALS.length, shop = onlineUI.shopOpen;
  const shown = COLOURS.filter((c) => isFinite(c.needs) || shop || unlocked(c, onlineUI.owned));
  $('garageText').textContent = count >= max
    ? `All ${max} medals. Every colour you can win is yours.`
    : `${count} of ${max} medals. Win medals on the circuits to unlock colours${shop ? ', or buy them. Some are only in the shop' : ''}. A gold counts as three.`;
  const pick = $('currency');
  if (!pick.options.length) {
    pick.innerHTML = CURRENCIES.map((code) => ({ code, name: currencyName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ code, name }) => `<option value="${code}">${name} (${code})</option>`).join('');
  }
  pick.value = shopCurrency(settings.currency);
  show('currencyPick', shop && shown.some((c) => !unlocked(c, onlineUI.owned)));
  const list = $('colourList');
  list.innerHTML = shown.map((c) => {
    const open = unlocked(c, onlineUI.owned);
    return `<button data-colour="${c.id}" role="radio" aria-checked="${c === colour}"${open ? '' : ' class="locked"'}${open || shop ? '' : ' disabled'}>
      <canvas aria-hidden="true"></canvas>
      <span class="colour-name">${c.name}</span>
      <small>${open ? '' : c.tip ? `A coffee for the dev, ${price(c)}` : isFinite(c.needs) ? `${c.needs} medals${shop ? ` or ${price(c)}` : ''}` : `Shop only, ${price(c)}`}</small>
    </button>`;
  }).join('');
  hideOffer();
  requestAnimationFrame(() => list.querySelectorAll('canvas').forEach((cv, i) => drawCarPreview(cv, shown[i].paint)));
}

// A locked colour tapped: offer it for sale. Buying needs Google, so a
// guest is asked to continue with Google first (they keep their laps).
function offerColour(c) {
  offered = c;
  const guest = onlineUI.user?.guest;
  $('buyText').textContent = guest
    ? `${c.name} costs ${price(c)}. Buying needs a Google account so the colour stays yours on any device. Your laps and name come with you.`
    : c.tip
      ? `Buy the developer a coffee for ${price(c)} and your car gets painted to match. No medals win this one. It stays yours on any device you sign in to with Google.`
      : isFinite(c.needs)
        ? `Win ${c.needs} medals to unlock ${c.name} free, or buy it now for ${price(c)}. It stays yours on any device you sign in to with Google.`
        : `${c.name} is only in the shop, ${price(c)}. Rivals see it in online races, and it stays yours on any device you sign in to with Google.`;
  $('buyBtn').textContent = guest ? 'Continue with Google' : `Buy for ${price(c)}`;
  $('buyError').textContent = '';
  show('buyPanel', true);
  $('buyBtn').focus({ preventScroll: true });
}

function hideOffer() {
  offered = null;
  show('buyPanel', false);
}

// play.html?buy=<colour> (the home page's coffee) opens the Garage offering
// that colour once the player is signed in and named. It's kept for this tab
// until then, since signing in with Google leaves the page and comes back
// without it, and so is a guest's colour on the way to Google.
const BUY = 'latebrake:buy';
let toBuy = new URLSearchParams(location.search).get('buy');
try {
  if (toBuy) sessionStorage.setItem(BUY, toBuy);
  else toBuy = sessionStorage.getItem(BUY);
} catch {}

function offerToBuy() {
  const c = COLOURS.find((x) => x.id === toBuy);
  if (!c || !onlineUI.shopOpen || !onlineUI.user?.name || session) return;
  toBuy = null;
  try { sessionStorage.removeItem(BUY); } catch {}
  if (unlocked(c, onlineUI.owned)) return;
  openGarage();
  offerColour(c);
}

$('colourList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-colour]');
  if (!b) return;
  const c = COLOURS.find((x) => x.id === b.dataset.colour);
  if (!unlocked(c, onlineUI.owned)) return offerColour(c);
  setSetting('colour', c.id);
  renderGarage();
});

$('buyBtn').addEventListener('click', async () => {
  const c = offered;
  if (!c) return;
  $('buyBtn').disabled = true;
  try {
    if (onlineUI.user?.guest) {
      try { sessionStorage.setItem(BUY, c.id); } catch {}
      await onlineUI.continueWithGoogle();
    } else if (await onlineUI.buy(c, shopCurrency(settings.currency))) {
      setSetting('colour', c.id);
      renderGarage();
      toast('Car colour', c.name, "It's yours on any device", 'best');
    }
  } catch (err) {
    $('buyError').textContent = err.message;
  } finally {
    $('buyBtn').disabled = false;
  }
});
$('buyCancel').addEventListener('click', hideOffer);
$('currency').addEventListener('change', (e) => {
  const c = offered;
  setSetting('currency', e.target.value);
  renderGarage();
  if (c) offerColour(c);
});
$('garageBtn').addEventListener('click', openGarage);
$('garageClose').addEventListener('click', closeGarage);
$('garageDone').addEventListener('click', closeGarage);
$('garage').addEventListener('click', (e) => { if (e.target === $('garage')) closeGarage(); });

// ---------- loop ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  try {
    if (session && !paused && !adPlaying) {
      acc += dt;
      const inp = input.read();
      inp.sens = SENSITIVITY[settings.sensitivity];
      let steps = 0;
      while (acc >= DT && steps < 6) {
        session.step(inp);
        if (session.phase === 'running') renderer.addSkid(session.car);
        acc -= DT;
        steps++;
      }
      if (steps === 6) acc = 0;
      handleEvents();
      watchStuck(dt);
      const drove = session.finished ? session.lastInput || inp : inp;
      if (session.phase === 'running') audio.update(session.car, drove, dt);
      else audio.idle(drove, dt);
      updateHud(drove);
    } else if (!session) {
      input.read(); // keeps gamepad buttons live in the menu
    }

    const view = session || backdrop;
    if (view) {
      const alpha = session && !paused ? acc / DT : 1;
      const cockpit = settings.camera === 'cockpit' && get3D();
      showCockpit(!!cockpit);
      const opts = { ghost: settings.ghost, camera: cockpit ? 'none' : settings.camera, line: settings.line, paint: colour.paint };
      renderer.draw(view, alpha, opts, dt);
      if (cockpit) cockpit.draw(view, alpha, opts);
    }
  } catch (err) {
    // One bad frame shouldn't kill the loop; log it and keep going.
    console.error(err);
    reportError(err, 'frame');
  }
  requestAnimationFrame(frame);
}

function handleEvents() {
  for (const e of session.events) {
    if (e.type === 'lap' && !(session.mode === 'race' && e.lap > session.totalLaps)) onLap(e);
    if (e.type === 'finish') onFinish(e);
    if (session.finished && (e.type === 'invalid' || e.type === 'off')) continue; // autopilot after the flag
    if (e.type === 'invalid') {
      flash('invalidBadge');
      audio.beep(220, 0.3, 0.14);
      track('Lap invalid', { track: selected.name });
    }
    if (e.type === 'hit') audio.hit(e.impact);
    if (e.type === 'off' || (e.type === 'hit' && e.impact > 6)) noteIncident();
    if (e.type === 'go') audio.beep(1046, 0.5, 0.2);
    if (e.type === 'reset') toast('Reset', 'Back on track', '', 'info');
  }
  session.events.length = 0;
}

// ---------- race ----------

let resultsShownAt = 0;
let resultsTimer = 0;

function onFinish(e) {
  track('Race finish', { track: selected.name, position: String(e.position), rivals: String(session.opponents.length), difficulty: session.opts.difficulty, online: session.online ? 'yes' : 'no' });
  if (e.position === 1) platform.happyTime();
  audio.chime(e.position === 1 ? 'best' : 'lap');
  clearTimeout(resultsTimer);
  // Let the finish sink in for a moment, then show the table.
  resultsTimer = setTimeout(() => {
    if (!session?.finished) return;
    resultsShownAt = performance.now();
    renderResults();
    show('results', true);
    platform.gameplayStop();
    $('raceAgainBtn').focus({ preventScroll: true });
  }, 1600);
}

function renderResults() {
  const rows = session.classify();
  const me = rows.find((r) => r.me);
  $('resultsTrack').textContent = `${selected.name} · ${session.totalLaps} laps · ${session.online ? 'online' : session.opts.difficulty}`;
  $('resultsPos').textContent = `P${me.pos}`;
  $('resultsBody').innerHTML = rows.map((r) => {
    const time = r.pos === 1 && r.done ? formatTime(r.time)
      : !r.done && r.lapsDown > 0 ? `+${r.lapsDown} lap${r.lapsDown > 1 ? 's' : ''}`
      : `+${r.gap.toFixed(3)}${r.done ? '' : '*'}`;
    return `<tr class="${r.me ? 'me' : ''}"><td>${r.pos}</td><td><span class="swatch-dot" style="background:${esc(r.me ? colour.paint : r.color)}"></span>${esc(r.name)}</td><td>${time}</td><td>${formatTime(r.bestLap)}</td></tr>`;
  }).join('');
}

$('raceAgainBtn').addEventListener('click', () => {
  if (session?.online) {
    openMenu({ keepRoom: true });
    lobby.backToLobby();
  } else {
    requestRun();
  }
});
$('resultsMenuBtn').addEventListener('click', () => openMenu());

// ---------- help when struggling ----------

function noteIncident() {
  const now = session.clock;
  // One spin can mean several hits; count it once.
  if (incidents.length && now - incidents.at(-1) < 3) return;
  incidents.push(now);
  incidents = incidents.filter((t) => now - t <= HELP_WINDOW);
  if (incidents.length >= HELP_AFTER && !helpOffered && helpIgnored < HELP_MAX_IGNORED) offerHelp();
}

// The racing line if it's off, else a restart (which online races don't have).
function offerHelp() {
  helpOffered = true;
  const lineOn = settings.line !== 'off';
  if (lineOn && session.online) return;
  const what = session.mode === 'race' ? 'race' : 'lap';
  $('helpBtn').innerHTML = lineOn
    ? `<kbd class="keys-only">R</kbd>Tough ${what}? <b>Restart it</b>`
    : '<kbd class="keys-only">L</kbd>Off a lot? <b>Show the racing line</b>';
  $('helpBtn').classList.add('on');
  helpUntil = session.clock + HELP_SHOWN;
  track('Help offered', { track: selected.name, line: settings.line });
}

function hideHelp() {
  helpUntil = 0;
  $('helpBtn').classList.remove('on');
}

$('helpBtn').addEventListener('click', () => {
  if (!helpUntil || !session) return;
  hideHelp();
  if (settings.line === 'off') {
    track('Help choice', { choice: 'line' });
    setSetting('line', 'full');
    toast('Racing line', 'On', 'Brake on red, lift on yellow, flat out on green', 'info');
  } else {
    track('Help choice', { choice: 'restart' });
    requestRun();
  }
});

// ---------- lap rescue ----------

// Watch a rewarded ad to keep a lap that went over the track limits. Once
// per lap, and the lap then counts as a personal best only.
async function keepLap() {
  if (!session?.canRescue || !platform.rewardedAvailable || adPlaying || resumeTimer) return;
  track('Rescue', { result: 'asked' });
  const rewarded = await platform.rewardedBreak();
  if (rewarded && session?.rescue()) {
    toast('Lap kept', 'Rescued', 'Counts as your personal best only', 'info');
    track('Rescue', { result: 'rewarded' });
  } else {
    toast('Lap rescue', 'No ad right now', 'Try again in a moment', 'info');
    track('Rescue', { result: 'no ad' });
  }
}
$('keepLapBtn').addEventListener('click', keepLap);

// Stopped in a gravel trap or against a wall for a couple of seconds:
// point out the reset, once per run.
function watchStuck(dt) {
  const car = session.car;
  const stuck = session.phase === 'running' && !session.finished && car.speed < 3 && (!car.onTrack || car.wall);
  stuckTime = stuck ? stuckTime + dt : 0;
  if (stuckTime > 2 && !stuckHinted) {
    stuckHinted = true;
    const touch = document.body.classList.contains('touch');
    toast('Stuck?', touch ? 'Tap ↺' : 'Press T', 'to get back on track', 'info');
  }
}

function resetCar() {
  if (session && !paused && session.resetToTrack()) stuckTime = 0;
}

function onLap(e) {
  if (e.valid) saveTrack(selected.id, session.saveData());
  let sub, cls;
  if (!e.valid) { sub = 'Invalid · track limits'; cls = 'bad'; }
  else if (e.isBest && e.prevBest === null) { sub = 'First lap on the board'; cls = 'best'; }
  else if (e.isBest) { sub = `New best ${formatTime(e.time - e.prevBest, true)}`; cls = 'best'; }
  else { sub = `${formatTime(e.time - e.prevBest, true)} to best`; cls = 'slower'; }
  if (e.rescued) sub += ' · rescued';
  if (e.isBest && !e.rescued) platform.happyTime();
  track('Lap', { track: selected.name, result: e.rescued ? 'rescued' : e.valid ? 'valid' : 'invalid', best: e.isBest ? 'yes' : 'no' });
  // A clean lap can win a medal, and medals unlock car colours.
  const won = e.valid && !e.rescued ? earnMedal(selected, e.time) : null;
  if (won) {
    const newColour = won.unlocked.filter((c) => !onlineUI.owned.has(c.id)).at(-1);
    if (newColour) sub = `New car colour unlocked: ${newColour.name}`;
    cls = 'best';
    track('Medal', { track: selected.name, medal: MEDALS[won.medal - 1] });
  }
  toast(won ? `${MEDALS[won.medal - 1]} medal` : `Lap ${e.lap}`, formatTime(e.time), sub, cls);
  onlineUI.lapDone(selected, e, session);
  audio.chime(cls === 'best' ? 'best' : cls === 'bad' ? 'bad' : 'lap');
}

// ---------- HUD ----------

const hudCache = {};
function setText(id, text) {
  if (hudCache[id] === text) return;
  hudCache[id] = text;
  $(id).textContent = text;
}
function setClass(id, cls) {
  const key = id + ':cls';
  if (hudCache[key] === cls) return;
  hudCache[key] = cls;
  $(id).className = cls;
}
function setScale(id, axis, v) {
  const q = Math.round(v * 50) / 50;
  const key = id + ':scale';
  if (hudCache[key] === q) return;
  hudCache[key] = q;
  $(id).style.transform = `scale${axis}(${q})`;
}

function updateHud(inp) {
  const s = session;
  const running = s.phase === 'running';
  const race = s.mode === 'race';
  setText('lapNum', race ? `${Math.min(s.lap, s.totalLaps)}/${s.totalLaps}` : String(s.lap));
  if (race) updateRaceHud(s);
  setText('lapTime', formatTime(s.lapTime));
  setText('speedVal', String(Math.round(s.car.speed * 3.6)));
  setText('gearVal', running ? (s.car.vf < -0.5 ? 'R' : String(audio.gear)) : 'N');
  setText('bestTime', formatTime(s.best?.time));
  setText('lastTime', formatTime(s.laps.at(-1)?.time));

  const rev = Math.max(0, Math.min(1, (audio.rpm - 4000) / (audio.rpmMax - 4000)));
  setScale('revFill', 'X', rev);
  setClass('revFill', 'rev-fill' + (rev > 0.97 ? ' limit' : ''));
  setScale('gasFill', 'Y', inp.throttle);
  setScale('brakeFill', 'Y', inp.brake);

  const d = running && s.valid ? s.delta() : null;
  setText('delta', d === null ? '' : formatTime(d, true));
  setClass('delta', 'delta ' + (d === null ? '' : d <= 0 ? 'ahead' : 'behind'));
  setClass('invalidBadge', 'badge' + (running && !s.valid ? ' on' : ''));
  setClass('keepLapBtn', 'keep-lap' + (s.canRescue && platform.rewardedAvailable ? ' on' : ''));
  if (helpUntil && s.clock > helpUntil) {
    hideHelp();
    helpIgnored++;
    track('Help choice', { choice: 'ignored' });
  }

  // Show the lap just finished for a few seconds, then the current lap.
  const prev = s.laps.at(-1);
  const hold = prev && s.lapTime < 3;
  const times = hold ? prev.sectors : s.sectorTimes;
  const classes = hold ? prev.classes : s.sectorClasses;
  for (let i = 0; i < 3; i++) {
    const done = i < times.length;
    setText('s' + i, done ? formatTime(times[i]).replace(/^0:/, '') : 'S' + (i + 1));
    setClass('s' + i, 'sector ' + (done ? classes[i] : i === times.length && !hold ? 'active' : ''));
  }

  // Start lights: three reds, then all out for GO.
  const elapsed = s.clock + COUNTDOWN;
  if (s.phase === 'countdown') {
    show('lights', true);
    const lit = Math.min(3, Math.floor(elapsed / 0.6));
    if (lit !== lastLit && lit > 0) audio.beep(523, 0.18, 0.16);
    lastLit = lit;
    document.querySelectorAll('#lights .light').forEach((l, i) => l.classList.toggle('on', i < lit));
    setText('lightsText', '');
  } else if (s.clock < 0.8 && s.lap === 1) {
    document.querySelectorAll('#lights .light').forEach((l) => l.classList.remove('on'));
    setText('lightsText', 'GO');
    show('lights', true);
  } else {
    show('lights', false);
  }
}

// Position and the standings list, refreshed a few times a second.
let raceHudAt = 0;
function updateRaceHud(s) {
  const now = performance.now();
  if (now - raceHudAt < 250) return;
  raceHudAt = now;
  const rows = s.standings;
  const pos = rows.findIndex((r) => r.me) + 1;
  const html = `P${pos}<small>/${rows.length}</small>`;
  if (hudCache.racePos !== html) { hudCache.racePos = html; $('racePos').innerHTML = html; }
  const list = rows.map((r, i) => {
    const gap = i === 0 ? 'Leader' : r.lapsDown > 0 ? `+${r.lapsDown}L` : `+${r.gap.toFixed(1)}`;
    return `<li class="${r.me ? 'me' : ''}"><span class="p">${i + 1}</span><span class="c" style="background:${esc(r.me ? colour.paint : r.color)}"></span><span class="n">${esc(r.name)}</span><span class="g">${gap}</span></li>`;
  }).join('');
  if (hudCache.standings !== list) { hudCache.standings = list; $('standings').innerHTML = list; }
  if (!$('results').hidden && now - resultsShownAt > 400) renderResults();
}

function toast(title, time, sub, cls) {
  const el = $('toast');
  el.className = 'toast show ' + cls;
  el.innerHTML = `<div class="toast-title">${esc(title)}</div><div class="toast-time">${esc(time)}</div>${sub ? `<div class="toast-sub">${esc(sub)}</div>` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, cls === 'info' ? 1800 : 3200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hideToast() {
  $('toast').className = 'toast';
}

function flash(id) {
  const el = $(id);
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function show(id, on) {
  $(id).hidden = !on;
}

// ---------- controls ----------

function toggleGhost() {
  setSetting('ghost', String(!settings.ghost));
  if (session) toast('Ghost', settings.ghost ? 'On' : 'Off', '', 'info');
}

// ---------- cockpit (3D) view ----------

// Created the first time it's needed. null when the device has no WebGL,
// in which case the cockpit camera falls back to chase.
let view3d;
function get3D() {
  if (view3d === undefined) {
    try {
      view3d = createView3D($('game3d'));
    } catch (err) {
      console.error(err);
      view3d = null;
    }
    if (!view3d) {
      setSetting('camera', 'chase');
      toast('Cockpit view', 'Not available', "This device can't draw 3D graphics", 'info');
    }
  }
  return view3d;
}

let cockpitShown = false;
function showCockpit(on) {
  if (on === cockpitShown) return;
  cockpitShown = on;
  document.body.classList.toggle('cockpit', on);
}

const CAMERA_NAMES = { chase: 'Chase', cockpit: 'Cockpit', fixed: 'Top-down' };
function toggleCamera() {
  setSetting('camera', CAMERAS[(CAMERAS.indexOf(settings.camera) + 1) % CAMERAS.length]);
  if (settings.camera === 'cockpit' && !get3D()) return;
  track('Camera', { camera: settings.camera });
  if (session) toast('Camera', CAMERA_NAMES[settings.camera], '', 'info');
}

const LINE_NAMES = { full: 'Full', braking: 'Braking only', off: 'Off' };
function cycleLine() {
  const next = LINE_MODES[(LINE_MODES.indexOf(settings.line) + 1) % LINE_MODES.length];
  setSetting('line', next);
  hideHelp();
  if (session) toast('Racing line', LINE_NAMES[next], '', 'info');
}

function onPad(action) {
  if (action === 'pause') {
    if (!$('controls').hidden) closeControls();
    else if (!$('settings').hidden) closeSettings();
    else if (session) togglePause();
    else requestRun();
  } else if (action === 'restart' && session) {
    requestRun();
  } else if (action === 'reset') {
    resetCar();
  } else if (action === 'keep') {
    keepLap();
  }
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return; // typing, not driving
  const settingsOpen = !$('settings').hidden;
  const garageOpen = !$('garage').hidden;
  const controlsOpen = !$('controls').hidden;
  const dialogOpen = settingsOpen || garageOpen || controlsOpen || !$('account').hidden || !$('lobby').hidden;
  if (e.code === 'Escape') {
    if (!$('lobby').hidden && !session) lobby.leave();
    else if (controlsOpen) closeControls();
    else if (settingsOpen) closeSettings();
    else if (garageOpen) closeGarage();
    else if (session) togglePause();
  } else if (e.code === 'KeyP') {
    if (session && !settingsOpen && !controlsOpen) togglePause();
  } else if (e.code === 'KeyR') {
    if (session) requestRun();
  } else if (e.code === 'KeyK') {
    keepLap();
  } else if (e.code === 'KeyG') {
    toggleGhost();
  } else if (e.code === 'KeyT') {
    resetCar();
  } else if (e.code === 'KeyL') {
    cycleLine();
  } else if (e.code === 'KeyC') {
    toggleCamera();
  } else if (e.code === 'KeyM') {
    toggleMute();
  } else if (!session && !dialogOpen) {
    // Menu: arrows pick a circuit, Enter starts.
    const i = tracks.indexOf(selected);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      select(tracks[(i + (e.code === 'ArrowDown' ? 1 : tracks.length - 1)) % tracks.length]);
    } else if (e.code === 'Enter' && !e.target.closest?.('button:not(#startBtn)')) {
      e.preventDefault();
      requestRun();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session) setPaused(true);
});

$('startBtn').addEventListener('click', requestRun);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', requestRun);
$('menuBtn').addEventListener('click', () => openMenu());
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resetBtn').addEventListener('click', resetCar);
// Clicking a HUD button mustn't leave it focused: Space (brake) would then press it.
for (const id of ['pauseBtn', 'resetBtn', 'muteBtn', 'keepLapBtn', 'helpBtn']) {
  $(id).addEventListener('mousedown', (e) => e.preventDefault());
}

function toggleMute() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  syncMute();
  syncSettings();
}
function syncMute() {
  $('muteBtn').classList.toggle('muted', audio.muted);
  $('muteBtn').setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
}
$('muteBtn').addEventListener('click', toggleMute);
syncMute();

// Browsers only allow audio after a user gesture.
addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });

// Touch pedals appear on touch screens, or as soon as someone touches.
const coarse = matchMedia('(pointer: coarse)');
const setTouch = (on) => document.body.classList.toggle('touch', on);
setTouch(coarse.matches);
addEventListener('touchstart', () => setTouch(true), { once: true, passive: true });

// Redraw menu previews when the layout changes size.
let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!session) buildMenu(); }, 150);
});

// A shared ghost link: select its circuit and race it on the next Start.
function offerVersus(ghost) {
  pendingVersus = { track: selected, ghost };
  updateDetail();
  toast('Shared lap', `${ghost.name} · ${formatTime(ghost.time)}`, 'Press Start to race their ghost', 'info');
}

const onlineUI = createOnlineUI({
  tracks,
  selected: () => selected,
  select: (t) => { if (session) openMenu(); select(t); },
  startRun: (opts) => requestRun(opts),
  toast,
  offerVersus,
  // Signed in, out, or bought a colour: repaint and refresh the garage,
  // still offering the colour on offer if it's still locked.
  ownedChanged() {
    colour = colourFor(settings.colour, onlineUI.owned);
    if (!$('garage').hidden) {
      const c = offered;
      renderGarage();
      if (c && !unlocked(c, onlineUI.owned)) offerColour(c);
    }
    offerToBuy();
  },
});

// An online race starting: every screen gets the same circuit and grid.
function startOnline(msg, room, me, host) {
  const t = tracks.find((x) => x.id === msg.track);
  if (t && t !== selected) select(t);
  startRun({ online: { room, me, start: msg, host }, mode: 'online' });
  return session;
}

const lobby = createLobby({
  onlineUI,
  settings,
  colour: () => colour,
  selected: () => selected,
  trackById: (id) => tracks.find((x) => x.id === id),
  startOnline,
  toast,
  openAccount: () => $('accountBtn').click(),
});

// Online racing shows in the menu once online features are working.
onlineUI.ready.then((online) => {
  const b = document.querySelector('.mode[data-mode="online"]');
  if (online) {
    b.disabled = false;
    b.querySelector('small').textContent = 'Up to 4 drivers';
  } else if (settings.mode === 'online') {
    setSetting('mode', 'trial');
  }
});

openMenu();
requestAnimationFrame(frame);
platform.loadingFinished();
window.lateBrakeReady = true;

// Handy for debugging from the console.
window.lateBrake = { get session() { return session; }, tracks, renderer, settings };
