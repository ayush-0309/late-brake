// The daily challenge promo, made from the game itself like the trailer
// (trailer.js): real sessions driven by the AI, drawn by the game's own
// renderers one frame at a time, with titles and the game's readouts on top,
// encoded to MP4 in the browser. The music is a licensed track (Mixkit's
// "Games Music", free licence, no credit needed) kept out of git in
// launch/trailer/music/; the cut follows its beats. No engine sound.
//
// Run the dev server and `node tools/trailer/save.mjs`, put the track in
// launch/trailer/music/games-music.mp3, open
// http://localhost:5173/tools/trailer/promo.html and press Record.
// ?shape=vertical makes it 1080 × 1920 for phones.

import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';
import { TRACKS, buildTrack } from '../../src/track.js';
import { buildLine } from '../../src/line.js';
import { Session, COUNTDOWN } from '../../src/session.js';
import { RaceSession } from '../../src/race.js';
import { createDriver } from '../../src/ai.js';
import { createRenderer } from '../../src/render.js';
import { createView3D } from '../../src/view3d.js';
import { DT } from '../../src/car.js';
import { GOALS, duelGhost } from '../../src/challenge.js';
import { formatTime } from '../../src/storage.js';

const VERTICAL = new URLSearchParams(location.search).get('shape') === 'vertical';
const [W, H] = VERTICAL ? [1080, 1920] : [1920, 1080];
const FPS = 60, RATE = 48000;
const NAME = `late-brake-daily-challenge${VERTICAL ? '-vertical' : ''}.mp4`;
const RED = '#e8112d', TEXT = '#f3f4f6', MUTED = '#c3c8d0', GREEN = '#34d27b', HOT = '#ff6a13';
const MEDAL = ['#e3a874', '#dfe4ea', '#f2c94c'];
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

// The track, cut to 30 seconds: its peak (bars 40 to 47), then on a bar line
// straight into the breakdown, the build, the final hit and its own ending
// (bars 56 to 64). `from` is where each part starts in the track (seconds,
// on its beat grid: 137.93 bpm, first beat at 0.23 s).
const MUSIC = {
  url: '../../launch/trailer/music/games-music.mp3',
  bpm: 137.93,
  parts: [{ from: 69.828, beats: 32 }, { from: 97.667, beats: 38 }],
};
const BEAT = 60 / MUSIC.bpm;
// Sections of the cut, in beats: a flash on the section hits, a zoom punch
// on each beat while the music drives, none in the breakdown. The final hit
// (beat 60) is the Hot Streak reveal's own flash.
const DRIVING = [[0, 32], [44, 64]];
const FLASHES = [0, 8, 16, 24, 32, 44, 52];

// The shots, in beats (70 in all). `goal` is a goal's id (GOALS in
// src/challenge.js), numbered on screen in the order the video shows them.
const ORDER = ['back', 'duel', 'sprint', 'clean'];
const SHOTS = [
  { kind: 'hook', track: 'mc-1929', camera: 'cockpit', beats: 8, at: { stop: 1, lead: 2.4 } },
  { kind: 'back', track: 'br-1940', camera: 'chase', beats: 8, zoom: 2.1, into: 2, goal: 'back', sub: 'Start last of six. Win the race.' },
  { kind: 'duel', track: 'gb-1948', camera: 'chase', beats: 8, zoom: 1.6, from: 24, goal: 'duel', sub: 'One lap against a gold-pace ghost.' },
  { kind: 'sprint', track: 'be-1925', camera: 'chase', beats: 8, zoom: 2, goal: 'sprint', sub: 'Lights to sector 1. Again. And again.' },
  { kind: 'clean', track: 'it-1922', camera: 'chase', beats: 4, zoom: 2, lap: 1, goal: 'clean', sub: "One off and it's back to zero." },
  { kind: 'clean', track: 'it-1922', camera: 'chase', beats: 4, zoom: 2, lap: 2, goal: 'clean', sub: "One off and it's back to zero." },
  { kind: 'clean', track: 'it-1922', camera: 'chase', beats: 4, zoom: 2, off: true, goal: 'clean', sub: "One off and it's back to zero." },
  { kind: 'medals', track: 'be-1925', camera: 'chase', beats: 8, at: { stop: 0, lead: 2.2 } },
  { kind: 'streak', track: 'gb-1948', camera: 'chase', beats: 8, zoom: 2.2, crop: 0.8, at: { stop: 1, lead: 2.6 }, paint: HOT },
  { kind: 'reveal', track: 'mc-1929', camera: 'chase', beats: 4, zoom: 2.8, crop: 0.82, at: { stop: 2, lead: 1.6 }, paint: HOT },
  { kind: 'end', track: 'mc-1929', camera: 'fixed', beats: 6, zoom: 1, at: { stop: 1, lead: 3 } },
];
const ZOOM = { chase: 1.7, fixed: 1.5 };

