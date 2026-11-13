// The game trailer, made from the game itself. Each shot is a real session
// driven by the AI and drawn by the game's own renderers one frame at a time,
// so it's perfectly smooth however long a frame takes. The engine sound comes
// from the game's audio, rendered offline to match the pictures, under an
// original music track (music.js) that the cut follows beat for beat. Captions
// and title cards go on top, and the browser encodes it all to MP4 (H.264, AAC).
//
// Run the dev server and `node tools/trailer/save.mjs`, open
// http://localhost:5173/tools/trailer/ and press Record: the video lands in
// launch/trailer/. Like the game, nothing here names the championship.

import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';
import { TRACKS, buildTrack } from '../../src/track.js';
import { buildLine } from '../../src/line.js';
import { Session, COUNTDOWN } from '../../src/session.js';
import { RaceSession } from '../../src/race.js';
import { createDriver } from '../../src/ai.js';
import { createRenderer } from '../../src/render.js';
import { createView3D } from '../../src/view3d.js';
import { createAudio } from '../../src/audio.js';
import { DT } from '../../src/car.js';
import { scoreMusic, BEAT } from './music.js';

const W = 1920, H = 1080, FPS = 60, RATE = 48000;
const NAME = 'late-brake-trailer.mp4';
const RED = '#e8112d', TEXT = '#f3f4f6', MUTED = '#c3c8d0', GREEN = '#34d27b';
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const PAINT = '#e8112d';

// The cut, in beats of the music (64 in all, 30 seconds): drops on the Spa
// shot and on GO, a break on the "brake" card, a breakdown under the medals.
// `at` starts a shot `lead` seconds before the circuit's `stop`-th biggest
// braking zone (0 is the biggest) on a flying lap; the ghost shot starts
// `from` seconds into one; the race skips `skip` ticks of the start lights so
// GO lands on beat 32. `zoom` brings the top-down cameras closer than the
// game's (ZOOM by default). Cards are text on their own.
const SHOTS = [
  { kind: 'drive', track: 'mc-1929', camera: 'cockpit', beats: 6, at: { stop: 1, lead: 1.9 } },
  { kind: 'card', beats: 2, title: 'SIX REAL CIRCUITS' },
  { kind: 'drive', track: 'be-1925', camera: 'chase', beats: 6, at: { stop: 0, lead: 1.6 }, kicker: 'SPA-FRANCORCHAMPS', title: 'BUILT AT TRUE SCALE' },
  { kind: 'drive', track: 'it-1922', camera: 'fixed', beats: 6, at: { stop: 0, lead: 1.8 }, line: 'full', kicker: 'MONZA', title: 'FOLLOW THE RACING LINE' },
  { kind: 'card', beats: 2, title: 'BRAKE AS LATE', sub: 'AS YOU DARE' },
  { kind: 'drive', track: 'at-1969', camera: 'cockpit', beats: 5, at: { stop: 0, lead: 1.6 }, kicker: 'SPIELBERG' },
  { kind: 'race', track: 'gb-1948', camera: 'chase', beats: 8, skip: 3, zoom: 1.15, kicker: 'SILVERSTONE', title: 'RACE AI DRIVERS OR FRIENDS ONLINE' },
  { kind: 'ghost', track: 'br-1940', camera: 'chase', beats: 5, from: 6, kicker: 'INTERLAGOS', title: 'CHASE YOUR GHOST' },
  { kind: 'drive', track: 'mc-1929', camera: 'chase', beats: 2, at: { stop: 0, lead: 0.9 } },
  { kind: 'drive', track: 'be-1925', camera: 'cockpit', beats: 2, at: { stop: 2, lead: 1.2 } },
  { kind: 'drive', track: 'gb-1948', camera: 'fixed', beats: 2, at: { stop: 0, lead: 1 }, line: 'full' },
  { kind: 'drive', track: 'it-1922', camera: 'cockpit', beats: 2, at: { stop: 1, lead: 1 } },
  { kind: 'card', beats: 4, title: 'BRONZE  ·  SILVER  ·  GOLD', sub: 'ON EVERY CIRCUIT', medals: true },
  { kind: 'drive', track: 'mc-1929', camera: 'chase', beats: 4, at: { stop: 2, lead: 1.4 }, kicker: 'MONACO', title: 'A DAILY CHALLENGE AND LEADERBOARDS' },
  { kind: 'end', track: 'be-1925', camera: 'fixed', beats: 8, at: { stop: 1, lead: 3 }, zoom: 1 },
];
const ZOOM = { chase: 1.7, fixed: 1.5 };

