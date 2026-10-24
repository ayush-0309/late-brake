import { TRACKS, buildTrack } from './track.js';
import { DT } from './car.js';
import { Session, COUNTDOWN } from './session.js';
import { createInput } from './input.js';
import { createRenderer, drawTrackPreview } from './render.js';
import { loadTrack, saveTrack, clearTrack, formatTime } from './storage.js';
import { loadSettings, saveSettings, SENSITIVITY, LINE_MODES } from './settings.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const tracks = TRACKS.map(buildTrack);
const settings = loadSettings();
const input = createInput($('touch'), { onPad });
const renderer = createRenderer($('game'), $('minimap'));
const audio = createAudio();

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
    card.addEventListener('dblclick', startRun);
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
}

function updateDetail() {
  const t = selected, saved = loadTrack(t.id);
  $('detailCountry').textContent = t.country;
  $('detailName').textContent = t.name;
  $('detailBlurb').textContent = t.blurb;
  $('detailLength').textContent = `${(t.length / 1000).toFixed(3)} km`;
  $('detailBest').textContent = saved?.best ? formatTime(saved.best.time) : 'No time yet';
  const bs = saved?.bestSectors;
  $('detailSectors').textContent = bs?.every((x) => x != null)
    ? bs.map((x) => formatTime(x).replace(/^0:/, '')).join(' · ')
    : '—';
}

function openMenu() {
  session = null;
  audio.silence();
  paused = false;
  backdrop = new Session(selected, null);
  renderer.setTrack(selected);
  show('menu', true);
  show('pause', false);
  show('help', false);
  show('hud', false);
  show('lights', false);
  hideToast();
  buildMenu();
  $('startBtn').focus({ preventScroll: true });
}

function startRun() {
  audio.unlock();
  audio.resume();
  lastLit = -1;
  stuckTime = 0;
  stuckHinted = false;
  incidents = [];
  helpOffered = false;
  session = new Session(selected, loadTrack(selected.id));
  renderer.setTrack(selected);
  paused = false;
  acc = 0;
  show('menu', false);
  show('pause', false);
  show('settings', false);
  show('help', false);
  show('hud', true);
  hideToast();
  $('trackLabel').textContent = selected.name;
  document.activeElement?.blur?.();
}

function setPaused(p) {
  if (!session) return;
  paused = p;
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
    settings[name] = name === 'ghost' ? value === 'true' : value;
    saveSettings(settings);
  }
  syncSettings();
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
$('resetRecords').addEventListener('click', () => {
  if (!confirm('Delete every best lap and ghost saved in this browser?')) return;
  for (const t of tracks) clearTrack(t.id);
  if (session) session = new Session(selected, null);
  buildMenu();
  toast('Lap records', 'Cleared', '', 'info');
});

// ---------- loop ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  try {
    if (session && !paused) {
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
      if (session.phase === 'running') audio.update(session.car, inp, dt);
      else audio.idle(inp, dt);
      updateHud(inp);
    } else if (!session) {
      input.read(); // keeps gamepad buttons live in the menu
    }

    const view = session || backdrop;
    if (view) {
      renderer.draw(view, session && !paused ? acc / DT : 1, { ghost: settings.ghost, camera: settings.camera, line: settings.line }, dt);
    }
  } catch (err) {
    // One bad frame shouldn't kill the loop; log it and keep going.
    console.error(err);
  }
  requestAnimationFrame(frame);
}

function handleEvents() {
  for (const e of session.events) {
    if (e.type === 'lap') onLap(e);
    if (e.type === 'invalid') { flash('invalidBadge'); audio.beep(220, 0.3, 0.14); }
    if (e.type === 'hit') audio.hit(e.impact);
    if (e.type === 'off' || (e.type === 'hit' && e.impact > 6)) noteIncident();
    if (e.type === 'go') audio.beep(1046, 0.5, 0.2);
    if (e.type === 'reset') toast('Reset', 'Back on track', '', 'info');
  }
  session.events.length = 0;
}

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
  $('helpRestart').textContent = lineOn ? 'Restart lap' : 'Just restart lap';
  $('helpRestart').className = lineOn ? 'primary' : 'secondary';
  paused = true;
  audio.suspend();
  show('help', true);
  (lineOn ? $('helpRestart') : $('helpLine')).focus({ preventScroll: true });
}

function closeHelp() {
  show('help', false);
  paused = false;
  audio.resume();
}

$('helpLine').addEventListener('click', () => {
  setSetting('line', 'full');
  startRun();
  toast('Racing line', 'On', 'Change it any time in Settings or with L', 'info');
});
$('helpRestart').addEventListener('click', () => {
  helpDismissed++;
  startRun();
});
$('helpKeep').addEventListener('click', () => {
  helpDismissed++;
  closeHelp();
});

// Stopped in a gravel trap or against a wall for a couple of seconds:
// point out the reset, once per run.
function watchStuck(dt) {
  const car = session.car;
  const stuck = session.phase === 'running' && car.speed < 3 && (!car.onTrack || car.wall);
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
  toast(`Lap ${e.lap}`, formatTime(e.time), sub, cls);
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
  setText('lapNum', String(s.lap));
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

function toast(title, time, sub, cls) {
  const el = $('toast');
  el.className = 'toast show ' + cls;
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-time">${time}</div>${sub ? `<div class="toast-sub">${sub}</div>` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, cls === 'info' ? 1800 : 3200);
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

function toggleCamera() {
  setSetting('camera', settings.camera === 'chase' ? 'fixed' : 'chase');
  if (session) toast('Camera', settings.camera === 'chase' ? 'Chase' : 'Top-down', '', 'info');
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
    else startRun();
  } else if (action === 'restart' && session) {
    startRun();
  } else if (action === 'reset') {
    resetCar();
  }
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const settingsOpen = !$('settings').hidden;
  const helpOpen = !$('help').hidden;
  if (e.code === 'Escape') {
    if (settingsOpen) closeSettings();
    else if (helpOpen) $('helpKeep').click();
    else if (session) setPaused(!paused);
  } else if (e.code === 'KeyP') {
    if (session && !settingsOpen && !helpOpen) setPaused(!paused);
  } else if (e.code === 'KeyR') {
    if (session) startRun();
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
  } else if (!session && !settingsOpen) {
    // Menu: arrows pick a circuit, Enter starts.
    const i = tracks.indexOf(selected);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      select(tracks[(i + (e.code === 'ArrowDown' ? 1 : tracks.length - 1)) % tracks.length]);
    } else if (e.code === 'Enter' && !e.target.closest?.('button:not(#startBtn)')) {
      e.preventDefault();
      startRun();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && $('help').hidden) setPaused(true);
});

$('startBtn').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', startRun);
$('menuBtn').addEventListener('click', openMenu);
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resetBtn').addEventListener('click', resetCar);

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

openMenu();
requestAnimationFrame(frame);
window.lateBrakeReady = true;

// Handy for debugging from the console.
window.lateBrake = { get session() { return session; }, tracks, renderer, settings };
