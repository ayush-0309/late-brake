import { TRACKS, buildTrack } from './track.js';
import { DT } from './car.js';
import { Session, COUNTDOWN } from './session.js';
import { createInput } from './input.js';
import { createRenderer, drawTrackPreview } from './render.js';
import { loadTrack, saveTrack, formatTime } from './storage.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const tracks = TRACKS.map(buildTrack);
const input = createInput($('touch'));
const renderer = createRenderer($('game'), $('minimap'));
const audio = createAudio();

let selected = tracks[0];
let session = null;       // the live run, null while in the menu
let backdrop = null;      // parked car drawn behind the menu
let paused = false;
let showGhost = true;
let acc = 0;
let last = performance.now();
let toastTimer = 0;
let lastLit = -1;

// ---------- menu ----------

function buildMenu() {
  const list = $('trackList');
  list.innerHTML = '';
  for (const t of tracks) {
    const saved = loadTrack(t.id);
    const card = document.createElement('button');
    card.className = 'track-card' + (t === selected ? ' selected' : '');
    card.innerHTML = `
      <canvas></canvas>
      <div class="track-info">
        <div class="track-name">${t.name}</div>
        <div class="track-blurb">${t.blurb}</div>
        <div class="track-meta">
          <span>${t.country} · ${(t.length / 1000).toFixed(2)} km</span>
          <span>Best <b>${saved?.best ? formatTime(saved.best.time) : '—'}</b></span>
        </div>
      </div>`;
    card.addEventListener('click', () => {
      selected = t;
      backdrop = new Session(t, null);
      renderer.setTrack(t);
      buildMenu();
    });
    list.appendChild(card);
  }
  // Draw previews once the cards have been laid out.
  requestAnimationFrame(() => {
    list.querySelectorAll('canvas').forEach((c, i) => drawTrackPreview(c, tracks[i]));
  });
}

function openMenu() {
  session = null;
  audio.silence();
  paused = false;
  backdrop = new Session(selected, null);
  renderer.setTrack(selected);
  buildMenu();
  show('menu', true);
  show('pause', false);
  show('hud', false);
  show('lights', false);
  hideToast();
}

function startRun() {
  audio.unlock();
  audio.resume();
  lastLit = -1;
  session = new Session(selected, loadTrack(selected.id));
  renderer.setTrack(selected);
  paused = false;
  acc = 0;
  show('menu', false);
  show('pause', false);
  show('hud', true);
  hideToast();
  $('trackLabel').textContent = selected.name;
}

function setPaused(p) {
  if (!session) return;
  paused = p;
  show('pause', p);
  p ? audio.suspend() : audio.resume();
}

// ---------- loop ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (session && !paused) {
    acc += dt;
    const inp = input.read();
    let steps = 0;
    while (acc >= DT && steps < 6) {
      session.step(inp);
      if (session.phase === 'running') renderer.addSkid(session.car);
      acc -= DT;
      steps++;
    }
    if (steps === 6) acc = 0;
    handleEvents();
    if (session.phase === 'running') audio.update(session.car, inp, dt);
    else audio.idle(inp, dt);
  }

  const view = session || backdrop;
  if (view) renderer.draw(view, session && !paused ? acc / DT : 1, { ghost: showGhost }, dt);
  if (session) updateHud();
  requestAnimationFrame(frame);
}

function handleEvents() {
  for (const e of session.events) {
    if (e.type === 'lap') onLap(e);
    if (e.type === 'invalid') { flash('invalidBadge'); audio.beep(220, 0.3, 0.14); }
    if (e.type === 'hit') audio.hit(e.impact);
    if (e.type === 'go') audio.beep(1046, 0.5, 0.2);
  }
  session.events.length = 0;
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

function updateHud() {
  const s = session;
  setText('lapNum', String(s.lap));
  setText('lapTime', formatTime(s.lapTime));
  setText('speedVal', String(Math.round(s.car.speed * 3.6)));
  setText('gearVal', s.phase === 'running' ? (s.car.vf < -0.5 ? 'R' : String(audio.gear)) : 'N');
  setText('bestTime', formatTime(s.best?.time));
  setText('lastTime', formatTime(s.laps.at(-1)?.time));

  const d = s.phase === 'running' && s.valid ? s.delta() : null;
  setText('delta', d === null ? '' : formatTime(d, true));
  setClass('delta', 'delta ' + (d === null ? '' : d <= 0 ? 'ahead' : 'behind'));
  setClass('invalidBadge', 'badge' + (s.phase === 'running' && !s.valid ? ' on' : ''));

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
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-time">${time}</div><div class="toast-sub">${sub}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3200);
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

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (session) setPaused(!paused);
  } else if (e.code === 'KeyR') {
    if (session) startRun();
  } else if (e.code === 'KeyG') {
    showGhost = !showGhost;
    $('ghostToggle').textContent = `Ghost: ${showGhost ? 'on' : 'off'}`;
  } else if (e.code === 'KeyM') {
    toggleMute();
  } else if (e.code === 'Enter' && !session) {
    startRun();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session) setPaused(true);
});

$('startBtn').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', startRun);
$('menuBtn').addEventListener('click', openMenu);
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('ghostToggle').addEventListener('click', () => {
  showGhost = !showGhost;
  $('ghostToggle').textContent = `Ghost: ${showGhost ? 'on' : 'off'}`;
});

function toggleMute() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  syncMute();
}
function syncMute() {
  $('muteBtn').classList.toggle('muted', audio.muted);
  $('muteBtn').setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
  $('soundToggle').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`;
}
$('muteBtn').addEventListener('click', toggleMute);
$('soundToggle').addEventListener('click', toggleMute);
syncMute();

// Browsers only allow audio after a user gesture.
addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });

// Touch pedals appear on touch screens, or as soon as someone touches.
const coarse = matchMedia('(pointer: coarse)');
const setTouch = (on) => document.body.classList.toggle('touch', on);
setTouch(coarse.matches);
addEventListener('touchstart', () => setTouch(true), { once: true, passive: true });

openMenu();
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.lateBrake = { get session() { return session; }, tracks, renderer };
