// Game audio with Web Audio. The engine is a real F1 recording (a loop cut
// by tools/make-engine-loops.mjs, pitched with rpm); everything else is
// synthesized. Continuous layers (engine, tyres, kerbs, grass) follow the car
// every frame; one-shots (impacts, shifts, beeps, chimes) fire on game events.

const GEAR_TOP = [24, 34, 44, 54, 64, 74, 84, 96]; // m/s at the rev limiter, gears 1–8
const RPM_MAX = 12000;
const RPM_IDLE = 4500;
const RPM_LAUNCH = 9000; // clutch slip: revs held here pulling away in 1st
const SHIFT_GAP = 0.15;  // seconds between gear changes
const LOOP_RPM = 11000; // rpm the engine loop sounds like at normal speed
const LOOP_URL = new URL('../sounds/engine-high.wav', import.meta.url).href;
const MUTE_KEY = 'latebrake:muted';

export function createAudio(opts = {}) {
  let ctx = opts.context || null;
  let nodes = null;
  let muted = readMuted();
  let gear = 1;
  let rpm = RPM_IDLE;
  let throttle = 0;
  let lastThrottle = 0;
  let shiftDip = 0;
  let shiftTimer = 0;
  let lastBlip = 0;
  let lastHit = 0;

  // The AudioContext may only start after a user gesture.
  function unlock() {
    if (!nodes) build();
    if (ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {});
  }

  function build() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const noise = makeNoise(ctx);
    const loopNoise = () => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start(0, Math.random() * 2);
      return src;
    };

    // Engine: one full-throttle loop, pitched down for lower revs. Off throttle
    // the sound drops and darkens, like the overrun of a real car. (The idle
    // part of the recording has people talking in the background, so it isn't used.)
    const engGain = gain(ctx, 0);
    const engFilter = biquad(ctx, 'lowpass', 16000, 0.5);
    engFilter.connect(engGain).connect(master);
    const loops = { main: null };
    fetch(LOOP_URL)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { loops.main = startLoop(buf, engFilter); })
      .catch((err) => console.warn('Engine sound failed to load', err));

    // Tyres under braking: broadband scrub. Sliding: a pitched squeal on top.
    const scrub = loopNoise();
    const scrubFilter = biquad(ctx, 'bandpass', 900, 0.8);
    const scrubGain = gain(ctx, 0);
    scrub.connect(scrubFilter).connect(scrubGain).connect(master);

    const squealNoise = loopNoise();
    const squealFilter = biquad(ctx, 'bandpass', 1900, 12);
    const squealGain = gain(ctx, 0);
    squealNoise.connect(squealFilter).connect(squealGain).connect(master);
    const squealTone = ctx.createOscillator();
    squealTone.frequency.value = 1150;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 7;
    const vibDepth = gain(ctx, 30);
    vibrato.connect(vibDepth).connect(squealTone.frequency);
    const squealToneGain = gain(ctx, 0);
    squealTone.connect(squealToneGain).connect(master);
    squealTone.start();
    vibrato.start();

    // Kerbs: a buzz at the rate the painted blocks pass under the wheels.
    const kerb = ctx.createOscillator();
    kerb.type = 'square';
    const kerbGain = gain(ctx, 0);
    kerb.connect(biquad(ctx, 'lowpass', 420, 1)).connect(kerbGain).connect(master);
    kerb.start();

    // Grass and gravel: low rumble.
    const grass = loopNoise();
    const grassGain = gain(ctx, 0);
    grass.connect(biquad(ctx, 'lowpass', 260, 1.5)).connect(grassGain).connect(master);

    // Scraping along a barrier: gritty mid noise, chopped up by slow random
    // modulation so it grinds instead of hissing.
    const scrape = loopNoise();
    const scrapeChop = gain(ctx, 0.5);
    const scrapeGain = gain(ctx, 0);
    scrape.connect(biquad(ctx, 'bandpass', 1100, 0.9)).connect(scrapeChop).connect(scrapeGain).connect(master);
    const chop = loopNoise();
    chop.connect(biquad(ctx, 'lowpass', 35, 0.7)).connect(gain(ctx, 7)).connect(scrapeChop.gain);

    nodes = {
      master, noise, engGain, engFilter, loops,
      scrubGain, scrubFilter, squealGain, squealToneGain, squealTone,
      kerb, kerbGain, grassGain, scrapeGain,
    };
  }

  // Called once per rendered frame while racing.
  function update(car, input, dt) {
    if (!nodes) return;
    const t = ctx.currentTime;
    const v = Math.max(0, car.vf);
    const n = nodes;

    // Gearbox follows road speed, with a short gap between shifts so a
    // sudden stop (a crash) doesn't rattle down all the gears at once.
    shiftTimer = Math.max(0, shiftTimer - dt);
    const wheelRpm = (g) => (v / GEAR_TOP[g - 1]) * RPM_MAX;
    if (shiftTimer === 0) {
      if (wheelRpm(gear) > RPM_MAX * 0.985 && gear < 8) {
        gear++;
        shiftTimer = SHIFT_GAP;
        shiftDip = 0.05;
        click(0.05);
      } else if (gear > 1 && wheelRpm(gear - 1) < RPM_MAX * 0.8) {
        gear--;
        shiftTimer = SHIFT_GAP;
        if (input.brake > 0 && v > 15) blip();
      }
    }

    const target = input.throttle > 0 ? 1 : 0;
    throttle += (target - throttle) * Math.min(1, dt * 14);
    if (lastThrottle > 0.8 && target === 0 && rpm > 9000) crackle();
    lastThrottle = throttle;
    shiftDip = Math.max(0, shiftDip - dt);

    // In first gear the clutch slips, so revs rise with throttle even at a
    // standstill instead of bogging at idle.
    let goal = Math.max(RPM_IDLE, wheelRpm(gear));
    if (gear === 1) goal = Math.max(goal, RPM_IDLE + throttle * (RPM_LAUNCH - RPM_IDLE));
    engine(goal, dt);
    const speed = car.speed;
    const braking = input.brake > 0 && v > 8 ? Math.min(1, v / 60) : 0;
    n.scrubGain.gain.setTargetAtTime(braking * 0.06, t, 0.05);
    n.scrubFilter.frequency.setTargetAtTime(500 + v * 12, t, 0.1);

    const slide = speed > 5 ? clamp01((car.slip - 1.2) / 5) : 0;
    const lock = braking * clamp01((v - 30) / 50) * 0.35;
    const sq = Math.max(slide, lock);
    n.squealGain.gain.setTargetAtTime(sq * 0.22, t, 0.04);
    n.squealToneGain.gain.setTargetAtTime(sq * 0.035, t, 0.04);
    n.squealTone.frequency.setTargetAtTime(950 + sq * 400, t, 0.1);


    const onKerb = car.kerb && car.onTrack && speed > 4;
    n.kerb.frequency.setTargetAtTime(Math.max(8, speed / 1.6), t, 0.02);
    n.kerbGain.gain.setTargetAtTime(onKerb ? 0.09 * Math.min(1, speed / 30) : 0, t, 0.02);

    n.grassGain.gain.setTargetAtTime(!car.onTrack ? 0.35 * Math.min(1, speed / 25) : 0, t, 0.05);
    n.scrapeGain.gain.setTargetAtTime(car.wall && speed > 3 ? 0.18 * Math.min(1, speed / 40) : 0, t, 0.02);
  }

  // Engine sound for any rpm. Revs chase the goal quickly, like a light
  // flywheel; the loop is sped up or slowed down from the rpm it was recorded
  // at, and low revs are quieter and duller.
  function engine(goal, dt) {
    const n = nodes, t = ctx.currentTime;
    rpm += (goal - rpm) * Math.min(1, dt * (goal > rpm ? 10 : 6));
    const r = rpm / RPM_MAX;

    if (n.loops.main) n.loops.main.playbackRate.setTargetAtTime(rpm / LOOP_RPM, t, 0.02);
    const vol = shiftDip > 0 ? 0.2 : (0.35 + 0.65 * throttle) * (0.45 + 0.55 * r) * 0.8;
    n.engGain.gain.setTargetAtTime(vol, t, shiftDip > 0 ? 0.008 : 0.04);
    n.engFilter.frequency.setTargetAtTime(1500 + 4000 * r + 12000 * throttle * r, t, 0.05);
  }

  function startLoop(buffer, out) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(out);
    src.start(0, Math.random() * buffer.duration);
    return src;
  }

  // Countdown and before GO: tyre and road layers off, engine free-revs
  // with the throttle so you can rev it on the grid.
  function idle(input, dt = 1 / 60) {
    if (!nodes) return;
    const t = ctx.currentTime;
    const n = nodes;
    for (const g of [n.scrubGain, n.squealGain, n.squealToneGain, n.kerbGain, n.grassGain, n.scrapeGain]) {
      g.gain.setTargetAtTime(0, t, 0.05);
    }
    gear = 1;
    shiftDip = 0;
    const target = input?.throttle > 0 ? 1 : 0;
    throttle += (target - throttle) * Math.min(1, dt * 14);
    if (lastThrottle > 0.8 && target === 0 && rpm > 9000) crackle();
    lastThrottle = throttle;
    engine(RPM_IDLE + throttle * (RPM_MAX * 0.9 - RPM_IDLE), dt);
  }

  function silence() {
    if (!nodes) return;
    idle();
    nodes.engGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  // ---------- one-shots ----------

  // Crash: a low punch and body boom, a crunch, then carbon fibre debris
  // scattering for a few hundred milliseconds. Harder hits add more of all.
  function hit(impact) {
    if (!nodes || ctx.currentTime - lastHit < 0.15) return;
    lastHit = ctx.currentTime;
    const t = ctx.currentTime;
    const k = clamp01((impact - 2) / 22);

    const punch = ctx.createOscillator();
    punch.frequency.setValueAtTime(75, t);
    punch.frequency.exponentialRampToValueAtTime(34, t + 0.18);
    punch.connect(env(t, 0.25 + 0.45 * k, 0.003, 0.2)).connect(nodes.master);
    punch.start(t);
    punch.stop(t + 0.3);

    burst(t, 0.3 + 0.2 * k, 'lowpass', 240, 0.35 + 0.7 * k);
    burst(t, 0.1 + 0.15 * k, 'bandpass', 650 + Math.random() * 200, 0.12 + 0.5 * k, 0.7);

    const bits = 2 + Math.round(12 * k);
    for (let i = 0; i < bits; i++) {
      const at = t + 0.02 + Math.random() ** 1.6 * (0.2 + 0.35 * k);
      const fade = 1 - (at - t) / 0.6;
      burst(at, 0.008 + Math.random() * 0.02, i % 3 ? 'highpass' : 'bandpass',
        i % 3 ? 2500 + Math.random() * 3000 : 1200 + Math.random() * 800, (0.05 + 0.2 * k) * fade, 1.5);
    }
  }

  function click(level) {
    burst(ctx.currentTime, 0.03, 'highpass', 2500, level);
  }

  // Downshift under braking: a short throttle blip, at most a few per second.
  function blip() {
    const t = ctx.currentTime;
    if (t - lastBlip < 0.25) return;
    lastBlip = t;
    rpm = Math.min(RPM_MAX, rpm + 1200);
    nodes.engGain.gain.cancelScheduledValues(t);
    nodes.engGain.gain.setValueAtTime(0.85, t);
    nodes.engGain.gain.setTargetAtTime(0.45, t + 0.05, 0.05);
  }

  // Lift-off pops from the exhaust.
  function crackle() {
    const t = ctx.currentTime;
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      burst(t + 0.05 + Math.random() * 0.4, 0.025, 'bandpass', 900 + Math.random() * 900, 0.18 + Math.random() * 0.15);
    }
  }

  function beep(freq, dur = 0.18, level = 0.18) {
    if (!nodes) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const e = env(t, level, 0.005, dur);
    o.connect(biquad(ctx, 'lowpass', 3000, 0.7)).connect(e).connect(nodes.master);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function chime(kind) {
    if (!nodes) return;
    const notes = kind === 'best' ? [784, 988, 1175, 1568] : kind === 'bad' ? [330, 262] : [784, 1047];
    notes.forEach((fq, i) => {
      const t = ctx.currentTime + i * 0.09;
      const o = ctx.createOscillator();
      o.type = kind === 'bad' ? 'sawtooth' : 'triangle';
      o.frequency.value = fq;
      const e = env(t, 0.16, 0.005, 0.35);
      o.connect(e).connect(nodes.master);
      o.start(t);
      o.stop(t + 0.5);
    });
  }

  // ---------- helpers ----------

  function burst(t, dur, type, freq, level, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = nodes.noise;
    const e = env(t, level, 0.002, dur);
    src.connect(biquad(ctx, type, freq, q)).connect(e).connect(nodes.master);
    src.start(t, Math.random() * 1.5, dur + 0.1);
  }

  function env(t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch {}
    if (!nodes) return;
    nodes.master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.03);
    if (!m && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  return {
    unlock, update, idle, silence, hit, beep, chime,
    get gear() { return gear; },
    get muted() { return muted; },
    setMuted,
    suspend() { if (nodes) ctx.suspend().catch(() => {}); },
    resume() { if (nodes && !muted) ctx.resume().catch(() => {}); },
  };
}

function makeNoise(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function biquad(ctx, type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(ctx, v) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