const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; window.trailerStatus = s; };
const out = $('out');
out.width = W;
out.height = H;
Object.assign(out.style, { aspectRatio: `${W} / ${H}`, width: VERTICAL ? 'min(420px, 100vw)' : 'min(960px, 100vw)' });
const octx = out.getContext('2d');
const tracks = new Map();
const trackById = (id) => {
  if (!tracks.has(id)) tracks.set(id, buildTrack(TRACKS.find((d) => d.id === id)));
  return tracks.get(id);
};
let renderer, view3d;

// The game's canvases, the top-down one `zoom` times bigger than the frame so
// a frame-sized crop of it is that much closer and still sharp.
function sizeCanvases(zoom = 1) {
  const dpr2 = Math.min(devicePixelRatio || 1, 2), dpr3 = Math.min(devicePixelRatio || 1, 1.75);
  const style = $('game').style, w = `${(W * zoom) / dpr2}px`;
  if (style.width !== w) {
    Object.assign(style, { width: w, height: `${(H * zoom) / dpr2}px` });
    dispatchEvent(new Event('resize'));
  }
  Object.assign($('game3d').style, { width: `${W / dpr3}px`, height: `${H / dpr3}px` });
}

// ---------- shots ----------

// The circuit's braking zones, biggest stop first: where each starts (metres
// round the lap) and the speed coming into it.
function stops(t) {
  const L = t.line ||= buildLine(t);
  const list = [];
  for (let j = 0; j < L.n; j++) {
    if (L.zone[j] !== 2 || L.zone[(j - 1 + L.n) % L.n] === 2) continue;
    let low = L.v[j];
    for (let k = j; L.zone[k % L.n] === 2 && k < j + L.n; k++) low = Math.min(low, L.v[k % L.n]);
    list.push({ s: L.ci[j] * t.step, v: L.v[j], lost: L.v[j] - low });
  }
  return list.sort((a, b) => b.lost - a.lost);
}

// One physics tick with the AI driving. `steer` nudges it (the clean-laps
// shot sends it off). Remembers the shot's events the overlays need.
function tick(sh) {
  const s = sh.session;
  let inp = { throttle: 0, brake: 0, steer: 0, sens: 1 };
  if (s.phase === 'running') {
    const others = s.opponents ? s.opponents.map((r) => ({ car: r.car, lat: r.car.lat ?? 0 })) : [];
    inp = { ...sh.driver.control(s.car, others, DT), sens: 1 };
    if (inp.reset) s.resetToTrack();
    if (sh.steer) inp.steer = Math.max(-1, Math.min(1, inp.steer + sh.steer));
  }
  s.step(inp);
  if (s.phase === 'running') renderer.addSkid(s.car);
  sh.ticks = (sh.ticks || 0) + 1;
  for (const e of s.events) {
    if (e.type === 'lap') sh.laps = (sh.laps || 0) + 1, sh.lapTick = sh.ticks;
    if (e.type === 'invalid') sh.offTick = sh.ticks;
  }
  s.events.length = 0;
}

const beatTicks = (beats) => Math.round((beats * BEAT) / DT);

// Runs `make()`'s shot until `until(sh)` gives a tick, then again (the
// physics being deterministic, the same) to `lead` beats before it.
function rerun(make, until, lead) {
  const probe = make();
  for (let k = 0; k < 60 * 900; k++) {
    tick(probe);
    const at = until(probe);
    if (at) {
      const sh = make();
      while (sh.ticks < at - beatTicks(lead)) tick(sh);
      return sh;
    }
  }
  throw new Error('Shot never reached its moment');
}

