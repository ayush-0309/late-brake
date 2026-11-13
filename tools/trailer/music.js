// The trailer's music: an original electronic track at 128 bpm in A minor,
// synthesized with Web Audio, so there's nothing to license. Everything is
// scheduled up front on an OfflineAudioContext, with the arrangement in beats
// lined up with the cut in trailer.js (SECTIONS below says what plays where).

export const BPM = 128;
export const BEAT = 60 / BPM;

// Am, F, C, G, a bar each: chord tones and the bass root (MIDI notes).
const PROG = [
  { notes: [57, 60, 64], bass: 33 },
  { notes: [53, 57, 60], bass: 29 },
  { notes: [60, 64, 67], bass: 36 },
  { notes: [55, 59, 62], bass: 31 },
];

// [from, to) in beats, and what plays.
const SECTIONS = [
  { from: 0, to: 6, part: 'intro' },
  { from: 6, to: 8, part: 'build' },
  { from: 8, to: 20, part: 'drop' },
  { from: 20, to: 22, part: 'break' },
  { from: 22, to: 27, part: 'half' },
  { from: 27, to: 32, part: 'build', long: true },
  { from: 32, to: 48, part: 'drop' },
  { from: 48, to: 52, part: 'breakdown' },
  { from: 52, to: 56, part: 'drop', lift: true },
  { from: 56, to: 64, part: 'end' },
];

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export function scoreMusic(ctx, out) {
  const T = (b) => b * BEAT;
  const noise = noiseBuffer(ctx, 3);

  // Buses: drums straight, the tonal parts through a "pump" that ducks on
  // each kick, and a shared reverb.
  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(out);
  const pump = ctx.createGain();
  pump.connect(bus);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 2.6);
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.35;
  verbIn.connect(verb).connect(bus);
  // A dotted-eighth echo for the lead.
  const echo = ctx.createDelay(1);
  echo.delayTime.value = T(0.75);
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.4;
  echo.connect(fb).connect(echo);
  echo.connect(echoOut).connect(pump);

  // Filter over the pad and lead, swept by the sections.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.7;
  tone.connect(pump);
  tone.frequency.setValueAtTime(600, 0);

  const chordAt = (b) => PROG[Math.floor(b / 4) % 4];

  for (const sec of SECTIONS) {
    const { from, to, part } = sec;
    for (let b = from; b < to; b++) {
      const t = T(b), c = chordAt(b);
      const first = b === from;
      if (part === 'intro') {
        if (b % 4 === 0 || first) pad(t, Math.min(4 - (b % 4), to - b), c, 0.11);
        for (let s = 0; s < 4; s++) hat(t + T(s / 4), s % 2 ? 0.035 : 0.05);
        if (b >= 2) for (let s = 0; s < 4; s++) lead(t + T(s / 4), arp(c, b * 4 + s), 0.05);
        if (first) {
          tone.frequency.setValueAtTime(500, t);
          tone.frequency.exponentialRampToValueAtTime(2200, T(to));
        }
      } else if (part === 'build') {
        if (first) {
          riser(t, T(to) - t);
          tone.frequency.setValueAtTime(sec.long ? 500 : 1500, t);
          tone.frequency.exponentialRampToValueAtTime(5000, T(to));
        }
        if (b % 4 === 0 || first) pad(t, Math.min(4 - (b % 4), to - b), c, 0.1);
        const last = to - b <= 1;
        for (let s = 0; s < 4; s++) {
          hat(t + T(s / 4), 0.05);
          lead(t + T(s / 4), arp(c, b * 4 + s) + (last ? 12 : 0), 0.04 + 0.04 * ((b - from) / (to - from)));
        }
        // Snare roll into the drop: eighths, then sixteenths, then thirty-seconds.
        const step = to - b > 2 ? 0 : to - b === 2 ? 0.5 : 0.125;
        if (step) for (let s = 0; s < 1; s += step) clap(t + T(s), 0.12 + 0.3 * s);
      } else if (part === 'drop' || part === 'half') {
        if (first) {
          impact(t, part === 'drop' ? 1 : 0.5);
          tone.frequency.setValueAtTime(part === 'half' ? 1400 : 4200, t);
        }
        const half = part === 'half';
        if (!half || b % 2 === 0) kick(t, 1), duck(t);
        if (half ? b % 4 === 2 : b % 2 === 1) clap(t, 0.5);
        for (let s = 0; s < 4; s++) hat(t + T(s / 4), s === 2 ? 0.09 : 0.04, s === 2);
        for (let s = 0; s < 2; s++) bass(t + T(s / 2), c.bass + (s ? 12 : 0), T(0.45));
        if (b % 4 === 0 || first) pad(t, Math.min(4 - (b % 4), to - b), c, half ? 0.08 : 0.07);
        if (!half) for (let s = 0; s < 4; s++) lead(t + T(s / 4), arp(c, b * 4 + s), 0.06);
        if (sec.lift && b === to - 1) riser(t, T(1));
      } else if (part === 'break' || part === 'breakdown') {
        if (first) {
          impact(t, 0.8);
          tone.frequency.setValueAtTime(3000, t);
          tone.frequency.exponentialRampToValueAtTime(700, T(to));
          pad(t, to - b, c, 0.14);
        }
        if (part === 'breakdown') {
          // Three bells as the medals come in: bronze, silver, gold.
          if (first) [76, 79, 84].forEach((m, i) => bell(t + 0.15 * i + 0.05, m));
          for (let s = 0; s < 2; s++) lead(t + T(s / 2), arp(c, b * 2 + s) + 12, 0.035);
        }
      } else if (part === 'end') {
        if (first) {
          impact(t, 1.3);
          kick(t, 1.2);
          pad(t, 8, PROG[0], 0.16, true);
          bassNote(t, PROG[0].bass, T(6));
          tone.frequency.setValueAtTime(4000, t);
          tone.frequency.exponentialRampToValueAtTime(400, T(to));
          bell(t + 0.02, 81);
          bell(t + 0.02, 88);
        }
      }
    }
  }

  // ---------- instruments ----------

  function duck(t) {
    pump.gain.setValueAtTime(0.35, t);
    pump.gain.linearRampToValueAtTime(1, t + 0.22);
  }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function kick(t, vel) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    env(g, t, 0.95 * vel, 0.002, 0.36);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.42);
    burst(t, 0.004, 'highpass', 3000, 0.25 * vel, bus);
  }

  function clap(t, vel) {
    for (let k = 0; k < 3; k++) burst(t + k * 0.009, 0.012, 'bandpass', 1600, 0.5 * vel, bus);
    burst(t + 0.027, 0.16, 'bandpass', 1400, 0.4 * vel, bus, verbIn);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    env(g, t, 0.25 * vel, 0.002, 0.09);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.12);
  }

  function hat(t, level, open = false) {
    burst(t, open ? 0.16 : 0.03, 'highpass', 7500, level, bus);
  }

  function burst(t, dur, type, freq, level, dest, send) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    env(g, t, level, 0.001, dur);
    src.connect(f).connect(g).connect(dest);
    if (send) g.connect(send);
    src.start(t, Math.random() * 1.5); // the buffer is 3 s, the longest burst under 1
    src.stop(t + dur + 0.05);
  }

  // Bass: a saw through a closing filter, with a sine an octave down.
  function bass(t, m, dur) {
    const o = ctx.createOscillator(), sub = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(m);
    sub.frequency.value = hz(m - 12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain(), gs = ctx.createGain();
    env(g, t, 0.16, 0.004, dur);
    env(gs, t, 0.22, 0.004, dur);
    o.connect(f).connect(g).connect(pump);
    sub.connect(gs).connect(pump);
    for (const x of [o, sub]) { x.start(t); x.stop(t + dur + 0.05); }
  }

  function bassNote(t, m, dur) {
    const sub = ctx.createOscillator(), g = ctx.createGain();
    sub.frequency.value = hz(m);
    env(g, t, 0.3, 0.01, dur);
    sub.connect(g).connect(bus);
    sub.start(t);
    sub.stop(t + dur + 0.1);
  }

  // Pad: two slightly detuned saws per chord note, slow in and out.
  function pad(t, beats, chord, level, ring = false) {
    const dur = T(beats);
    for (const m of chord.notes) {
      for (const cents of [-8, 8]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = cents;
        const tail = ring ? 3.5 : 0.25;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level / 3, t + 0.06);
        g.gain.setValueAtTime(level / 3, t + dur);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + tail);
        o.connect(g).connect(tone);
        g.connect(verbIn);
        o.start(t);
        o.stop(t + dur + tail + 0.05);
      }
    }
  }

  // Lead: a plucky square, echoed.
  function lead(t, m, level) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = hz(m);
    env(g, t, level, 0.003, 0.16);
    o.connect(g);
    g.connect(tone);
    g.connect(echo);
    o.start(t);
    o.stop(t + 0.2);
  }

  // Up and down the chord, two octaves up, sixteen steps a bar.
  function arp(chord, step) {
    const [a, b, c] = chord.notes;
    const seq = [a, b, c, a + 12, c, b, a + 12, c + 12];
    return seq[step % seq.length] + 12;
  }

  function bell(t, m) {
    for (const [mul, lvl] of [[1, 0.12], [2.76, 0.04], [5.4, 0.02]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = hz(m) * mul;
      env(g, t, lvl, 0.002, 1.4 / mul);
      o.connect(g).connect(bus);
      g.connect(verbIn);
      o.start(t);
      o.stop(t + 1.6);
    }
  }

  // Noise rising into a drop.
  function riser(t, dur) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    src.connect(f).connect(g).connect(bus);
    g.connect(verbIn);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // A low boom and a wash of noise on a downbeat.
  function impact(t, size) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 1.2);
    env(g, t, 0.55 * size, 0.004, 1.3 * size);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 1.5 * size + 0.1);
    burst(t, 0.9 * size, 'lowpass', 2500, 0.25 * size, bus, verbIn);
  }
}

function noiseBuffer(ctx, secs) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// A hall: two channels of decaying noise.
function impulse(ctx, secs) {
  const n = Math.ceil(ctx.sampleRate * secs);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return b;
}