const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; window.trailerStatus = s; };
const out = $('out');
const octx = out.getContext('2d');
const tracks = new Map();
const trackById = (id) => {
  if (!tracks.has(id)) tracks.set(id, buildTrack(TRACKS.find((d) => d.id === id)));
  return tracks.get(id);
};

// The game's canvases sized so their pixels come out at 1920 × 1080: the
// cockpit's exactly, the top-down one `zoom` times bigger, so a 1920 × 1080
// crop of it is that much closer and still sharp. Its camera framing follows
// the canvas's size, so the renderer is told when it changes.
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

// One physics tick with the AI driving the player's car. Before GO the
// engine is revved on the grid instead.
function tick(sh) {
  const s = sh.session;
  let inp;
  if (s.phase === 'running') {
    const others = sh.race ? s.opponents.map((r) => ({ car: r.car, lat: r.car.lat ?? 0 })) : [];
    inp = { ...sh.driver.control(s.car, others, DT), sens: 1 };
    if (inp.reset) s.resetToTrack();
  } else {
    const e = s.clock + COUNTDOWN;
    inp = { throttle: e > 1 && Math.sin(e * 11) > -0.2 ? 1 : 0, brake: 0, steer: 0, sens: 1 };
  }
  s.step(inp);
  if (s.phase === 'running') renderer.addSkid(s.car);
  s.events.length = 0;
  return inp;
}

// A lap by a quicker AI, to race as a ghost: the flying lap after the start.
function ghostLap(t) {
  const s = new Session(t, null);
  const sh = { session: s, driver: createDriver(t, t.line ||= buildLine(t), 0.985) };
  let lap = null;
  for (let k = 0; k < 60 * 400 && !lap; k++) {
    s.step(s.phase === 'running' ? { ...sh.driver.control(s.car, [], DT), sens: 1 } : { throttle: 0, brake: 0, steer: 0 });
    const e = s.events.find((x) => x.type === 'lap' && x.lap === 2);
    s.events.length = 0;
    if (e) lap = e;
  }
  return { time: lap.time, sectors: lap.sectors, ghost: lap.ghost, rescued: false, splits: [] };
}

// Sets a shot up and runs it on to where it starts.
function prepare(shot) {
  const t = trackById(shot.track);
  const line = t.line ||= buildLine(t);
  sizeCanvases(shot.camera === 'cockpit' ? 1 : shot.zoom ?? ZOOM[shot.camera]);
  renderer.setTrack(t);
  const sh = { shot, race: shot.kind === 'race' };
  if (sh.race) {
    sh.session = new RaceSession(t, null, { opponents: 3, laps: 99, difficulty: 'medium', name: 'You' });
    sh.driver = createDriver(t, line, 0.93);
    for (let k = 0; k < (shot.skip || 0); k++) tick(sh);
    return sh; // from the start lights
  }
  if (shot.kind === 'ghost') {
    // A quicker ghost, so it pulls clear of the car instead of hiding under it.
    const best = ghostLap(t);
    sh.session = new Session(t, { best, bestSectors: best.sectors });
    sh.driver = createDriver(t, line, 0.92);
    for (let k = 0; k < 60 * 400; k++) {
      tick(sh);
      if (sh.session.laps.length >= 1 && sh.session.lapTime >= shot.from) return sh;
    }
    throw new Error('Ghost shot never reached its start');
  } else {
    sh.session = new Session(t, null);
    sh.driver = createDriver(t, line, 0.97);
  }
  // A flying lap, a little before the chosen stop.
  const list = stops(t);
  const stop = list[shot.at.stop % list.length];
  const lead = shot.at.lead;
  const target = (stop.s - stop.v * 0.85 * lead + t.length * 2) % t.length;
  const s = sh.session;
  for (let k = 0; k < 60 * 600; k++) {
    tick(sh);
    if (s.phase === 'running' && s.laps.length >= 1 && (s.car.s - target + t.length) % t.length < 30) return sh;
  }
  throw new Error(`Shot never reached its start: ${shot.track}`);
}

