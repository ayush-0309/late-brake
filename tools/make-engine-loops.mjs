// Cuts seamless engine loops out of a real F1 recording:
//   node tools/make-engine-loops.mjs
//
// Source: "F-1raceCar-IdleAndRaceStartDemo.wav" by Ears68, freesound.org/s/181187
// (2012 Red Bull Renault V8, Sydney Motorsport Park), CC0 1.0.
// Decoding uses macOS `afconvert`; any tool that turns the mp3 into 16-bit
// mono WAV works the same.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = new URL('../data/sounds/f1-v8-ears68-181187.mp3', import.meta.url).pathname;
const OUT = new URL('../sounds/', import.meta.url).pathname;
const SR = 44100;

// Window picked by pitch-tracking the recording: a steady full-throttle
// scream while the car is still close to the microphone. The idle at the
// start isn't used: spectators can be heard talking over it.
const LOOPS = [
  { name: 'engine-high', from: 10.85, to: 11.8, fade: 0.08, rms: 0.16 },
];

const tmp = join(mkdtempSync(join(tmpdir(), 'lb-')), 'src.wav');
execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SR}`, '-c', '1', SRC, tmp]);
const pcm = readWav(readFileSync(tmp));
mkdirSync(OUT, { recursive: true });

for (const l of LOOPS) {
  const a = Math.round(l.from * SR), b = Math.round(l.to * SR);
  const seg = pcm.slice(a, b);
  const f = Math.round(l.fade * SR);

  // Equal-power crossfade of the tail into the head, then drop the tail:
  // the loop point lands inside continuous audio, so there is no click.
  const len = seg.length - f;
  const loop = new Float32Array(len);
  for (let i = 0; i < len; i++) loop[i] = seg[i];
  for (let i = 0; i < f; i++) {
    const t = i / f;
    loop[i] = seg[i] * Math.sin((t * Math.PI) / 2) + seg[len + i] * Math.cos((t * Math.PI) / 2);
  }

  // Remove DC and normalise loudness so the game can mix loops by rpm alone.
  let mean = 0;
  for (const v of loop) mean += v;
  mean /= len;
  let e = 0;
  for (let i = 0; i < len; i++) { loop[i] -= mean; e += loop[i] ** 2; }
  const gain = l.rms / Math.sqrt(e / len);
  let peak = 0;
  for (let i = 0; i < len; i++) { loop[i] *= gain; peak = Math.max(peak, Math.abs(loop[i])); }
  if (peak > 0.98) for (let i = 0; i < len; i++) loop[i] *= 0.98 / peak;

  writeFileSync(join(OUT, `${l.name}.wav`), writeWav(loop));
  console.log(`${l.name}.wav  ${(len / SR).toFixed(2)} s  peak ${Math.min(peak, 0.98).toFixed(2)}`);
}

function readWav(buf) {
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size;
  }
  throw new Error('No data chunk');
}

function writeWav(x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}
