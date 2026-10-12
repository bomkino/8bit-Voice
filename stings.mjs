#!/usr/bin/env node
// Little 8-bit stings to put around a line, synthesized like the voices
// themselves: a pulse lead, a 4-bit triangle bass and noise, stepped at 60 Hz like
// a console sound driver. Original tunes, nothing to license.
//
//   node stings.mjs [folder]      writes game-over.wav and hang-up-game-over.wav
//
// Good for a call that ends badly: the hang-up click, then game over.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const CV = require("./chipvoice.js");
const SR = CV.SAMPLE_RATE;
const FRAME = 1 / 60;

const hz = (note) => {
  const m = note.match(/^([A-G])(#|b)?(\d)$/);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 440 * Math.pow(2, (pc + 12 * (+m[3] + 1) - 69) / 12);
};

// One voice of the chip: notes are [note, start s, length s, options].
function voice(out, notes, kind) {
  let phase = 0;
  for (const [note, t0, len, o = {}] of notes) {
    const f0 = hz(note);
    const n0 = Math.round(t0 * SR);
    const n1 = Math.round((t0 + len + (o.release ?? 0.05)) * SR);
    for (let i = n0; i < Math.min(n1, out.length); i++) {
      const t = (i - n0) / SR;
      const fr = Math.floor(t / FRAME);
      // 4-bit volume, stepped once a frame.
      let vol = kind === "tri" ? 15 : Math.max(0, (o.vol ?? 12) - Math.floor(fr / (o.decay ?? 6)));
      if (t > len) vol = Math.max(0, Math.round(vol * (1 - (t - len) / (o.release ?? 0.05))));
      // Pitch: a frame-stepped fall at the end, and a slow vibrato when held.
      let st = 0;
      if (o.fall && t > len - o.fall[0]) st -= (o.fall[1] * Math.floor((t - (len - o.fall[0])) / FRAME)) / Math.round(o.fall[0] / FRAME);
      if (o.vibrato && t > 0.12) st += 0.35 * Math.sin(2 * Math.PI * 5.5 * Math.floor(t / FRAME) * FRAME);
      const f = f0 * Math.pow(2, st / 12);
      phase = (phase + f / SR) % 1;
      let s;
      if (kind === "tri") {
        const step = Math.floor(phase * 32);
        s = (step < 16 ? 15 - step : step - 16) / 7.5 - 1;
      } else {
        const duty = o.duty ?? 0.25;
        s = phase < duty ? 1 : -1;
      }
      out[i] += s * (vol / 15) * (kind === "tri" ? 0.32 : 0.22);
    }
  }
}

function noise(out, t0, len, period, vol) {
  let lfsr = 1;
  let held = 0;
  let c = 0;
  const n0 = Math.round(t0 * SR);
  for (let i = n0; i < Math.min(out.length, n0 + Math.round(len * SR)); i++) {
    if (++c >= period) {
      c = 0;
      const bit = (lfsr ^ (lfsr >> 1)) & 1;
      lfsr = (lfsr >> 1) | (bit << 14);
      held = lfsr & 1 ? 1 : -1;
    }
    const t = (i - n0) / SR;
    out[i] += held * vol * Math.max(0, 1 - t / len);
  }
}

function finish(x) {
  // Gentle DC block and a level that sits with the voice clips.
  let prev = 0;
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = x[i] - prev + 0.995 * y;
    prev = x[i];
    x[i] = y;
  }
  let peak = 0;
  let sum = 0;
  let cnt = 0;
  for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 0.01) { sum += v * v; cnt++; }
  }
  const rms = Math.sqrt(sum / (cnt || 1));
  const g = Math.min(0.89 / (peak || 1), Math.pow(10, -16 / 20) / (rms || 1));
  for (let i = 0; i < x.length; i++) x[i] *= g;
  const fo = Math.round(SR * 0.02);
  for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= i / fo;
  return x;
}

// Game over: a quick hopeful run up, then it all slides down to a low,
// wobbling C with the bass underneath.
function gameOver(click) {
  const o = click ? 0.32 : 0;
  const x = new Float32Array(Math.round(SR * (o + 2.25)));
  if (click) {
    // The receiver going down: a short burst and a thump.
    noise(x, 0, 0.05, 6, 0.5);
    voice(x, [["C3", 0, 0.035, { vol: 15, decay: 1, release: 0.01, duty: 0.5 }]], "sq");
  }
  const q = 0.16;
  voice(x, [
    ["C5", o, 0.06, { vol: 11, decay: 99 }],
    ["Eb5", o + 0.06, 0.06, { vol: 11, decay: 99 }],
    ["G5", o + 0.12, 0.1, { vol: 12, decay: 99 }],
    ["F#5", o + 0.3, q, { vol: 12, decay: 8, duty: 0.5 }],
    ["F5", o + 0.3 + q, q, { vol: 12, decay: 8, duty: 0.5 }],
    ["E5", o + 0.3 + 2 * q, q, { vol: 12, decay: 8, duty: 0.5 }],
    ["Eb5", o + 0.3 + 3 * q, q * 1.3, { vol: 12, decay: 9, duty: 0.5 }],
    ["C4", o + 1.04, 0.95, { vol: 13, decay: 14, duty: 0.25, vibrato: true, fall: [0.3, 2], release: 0.12 }],
  ], "sq");
  voice(x, [
    ["C3", o + 0.3, q * 2, {}],
    ["B2", o + 0.3 + 2 * q, q * 2.3, {}],
    ["C2", o + 1.04, 0.95, { fall: [0.3, 2], release: 0.12 }],
  ], "tri");
  return finish(x);
}

const dir = process.argv[2] || "stings";
mkdirSync(dir, { recursive: true });
for (const [name, x] of [["game-over.wav", gameOver(false)], ["hang-up-game-over.wav", gameOver(true)]]) {
  writeFileSync(join(dir, name), CV.encodeWav(x, SR));
  console.log(`${join(dir, name)}  ${(x.length / SR).toFixed(2)} s`);
}