// ---------- drawing ----------

const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

function font(size, weight = 800, italic = true) {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
}

function vignette() {
  const g = octx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  octx.fillStyle = g;
  octx.fillRect(0, 0, W, H);
}

// Bottom-left caption: the circuit in red, then the line.
function caption(kicker, title, t) {
  const k = ease(t / 0.35);
  octx.save();
  const g = octx.createLinearGradient(0, H - 330, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.55 * k})`);
  octx.fillStyle = g;
  octx.fillRect(0, H - 330, W, 330);
  octx.globalAlpha = k;
  const x = 110 - (1 - k) * 70;
  const bottom = H - 110;
  octx.fillStyle = RED;
  octx.fillRect(x - 34, bottom - (title ? 150 : 50), 10, title ? 150 : 50);
  octx.shadowColor = 'rgba(0,0,0,0.6)';
  octx.shadowBlur = 18;
  octx.letterSpacing = '6px';
  octx.font = font(40, 700, false);
  octx.fillStyle = RED;
  octx.fillText(kicker, x, bottom - (title ? 104 : 4));
  if (title) {
    octx.letterSpacing = '1px';
    octx.font = font(94);
    octx.fillStyle = TEXT;
    octx.fillText(title, x, bottom);
  }
  octx.restore();
}

function cardBackground() {
  const g = octx.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, '#1a1d24');
  g.addColorStop(1, '#07080a');
  octx.fillStyle = g;
  octx.fillRect(0, 0, W, H);
  octx.fillStyle = RED;
  octx.fillRect(0, H - 14, W, 14);
}

function card(shot, t) {
  cardBackground();
  const k = ease(t / 0.3);
  octx.save();
  octx.globalAlpha = k;
  octx.translate(W / 2, H / 2);
  const sc = 1.08 - 0.08 * k;
  octx.scale(sc, sc);
  octx.textAlign = 'center';
  octx.fillStyle = TEXT;
  octx.letterSpacing = '2px';
  octx.font = font(shot.medals ? 120 : 170);
  const ty = shot.sub ? -20 : 55;
  octx.fillText(shot.title, 0, shot.medals ? -40 : ty);
  if (shot.sub) {
    octx.letterSpacing = '10px';
    octx.font = font(64, 700, false);
    octx.fillStyle = shot.medals ? MUTED : RED;
    octx.fillText(shot.sub, 0, shot.medals ? 60 : 90);
  }
  if (shot.medals) {
    [['#cd7f32', -230], ['#c9ced6', 0], ['#e0b12c', 230]].forEach(([c, dx], i) => {
      const m = ease((t - 0.15 * i) / 0.3);
      octx.globalAlpha = k * m;
      octx.beginPath();
      octx.arc(dx, 220, 58 * (0.6 + 0.4 * m), 0, Math.PI * 2);
      octx.fillStyle = c;
      octx.fill();
      octx.lineWidth = 8;
      octx.strokeStyle = 'rgba(255,255,255,0.35)';
      octx.stroke();
    });
  }
  octx.restore();
}

// The game's start lights: three reds, then all out for GO.
function lights(s) {
  const e = s.clock + COUNTDOWN;
  const go = s.phase !== 'countdown';
  if (go && s.clock >= 0.8) return;
  octx.save();
  const cx = W / 2, cy = H * 0.24;
  if (!go) {
    const lit = Math.min(3, Math.floor(e / 0.6));
    const r = 38, gap = 28, pw = 6 * r + 2 * gap + 64, ph = 2 * r + 48;
    octx.fillStyle = '#0d0d0e';
    octx.strokeStyle = '#2a2a2e';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 26);
    octx.fill();
    octx.stroke();
    for (let i = 0; i < 3; i++) {
      octx.beginPath();
      octx.arc(cx + (i - 1) * (2 * r + gap), cy, r, 0, Math.PI * 2);
      octx.fillStyle = i < lit ? '#ff2a2a' : '#2a0d0d';
      octx.shadowColor = '#ff2a2a';
      octx.shadowBlur = i < lit ? 44 : 0;
      octx.fill();
    }
  } else {
    octx.textAlign = 'center';
    octx.font = font(170);
    octx.fillStyle = GREEN;
    octx.shadowColor = 'rgba(0,0,0,0.6)';
    octx.shadowBlur = 28;
    octx.fillText('GO', cx, cy + 60);
  }
  octx.restore();
}

function endCard(t) {
  octx.fillStyle = `rgba(7,8,10,${0.55 + 0.25 * ease(t / 0.6)})`;
  octx.fillRect(0, 0, W, H);
  const k = ease(t / 0.45);
  octx.save();
  octx.globalAlpha = k;
  octx.textAlign = 'left';
  octx.font = font(250);
  octx.letterSpacing = '2px';
  const late = octx.measureText('LATE').width, brake = octx.measureText('BRAKE').width;
  const x = W / 2 - (late + brake) / 2;
  const y = H / 2 - 10 + (1 - k) * 30;
  octx.shadowColor = 'rgba(0,0,0,0.6)';
  octx.shadowBlur = 30;
  octx.fillStyle = TEXT;
  octx.fillText('LATE', x, y);
  octx.fillStyle = RED;
  octx.fillText('BRAKE', x + late, y);
  octx.shadowBlur = 0;
  const k2 = ease((t - 0.35) / 0.4);
  octx.globalAlpha = k2;
  octx.textAlign = 'center';
  octx.letterSpacing = '8px';
  octx.font = font(54, 700, false);
  octx.fillStyle = MUTED;
  octx.fillText('FREE IN YOUR BROWSER  ·  NO DOWNLOAD', W / 2, y + 110);
  const k3 = ease((t - 0.7) / 0.4);
  octx.globalAlpha = k3;
  octx.letterSpacing = '4px';
  octx.font = font(70);
  const url = 'LATEBRAKE.IN', uw = octx.measureText(url).width + 90;
  octx.fillStyle = RED;
  octx.beginPath();
  octx.roundRect(W / 2 - uw / 2, y + 160, uw, 104, 14);
  octx.fill();
  octx.fillStyle = '#fff';
  octx.fillText(url, W / 2, y + 236);
  octx.restore();
}

// The frame for a shot at `t` seconds into it.
function drawShot(sh, t) {
  const { shot } = sh;
  if (shot.kind === 'card') return card(shot, t);
  const s = sh.session;
  const cockpit = shot.camera === 'cockpit' && view3d;
  const opts = { ghost: shot.kind === 'ghost', camera: cockpit ? 'none' : shot.camera, line: shot.line || 'off', lineColours: 'standard', paint: PAINT };
  renderer.draw(s, 1, opts, 1 / FPS);
  if (cockpit) {
    view3d.draw(s, 1, opts);
    octx.drawImage($('game3d'), 0, 0, W, H);
  } else {
    // The middle of the bigger picture, keeping the car where the camera puts
    // it: low on screen for chase, in the middle for fixed.
    const g = $('game'), cw = g.width, ch = g.height, z = cw / W;
    const sx = (cw - W * Math.min(z, 1)) / 2, sy = (shot.camera === 'chase' ? 0.63 : 0.5) * (ch - H * Math.min(z, 1));
    octx.drawImage(g, sx, sy, Math.min(cw, W), Math.min(ch, H), 0, 0, W, H);
  }
  vignette();
  if (shot.kind === 'race') lights(s);
  if (shot.kind === 'end') return endCard(t);
  if (shot.kicker) caption(shot.kicker, shot.title, t - 0.15);
}

// ---------- recording ----------

let renderer, view3d;

async function record() {
  $('record').disabled = true;
  try {
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

    // Pictures, and what the sound needs for each frame.
    const sound = []; // per frame: { shot, running, car, input, beep }
    let frame = 0;
    let beat = 0;
    for (let i = 0; i < SHOTS.length; i++) {
      const shot = SHOTS[i];
      status(`Recording shot ${i + 1} of ${SHOTS.length}`);
      const sh = shot.kind === 'card' ? { shot } : prepare(shot);
      // Frames to the shot's last beat, counted from the start so cuts stay on the beat.
      const n = Math.round((beat + shot.beats) * BEAT * FPS) - frame;
      beat += shot.beats;
      let lit = 0, wasRunning = sh.session?.phase === 'running';
      for (let f = 0; f < n; f++, frame++) {
        let inp = null, beep = null;
        if (sh.session) {
          inp = tick(sh);
          const s = sh.session;
          if (s.phase === 'countdown') {
            const now = Math.min(3, Math.floor((s.clock + COUNTDOWN) / 0.6));
            if (now !== lit && now > 0) beep = [523, 0.18, 0.16];
            lit = now;
          } else if (!wasRunning) beep = [1046, 0.5, 0.2];
          wasRunning = s.phase === 'running';
        }
        drawShot(sh, f / FPS);
        const c = sh.session?.car;
        sound.push({
          shot: shot.kind === 'card' || shot.kind === 'end' ? -1 : i,
          running: sh.session?.phase === 'running',
          car: c && { vf: c.vf, speed: c.speed, slip: c.slip, kerb: c.kerb, onTrack: c.onTrack, wall: c.wall },
          input: inp && { throttle: inp.throttle, brake: inp.brake },
          beep,
          card: f === 0 && (shot.kind === 'card' || shot.kind === 'end') ? shot.kind : null,
        });
        const vf = new VideoFrame(out, { timestamp: Math.round((frame * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: frame % (FPS * 2) === 0 });
        vf.close();
        if (failure) throw failure;
        if (venc.encodeQueueSize > 6) await new Promise((r) => venc.addEventListener('dequeue', r, { once: true }));
      }
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between shots
    }
    await venc.flush();

    status('Rendering the sound');
    const pcm = await renderSound(sound);
    status('Encoding the sound');
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

// The game's own audio, one copy per shot, played offline in step with the
// pictures: each frame suspends the render, hands the shot's copy that
// frame's car and pedals, and carries on. A shot's copy starts by running
// through a few long steps so its gearbox and revs are already up to speed.
// The copies play into an engine bus (they're handed a context whose
// `destination` is it), mixed under the music through a gentle compressor.
async function renderSound(frames) {
  const total = frames.length / FPS + 0.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * RATE), RATE);
  const mix = ctx.createDynamicsCompressor();
  mix.threshold.value = -14;
  mix.knee.value = 8;
  mix.ratio.value = 4;
  mix.attack.value = 0.004;
  mix.release.value = 0.2;
  mix.connect(ctx.destination);
  const engineBus = ctx.createGain();
  engineBus.gain.value = 0.5;
  engineBus.connect(mix);
  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.8;
  musicBus.connect(mix);
  scoreMusic(ctx, musicBus);
  const engineCtx = new Proxy(ctx, {
    get: (c, k) => (k === 'destination' ? engineBus : typeof c[k] === 'function' ? c[k].bind(c) : c[k]),
  });
  try { localStorage.setItem('latebrake:muted', '0'); } catch {}
  const copies = SHOTS.map((s) => (s.kind === 'card' || s.kind === 'end' ? null : createAudio({ context: engineCtx })));
  copies.forEach((a) => a?.unlock());
  await new Promise((r) => setTimeout(r, 2500)); // engine loops load and decode

  let active = -1;
  frames.forEach((fr, i) => {
    ctx.suspend(Math.max(i / FPS, 128 / RATE)).then(() => { // not at 0: rendering hasn't started
      if (fr.shot !== active) {
        copies[active]?.silence();
        active = fr.shot;
        const a = copies[active];
        if (a && fr.running) for (let k = 0; k < 10; k++) a.update(fr.car, fr.input, 0.2);
      }
      const a = copies[active];
      if (a) {
        if (fr.running) a.update(fr.car, fr.input, 1 / FPS);
        else a.idle(fr.input, 1 / FPS);
        if (fr.beep) a.beep(...fr.beep);
      }
      if (fr.card) whoosh(ctx, i / FPS, mix);
      ctx.resume();
    });
  });
  const buf = await ctx.startRendering();
  // Fade the last second out, then bring the loudest moment to -1 dB.
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), n = RATE * 1.2, from = Math.round(frames.length / FPS * RATE - n);
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

// A rush of air into a title card.
function whoosh(ctx, t, out) {
  const len = 0.5;
  const noise = ctx.createBuffer(1, Math.ceil(RATE * len), RATE);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(2400, t);
  bp.frequency.exponentialRampToValueAtTime(300, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

$('record').addEventListener('click', record);
window.recordTrailer = record;
