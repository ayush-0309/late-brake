import { TRACKS, buildTrack } from './track.js';
import { DT } from './car.js';
import { Session, COUNTDOWN } from './session.js';
import { RaceSession } from './race.js';
import { OnlineRaceSession } from './online-race.js';
import { createLobby } from './lobby-ui.js';
import { createInput } from './input.js';
import { createRenderer, drawTrackPreview } from './render.js';
import { loadTrack, saveTrack, clearTrack, formatTime } from './storage.js';
import { loadSettings, saveSettings, SENSITIVITY, LINE_MODES, CAMERAS } from './settings.js';
import { createAudio } from './audio.js';
import { createView3D } from './view3d.js';
import { createPlatform } from './platform.js';
import { initAnalytics, track, reportError } from './analytics.js';
import { createOnlineUI } from './online-ui.js';

const $ = (id) => document.getElementById(id);
const tracks = TRACKS.map(buildTrack);
const settings = loadSettings();
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

// Keep going off track and the game offers the racing line and a restart.
const HELP_AFTER = 3;        // trips off track (or hard wall hits)...
const HELP_WINDOW = 120;     // ...within this many seconds of driving
const HELP_MAX_DISMISS = 2;  // waved off this often: stop offering
let incidents = [];          // session clock times of recent trips off
let helpOffered = false;     // at most once per run
let helpDismissed = 0;

// ---------- menu ----------

function buildMenu() {
  syncSettings();
  syncMode();
  const list = $('trackList');
  list.innerHTML = '';
  for (const t of tracks) {
    const saved = loadTrack(t.id);
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
      <div class="track-best"><span class="label">Best</span><b>${saved?.best ? formatTime(saved.best.time) : '—'}</b></div>`;
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
  backdrop = new Session(selected, null);
  renderer.setTrack(selected);
  show('menu', true);
  show('pause', false);
  show('help', false);
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
  acc = 0;
  show('menu', false);
  show('pause', false);
  show('settings', false);
  show('help', false);
  show('results', false);
  document.body.classList.toggle('racing', session.mode === 'race');
  show('hud', true);
  hideToast();
  $('trackLabel').textContent = opts.versus ? `vs ${opts.versus.name}` : opts.challenge ? 'Daily challenge' : selected.name;
  document.activeElement?.blur?.();
  platform.gameplayStart();
  track('Run start', { track: selected.name, mode: opts.challenge ? 'challenge' : opts.versus ? 'versus' : mode, camera: settings.camera, line: settings.line });
}

function setPaused(p) {
  if (!session || adPlaying) return;
  paused = p;
  p ? platform.gameplayStop() : platform.gameplayStart();
  show('pause', p);
  if (!p) show('settings', false);
  p ? audio.suspend() : audio.resume();
  if (p) $('resumeBtn').focus({ preventScroll: true });
}

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
  if (session) {
    session.best = null;
    session.bestSectors = [null, null, null];
  }
  buildMenu();
  toast('Lap records', 'Cleared', '', 'info');
});

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
      const opts = { ghost: settings.ghost, camera: cockpit ? 'none' : settings.camera, line: settings.line };
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
    return `<tr class="${r.me ? 'me' : ''}"><td>${r.pos}</td><td><span class="swatch-dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</td><td>${time}</td><td>${formatTime(r.bestLap)}</td></tr>`;
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
  if (incidents.length >= HELP_AFTER && !helpOffered && helpDismissed < HELP_MAX_DISMISS) offerHelp();
}

function offerHelp() {
  helpOffered = true;
  const lineOn = settings.line !== 'off';
  $('helpTitle').textContent = lineOn ? 'Tough lap?' : 'Struggling with the corners?';
  $('helpText').textContent = lineOn
    ? `That's ${incidents.length} trips off track. Restart the lap for a clean run?`
    : `That's ${incidents.length} trips off track. The racing line shows where to brake (red), lift (yellow) and go flat out (green).`;
  $('helpLine').hidden = lineOn;
  $('helpLegend').hidden = lineOn;
  const what = session.mode === 'race' ? 'race' : 'lap';
  $('helpRestart').textContent = lineOn ? `Restart ${what}` : `Just restart ${what}`;
  $('helpRestart').className = lineOn ? 'primary' : 'secondary';
  $('helpRescue').hidden = !(session.canRescue && platform.rewardedAvailable);
  if (session.online) { $('helpRestart').hidden = true; $('helpLine').hidden = true; $('helpLegend').hidden = true; } else $('helpRestart').hidden = false;
  paused = true;
  audio.suspend();
  platform.gameplayStop();
  track('Help offered', { track: selected.name, line: settings.line });
  show('help', true);
  (lineOn ? $('helpRestart') : $('helpLine')).focus({ preventScroll: true });
}

function closeHelp() {
  show('help', false);
  paused = false;
  audio.resume();
  platform.gameplayStart();
}

$('helpLine').addEventListener('click', async () => {
  track('Help choice', { choice: 'line' });
  setSetting('line', 'full');
  await requestRun();
  toast('Racing line', 'On', 'Change it any time in Settings or with L', 'info');
});
$('helpRestart').addEventListener('click', () => {
  track('Help choice', { choice: 'restart' });
  helpDismissed++;
  requestRun();
});
$('helpRescue').addEventListener('click', () => {
  track('Help choice', { choice: 'rescue' });
  closeHelp();
  keepLap();
});
$('helpKeep').addEventListener('click', () => {
  track('Help choice', { choice: 'keep driving' });
  helpDismissed++;
  closeHelp();
});

// ---------- lap rescue ----------

// Watch a rewarded ad to keep a lap that went over the track limits. Once
// per lap, and the lap then counts as a personal best only.
async function keepLap() {
  if (!session?.canRescue || !platform.rewardedAvailable || adPlaying) return;
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
  toast(`Lap ${e.lap}`, formatTime(e.time), sub, cls);
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
    return `<li class="${r.me ? 'me' : ''}"><span class="p">${i + 1}</span><span class="c" style="background:${esc(r.color)}"></span><span class="n">${esc(r.name)}</span><span class="g">${gap}</span></li>`;
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
  if (session) toast('Racing line', LINE_NAMES[next], '', 'info');
}

function onPad(action) {
  if (action === 'pause') {
    if (!$('settings').hidden) closeSettings();
    else if (!$('help').hidden) $('helpKeep').click();
    else if (session) setPaused(!paused);
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
  const helpOpen = !$('help').hidden;
  const dialogOpen = settingsOpen || !$('account').hidden || !$('lobby').hidden;
  if (e.code === 'Escape') {
    if (!$('lobby').hidden && !session) lobby.leave();
    else if (settingsOpen) closeSettings();
    else if (helpOpen) $('helpKeep').click();
    else if (session) setPaused(!paused);
  } else if (e.code === 'KeyP') {
    if (session && !settingsOpen && !helpOpen) setPaused(!paused);
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
  if (document.hidden && session && $('help').hidden) setPaused(true);
});

$('startBtn').addEventListener('click', requestRun);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', requestRun);
$('menuBtn').addEventListener('click', () => openMenu());
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resetBtn').addEventListener('click', resetCar);
// Clicking a HUD button mustn't leave it focused: Space (brake) would then press it.
for (const id of ['pauseBtn', 'resetBtn', 'muteBtn', 'keepLapBtn']) {
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