// Sets a shot up and runs it on to where it starts.
function prepare(shot) {
  const t = trackById(shot.track);
  const line = t.line ||= buildLine(t);
  sizeCanvases(shot.camera === 'cockpit' ? 1 : shot.zoom ?? ZOOM[shot.camera]);
  renderer.setTrack(t);
  const solo = (skill, opts) => () => ({ shot, session: new Session(t, null, opts), driver: createDriver(t, line, skill), ticks: 0 });
  let sh;
  if (shot.kind === 'back') {
    // A race from the back of the grid; the shot has the pass into P`into`
    // half way through.
    const make = () => ({ shot, session: new RaceSession(t, null, { opponents: 5, laps: 2, difficulty: 'easy', name: 'You' }), driver: createDriver(t, line, 0.985), ticks: 0 });
    sh = rerun(make, (p) => p.session.phase === 'running' && p.session.position <= shot.into && p.ticks, shot.beats / 2);
  } else if (shot.kind === 'duel') {
    sh = solo(0.975, { versus: duelGhost(t) })();
    while (sh.session.phase !== 'running' || sh.session.lapTime < shot.from) tick(sh);
  } else if (shot.kind === 'sprint') {
    // From the grid, so GO falls on the shot's fifth beat.
    sh = solo(0.97)();
    while (sh.ticks < Math.round(COUNTDOWN / DT) - beatTicks(4)) tick(sh);
  } else if (shot.kind === 'clean' && !shot.off) {
    // Lap `lap` ends half way through the shot.
    sh = rerun(solo(0.985), (p) => p.laps === shot.lap && p.lapTick, shot.beats / 2);
  } else {
    sh = solo(shot.kind === 'clean' ? 0.985 : 0.97)();
    // A flying lap (the third, for the clean laps' trip off), a little
    // before the chosen stop.
    const list = stops(t);
    const stop = list[(shot.at?.stop ?? 1) % list.length];
    const target = (stop.s - stop.v * 0.85 * (shot.at?.lead ?? 2) + t.length * 2) % t.length;
    const lap = shot.off ? 2 : 1;
    const s = sh.session;
    for (let k = 0; k < 60 * 900; k++) {
      tick(sh);
      if (s.phase === 'running' && s.laps.length >= lap && (s.car.s - target + t.length) % t.length < 30) break;
    }
  }
  sh.shot = shot;
  sh.startTicks = sh.ticks;
  sh.laps = 0;
  sh.lapTick = null;
  sh.offTick = null;
  sh.pos = sh.session.position;
  renderer.setTrack(t); // drops a probe's skid marks
  return sh;
}

// ---------- drawing ----------

const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const font = (size, weight = 800, italic = true) => `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
const M = VERTICAL ? 80 : 110;          // side margin
const TOP = VERTICAL ? 300 : 130;       // where the goal's name starts, clear of a phone app's top bar

// Sets the font, smaller if need be so `text` fits in `max` pixels.
function fitFont(text, size, max, weight = 800, italic = true) {
  octx.font = font(size, weight, italic);
  const w = octx.measureText(text).width + (parseFloat(octx.letterSpacing) || 0) * text.length;
  if (w > max) octx.font = font(Math.floor((size * max) / w), weight, italic);
}

// Text that lands on a beat: in from a little bigger and see-through, with a
// short smear behind it.
function slam(text, x, y, size, since, { color = TEXT, align = 'left', max = W - 2 * M, spacing = 1 } = {}) {
  if (since < 0) return;
  const k = ease(since / 0.16);
  octx.save();
  octx.textAlign = align;
  octx.letterSpacing = `${spacing}px`;
  fitFont(text, size, max);
  octx.shadowColor = 'rgba(0,0,0,0.55)';
  octx.shadowBlur = 24;
  for (let i = 2; i >= 0; i--) {
    const sc = 1 + (1 - k) * (0.35 + i * 0.12);
    octx.globalAlpha = i ? k * 0.18 : Math.min(1, k * 1.4);
    octx.setTransform(sc, 0, 0, sc, x * (1 - sc), y * (1 - sc));
    octx.fillStyle = color;
    octx.fillText(text, x, y);
  }
  octx.restore();
}

function small(text, x, y, size, color, { align = 'left', spacing = 6, alpha = 1, weight = 700 } = {}) {
  octx.save();
  octx.globalAlpha = alpha;
  octx.textAlign = align;
  octx.letterSpacing = `${spacing}px`;
  fitFont(text, size, W - 2 * M, weight, false);
  octx.fillStyle = color;
  octx.shadowColor = 'rgba(0,0,0,0.6)';
  octx.shadowBlur = 14;
  octx.fillText(text, x, y);
  octx.restore();
}

// A dark wash behind text at the top (or bottom) of the frame.
function wash(fromY, toY, alpha = 0.6) {
  const g = octx.createLinearGradient(0, fromY, 0, toY);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  octx.fillStyle = g;
  octx.fillRect(0, Math.min(fromY, toY), W, Math.abs(toY - fromY));
}

function panel(x, y, w, h, edge = 'rgba(255,255,255,0.14)') {
  octx.fillStyle = 'rgba(11,13,17,0.82)';
  octx.strokeStyle = edge;
  octx.lineWidth = 3;
  octx.beginPath();
  octx.roundRect(x, y, w, h, 22);
  octx.fill();
  octx.stroke();
}

// The goal's number, name and what it asks, top left.
function goalLabel(shot, t) {
  wash(0, TOP + 330, 0.65);
  const k = ease(t / 0.25);
  octx.save();
  octx.fillStyle = RED;
  octx.fillRect(M - 34, TOP - 40, 10, 40 + 110 * k);
  octx.restore();
  small(`GOAL ${ORDER.indexOf(shot.goal) + 1} OF ${ORDER.length}`, M, TOP, 40, RED, { alpha: k });
  slam(GOALS.find((g) => g.id === shot.goal).name.toUpperCase(), M, TOP + 104, 112, t - 0.04);
  small(shot.sub.toUpperCase(), M, TOP + 160, 36, MUTED, { spacing: 3, alpha: ease((t - 0.25) / 0.3) });
}

// A readout like the game's, under the goal's name: a label and a value.
function readout(label, value, t, { color = TEXT, edge, pulse = 0 } = {}) {
  const k = ease(t / 0.3);
  const x = M, y = TOP + 210, w = 400, h = 150;
  octx.save();
  octx.globalAlpha = k;
  const sc = 1 + 0.12 * Math.max(0, 1 - pulse / 0.3);
  octx.translate(x, y);
  octx.scale(sc, sc);
  panel(0, 0, w, h, edge);
  octx.letterSpacing = '5px';
  octx.font = font(30, 700, false);
  octx.fillStyle = MUTED;
  octx.fillText(label, 30, 48);
  octx.letterSpacing = '1px';
  octx.font = font(78);
  octx.fillStyle = color;
  octx.fillText(value, 30, 124);
  octx.restore();
}

// The start lights, lit on beats 1 to 3, out for GO on beat 4.
function lights(beat) {
  const cx = VERTICAL ? W / 2 : W * 0.72, cy = VERTICAL ? 760 : H * 0.3;
  if (beat >= 5.4) return;
  octx.save();
  if (beat < 4) {
    const lit = Math.max(0, Math.min(3, Math.floor(beat)));
    const r = 42, gap = 30, pw = 6 * r + 2 * gap + 70, ph = 2 * r + 50;
    panel(cx - pw / 2, cy - ph / 2, pw, ph, '#2a2a2e');
    for (let i = 0; i < 3; i++) {
      octx.beginPath();
      octx.arc(cx + (i - 1) * (2 * r + gap), cy, r, 0, Math.PI * 2);
      octx.fillStyle = i < lit ? '#ff2a2a' : '#2a0d0d';
      octx.shadowColor = '#ff2a2a';
      octx.shadowBlur = i < lit ? 50 : 0;
      octx.fill();
    }
  } else {
    slam('GO', cx, cy + 60, 190, (beat - 4) * BEAT, { color: GREEN, align: 'center' });
  }
  octx.restore();
}

// Three clean laps: a dot for each, ticked once done; red when it's back to zero.
function cleanCount(n, t, failed) {
  const x = M, y = TOP + 210;
  octx.save();
  octx.globalAlpha = ease(t / 0.3);
  panel(x, y, 470, 150, failed ? RED : 'rgba(255,255,255,0.14)');
  octx.letterSpacing = '5px';
  octx.font = font(30, 700, false);
  octx.fillStyle = failed ? RED : MUTED;
  octx.fillText(failed ? 'OFF · BACK TO ZERO' : 'CLEAN LAPS', x + 30, y + 48);
  for (let i = 0; i < 3; i++) {
    const cx = x + 70 + i * 110, cy = y + 100;
    octx.beginPath();
    octx.arc(cx, cy, 30, 0, Math.PI * 2);
    octx.fillStyle = i < n ? GREEN : 'rgba(255,255,255,0.08)';
    octx.fill();
    if (i < n) {
      octx.strokeStyle = '#07210f';
      octx.lineWidth = 8;
      octx.beginPath();
      octx.moveTo(cx - 13, cy + 1);
      octx.lineTo(cx - 3, cy + 11);
      octx.lineTo(cx + 15, cy - 10);
      octx.stroke();
    }
  }
  octx.letterSpacing = '1px';
  octx.font = font(64);
  octx.fillStyle = failed ? RED : TEXT;
  octx.fillText(`${n}/3`, x + 360, y + 122);
  octx.restore();
}

function medalDisc(cx, cy, r, colour, k) {
  octx.save();
  octx.globalAlpha = k;
  octx.translate(cx, cy);
  octx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
  const g = octx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, colour);
  g.addColorStop(1, '#3a2a10');
  octx.beginPath();
  octx.arc(0, 0, r, 0, Math.PI * 2);
  octx.fillStyle = g;
  octx.shadowColor = colour;
  octx.shadowBlur = 40;
  octx.fill();
  octx.lineWidth = 8;
  octx.strokeStyle = 'rgba(255,255,255,0.4)';
  octx.stroke();
  octx.restore();
}

// A small flame, drawn (no emoji font in a headless browser).
function flame(cx, cy, s, k) {
  octx.save();
  octx.translate(cx, cy);
  octx.scale(s * (0.9 + 0.1 * k), s * (0.9 + 0.1 * k));
  const g = octx.createLinearGradient(0, 60, 0, -70);
  g.addColorStop(0, '#ffd23a');
  g.addColorStop(0.5, HOT);
  g.addColorStop(1, RED);
  octx.fillStyle = g;
  octx.shadowColor = HOT;
  octx.shadowBlur = 50;
  octx.beginPath();
  octx.moveTo(0, 60);
  octx.bezierCurveTo(-55, 55, -60, 0, -30, -30);
  octx.bezierCurveTo(-25, -5, -10, 0, -8, -10);
  octx.bezierCurveTo(-12, -40, 5, -60, 10, -75);
  octx.bezierCurveTo(30, -40, 60, -15, 50, 20);
  octx.bezierCurveTo(45, 50, 25, 60, 0, 60);
  octx.fill();
  octx.restore();
}

function flash(alpha) {
  if (alpha <= 0) return;
  octx.fillStyle = `rgba(255,255,255,${alpha})`;
  octx.fillRect(0, 0, W, H);
}

// The game's picture for a shot, with a zoom punch `punch` (1 = none).
function drawGame(sh, punch) {
  const { shot } = sh;
  const s = sh.session;
  const cockpit = shot.camera === 'cockpit' && view3d;
  const opts = { ghost: shot.kind === 'duel', camera: cockpit ? 'none' : shot.camera, line: 'off', lineColours: 'standard', paint: shot.paint || RED };
  renderer.draw(s, 1, opts, 1 / FPS);
  let src = $('game'), cw = src.width, ch = src.height, cx = cw / 2, cy;
  if (cockpit) {
    view3d.draw(s, 1, opts);
    src = $('game3d');
    cw = src.width; ch = src.height; cx = cw / 2; cy = ch / 2;
    const w = cw / punch, h = ch / punch;
    octx.drawImage(src, cx - w / 2, cy - h / 2, w, h, 0, 0, W, H);
    return;
  }
  // The middle of the bigger picture, the car where the camera puts it: low
  // on screen for chase (`crop` frames it higher), in the middle for fixed.
  const z = Math.min(cw / W, 1);
  const w = (W * z) / punch, h = (H * z) / punch;
  cy = (shot.crop ?? (shot.camera === 'chase' ? 0.63 : 0.5)) * (ch - H * z) + (H * z) / 2;
  octx.drawImage(src, cx - w / 2, cy - h / 2, w, h, 0, 0, W, H);
}

function vignette() {
  const g = octx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  octx.fillStyle = g;
  octx.fillRect(0, 0, W, H);
}

// Where the ghost was at this point of the lap, against the car: + behind.
function ghostGap(sh) {
  const s = sh.session, g = s.versus.ghost, n = g.pts.length / 3;
  let best = Infinity, at = sh.ghostAt || 0;
  for (let i = Math.max(0, at - 40); i < Math.min(n, at + 80); i++) {
    const d = (g.pts[i * 3] - s.car.x) ** 2 + (g.pts[i * 3 + 1] - s.car.y) ** 2;
    if (d < best) { best = d; at = i; }
  }
  sh.ghostAt = at;
  return s.lapTime - (g.t0 + at * g.every);
}

// The frame for a shot `t` seconds in, `vb` beats into the video.
function drawShot(sh, t, vb) {
  const { shot } = sh;
  const b = t / BEAT; // beats into the shot
  const driving = DRIVING.some(([a, z]) => vb >= a && vb < z);
  const punch = driving ? 1 + 0.035 * Math.exp(-((vb % 1) * BEAT) / 0.11) : 1;
  drawGame(sh, punch);
  vignette();
  const s = sh.session;
  const since = (tick) => (sh.ticks - tick) * DT;
  switch (shot.kind) {
    case 'hook': {
      const y0 = VERTICAL ? 620 : 330, gap = VERTICAL ? 190 : 175;
      wash(0, y0 + gap * 2 + 120, 0.55);
      small('NEW IN LATE BRAKE', M, y0 - 150, 44, RED, { alpha: ease(t / 0.2) });
      slam('A NEW', M, y0, 170, t);
      slam('CHALLENGE', M, y0 + gap, 210, t - 2 * BEAT, { color: TEXT });
      slam('EVERY DAY', M, y0 + gap * 2, 210, t - 4 * BEAT, { color: RED });
      break;
    }
    case 'back': {
      goalLabel(shot, t);
      const pos = s.position;
      if (pos !== sh.pos) { sh.pos = pos; sh.posAt = t; }
      const pulse = sh.posAt === undefined ? 1 : t - sh.posAt;
      readout('POSITION', `P${pos} / 6`, t, { color: pulse < 0.6 ? GREEN : TEXT, edge: pulse < 0.6 ? GREEN : undefined, pulse });
      break;
    }
    case 'duel': {
      goalLabel(shot, t);
      const gap = ghostGap(sh);
      readout('GHOST', `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(3)}`, t, { color: gap > 0 ? '#ff6b6b' : GREEN });
      break;
    }
    case 'sprint':
      goalLabel(shot, t);
      readout('SPRINT TO S1', formatTime(s.phase === 'running' ? s.lapTime : 0), t);
      lights(b);
      break;
    case 'clean': {
      goalLabel(shot, shot.lap === 1 ? t : 1); // in on the first of its three shots, then held
      const done = shot.off ? 2 : shot.lap - (sh.lapTick ? 0 : 1);
      const failed = sh.offTick !== null && shot.off;
      cleanCount(failed ? 0 : done, 1, failed);
      if (sh.lapTick && since(sh.lapTick) < 0.12) flash(0.25 * (1 - since(sh.lapTick) / 0.12));
      if (failed) {
        if (since(sh.offTick) < 0.18) flash(0.3 * (1 - since(sh.offTick) / 0.18));
        slam('BACK TO ZERO', W / 2, VERTICAL ? H * 0.47 : H * 0.62, 170, since(sh.offTick), { color: RED, align: 'center' });
      }
      break;
    }
    case 'medals': {
      const y = VERTICAL ? 520 : 300;
      wash(0, y + 120, 0.55);
      slam('WIN A MEDAL', M, y - 90, 130, t);
      slam('EVERY DAY', M, y + 40, 130, t - 0.5 * BEAT, { color: RED });
      const cy = VERTICAL ? H * 0.5 : H * 0.62, gap = VERTICAL ? 300 : 340, r = VERTICAL ? 110 : 120;
      ['BRONZE', 'SILVER', 'GOLD'].forEach((name, i) => {
        const k = ease((t - (2 + i * 2) * BEAT) / 0.22);
        const cx = W / 2 + (i - 1) * gap;
        medalDisc(cx, cy, r, MEDAL[i], k);
        if (k > 0) small(name, cx, cy + r + 70, 44, MEDAL[i], { align: 'center', alpha: k });
      });
      break;
    }
    case 'streak': {
      const y = VERTICAL ? 520 : 300;
      wash(0, y + 120, 0.55);
      slam('KEEP THE', M, y - 90, 130, t);
      slam('STREAK', M, y + 40, 130, t - 0.5 * BEAT, { color: HOT });
      // The count climbs faster as the music builds: 1 to 7.
      const at = [0, 2, 4, 5, 6, 6.5, 7];
      const n = at.filter((x) => b >= x).length;
      const last = at[n - 1] * BEAT;
      const cx = VERTICAL ? W / 2 : W * 0.72, cy = VERTICAL ? H * 0.52 : H * 0.6;
      flame(cx, cy - 20, VERTICAL ? 3.4 : 3, ease((t - last) / 0.15));
      slam(String(n), cx, cy + 70, 230, t - last, { align: 'center' });
      small(n === 1 ? 'DAY' : 'DAYS IN A ROW', cx, cy + 190, 46, TEXT, { align: 'center' });
      break;
    }
    case 'reveal': {
      flash(Math.max(0, 0.85 * (1 - t / 0.25)));
      const y = VERTICAL ? 620 : 360;
      wash(0, y + 260, 0.6);
      small('7 DAYS IN A ROW WINS', M, y - 195, 44, TEXT, { alpha: ease(t / 0.2) });
      slam('HOT STREAK', M, y, 230, t, { color: HOT });
      small("A CAR COLOUR YOU CAN'T BUY", M, y + 80, 44, MUTED, { alpha: ease((t - 0.4) / 0.3) });
      break;
    }
    case 'end':
      endCard(t);
      break;
  }
  // A white flash on the section hits, a bigger one on the final hit.
  for (const f of FLASHES) if (vb >= f && vb < f + 0.4) flash(0.35 * (1 - (vb - f) / 0.4));
}

function endCard(t) {
  octx.fillStyle = `rgba(7,8,10,${0.6 + 0.25 * ease(t / 0.5)})`;
  octx.fillRect(0, 0, W, H);
  const k = ease(t / 0.4);
  const y = H / 2 - (VERTICAL ? 120 : 60) + (1 - k) * 30;
  octx.save();
  octx.globalAlpha = k;
  octx.letterSpacing = '2px';
  fitFont('LATEBRAKE', 250, W * 0.88);
  const late = octx.measureText('LATE').width, brake = octx.measureText('BRAKE').width;
  const x = W / 2 - (late + brake) / 2;
  octx.shadowColor = 'rgba(0,0,0,0.6)';
  octx.shadowBlur = 30;
  octx.fillStyle = TEXT;
  octx.fillText('LATE', x, y);
  octx.fillStyle = RED;
  octx.fillText('BRAKE', x + late, y);
  octx.restore();
  small('A NEW CHALLENGE EVERY DAY', W / 2, y + 100, 56, TEXT, { align: 'center', spacing: 8, alpha: ease((t - 0.3) / 0.4) });
  const k3 = ease((t - 0.6) / 0.4);
  octx.save();
  octx.globalAlpha = k3;
  octx.textAlign = 'center';
  octx.letterSpacing = '4px';
  octx.font = font(70);
  const url = 'PLAY FREE  ·  LATEBRAKE.IN', uw = Math.min(W * 0.88, octx.measureText(url).width + 100);
  fitFont(url, 70, uw - 100);
  octx.fillStyle = RED;
  octx.beginPath();
  octx.roundRect(W / 2 - uw / 2, y + 160, uw, 110, 16);
  octx.fill();
  octx.fillStyle = '#fff';
  octx.fillText(url, W / 2, y + 240);
  octx.restore();
}

// ---------- recording ----------

async function record() {
  $('record').disabled = true;
  try {
    status('Loading the music');
    const res0 = await fetch(MUSIC.url);
    if (!res0.ok) throw new Error(`No music at ${MUSIC.url}: put the track there first`);
    const music = await res0.arrayBuffer();
    await document.fonts.load(font(100));
    await document.fonts.load(font(40, 700, false));
    sizeCanvases();
    renderer = createRenderer($('game'), $('minimap'));
    view3d = createView3D($('game3d'));

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      audio: { codec: 'aac', numberOfChannels: 2, sampleRate: RATE },
      fastStart: 'in-memory',
    });
    let failure = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
    venc.configure({ codec: 'avc1.64002a', width: W, height: H, bitrate: 16_000_000, framerate: FPS });

    let frame = 0, beat = 0;
    for (let i = 0; i < SHOTS.length; i++) {
      const shot = SHOTS[i];
      status(`Recording shot ${i + 1} of ${SHOTS.length}`);
      const sh = prepare(shot);
      // Frames to the shot's last beat, counted from the start so cuts stay on the beat.
      const start = frame;
      const n = Math.round((beat + shot.beats) * BEAT * FPS) - frame;
      for (let f = 0; f < n; f++, frame++) {
        // The clean laps' trip off: a nudge wide just in, until the lap goes.
        if (shot.off) sh.steer = f / FPS > BEAT / 4 && sh.offTick === null ? 0.8 : 0;
        tick(sh);
        drawShot(sh, (frame - start) / FPS, beat + (frame - start) / FPS / BEAT);
        const vf = new VideoFrame(out, { timestamp: Math.round((frame * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: frame % (FPS * 2) === 0 });
        vf.close();
        if (failure) throw failure;
        if (venc.encodeQueueSize > 6) await new Promise((r) => venc.addEventListener('dequeue', r, { once: true }));
      }
      beat += shot.beats;
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between shots
    }
    await venc.flush();

    status('Cutting the music');
    const pcm = await cutMusic(music, frame / FPS);
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e; } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: RATE, numberOfChannels: 2, bitrate: 192_000 });
    const [l, r] = [pcm.getChannelData(0), pcm.getChannelData(1)];
    for (let i = 0; i < l.length; i += 1024) {
      const n = Math.min(1024, l.length - i);
      const data = new Float32Array(n * 2);
      data.set(l.subarray(i, i + n), 0);
      data.set(r.subarray(i, i + n), n);
      aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / RATE), data }));
    }
    await aenc.flush();
    if (failure) throw failure;
    muxer.finalize();

    status('Saving');
    const res = await fetch(`http://localhost:5174/?name=${NAME}`, { method: 'POST', body: new Blob([muxer.target.buffer], { type: 'video/mp4' }) });
    if (!res.ok) throw new Error(`Saving failed: ${res.status}`);
    status(`Done: launch/trailer/${NAME}, ${(muxer.target.buffer.byteLength / 1e6).toFixed(1)} MB, ${(frame / FPS).toFixed(1)} s`);
  } catch (err) {
    console.error(err);
    status(`Failed: ${err.message}`);
  } finally {
    $('record').disabled = false;
  }
}

// The track's parts one after another, each faded in and out over a few
// milliseconds so the cut doesn't click, the end faded out, and the loudest
// moment brought to -1 dB.
async function cutMusic(mp3, seconds) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
  const track = await ctx.decodeAudioData(mp3);
  let at = 0;
  for (const p of MUSIC.parts) {
    const len = Math.min(p.beats * BEAT, seconds - at);
    const src = ctx.createBufferSource();
    src.buffer = track;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.008);
    g.gain.setValueAtTime(1, at + len - 0.025);
    g.gain.linearRampToValueAtTime(0, at + len);
    src.connect(g).connect(ctx.destination);
    src.start(at, p.from, len);
    at += len;
  }
  const buf = await ctx.startRendering();
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), n = RATE * 0.8, from = d.length - n;
    for (let i = Math.max(0, from); i < d.length; i++) d[i] *= Math.max(0, 1 - (i - from) / n);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const gain = 0.89 / (peak || 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
  return buf;
}

$('record').addEventListener('click', record);
window.recordTrailer = record;
