// Checks the engine the app, the desktop builds and the CLI all share.
//   node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const CV = createRequire(import.meta.url)("../chipvoice.js");
const LINE = "(offended) You said WHAT about my hat?";

test("the same line, voice and take give the same clip, sample for sample", () => {
  const v = CV.normVoice({ style: "square", take: 3 });
  const a = CV.render(LINE, v).samples;
  const b = CV.render(LINE, v).samples;
  assert.equal(a.length, b.length);
  assert.ok(a.every((x, i) => x === b[i]));
});

test("a new take is a different performance", () => {
  const a = CV.render(LINE, CV.normVoice({ style: "square", take: 1 })).samples;
  const b = CV.render(LINE, CV.normVoice({ style: "square", take: 2 })).samples;
  assert.ok(a.length !== b.length || a.some((x, i) => x !== b[i]));
});

for (const style of CV.STYLE_ORDER) {
  test(`${style} makes sound and stays in range`, () => {
    const r = CV.render(LINE, CV.normVoice({ style }));
    assert.ok(r.duration > 0.3 && r.duration < 5, `duration ${r.duration}`);
    let peak = 0;
    for (const x of r.samples) peak = Math.max(peak, Math.abs(x));
    assert.ok(peak > 0.05, "too quiet");
    assert.ok(peak <= 1, "clips");
    assert.ok(r.events.length > 3, "no syllables");
  });
}

test("every preset names a machine that exists", () => {
  for (const id of CV.PRESET_ORDER) assert.ok(CV.STYLES[CV.normVoice(CV.PRESETS[id].voice).style], id);
});

test("WAV files are 48 kHz, 16-bit mono", () => {
  const r = CV.render("Hello?", CV.normVoice({}));
  const wav = CV.encodeWav(r.samples, r.sampleRate);
  const dv = new DataView(wav.buffer || wav);
  const tag = (o) => String.fromCharCode(...new Uint8Array(dv.buffer, dv.byteOffset + o, 4));
  assert.equal(tag(0), "RIFF");
  assert.equal(tag(8), "WAVE");
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint32(24, true), 48000);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.byteLength, 44 + r.samples.length * 2);
});

test("stage directions and punctuation are read", () => {
  const p = CV.parseLine("WIZARD: (slow, awed) ...That's the future.");
  assert.equal(p.speaker, "WIZARD");
  assert.ok(p.mood.keys.includes("slow") && p.mood.keys.includes("awed"));
  assert.ok(CV.render("Really?", CV.normVoice({})).events.length > 0);
});

test("every preset has a face, and every face draws", () => {
  const ctx = { fillRect() {}, fillStyle: "" };
  for (const id of CV.PRESET_ORDER) {
    const face = CV.PRESETS[id].face;
    assert.ok(CV.FACES[face], `${id} has no face`);
    assert.ok(CV.drawFace(ctx, face, 0, 0, { open: 1, blink: true }));
  }
  assert.equal(CV.drawFace(ctx, "nobody", 0, 0), false);
});

test("a portrait moves the text over", () => {
  const plain = CV.measureDialog({ text: "Hello there", width: 200 });
  const framed = CV.measureDialog({ text: "Hello there", width: 200, portrait: { face: "hero" } });
  assert.equal(plain.pw, 0);
  assert.ok(framed.pw > 16);
  assert.ok(framed.boxHeight >= 16 + 2);
});

test("Clarity turns the Mouth from gibberish into almost words", () => {
  const line = "Please open the door and let me in.";
  const clear = CV.render(line, { style: "mouth", character: 1 });
  const babble = CV.render(line, { style: "mouth", character: 0 });
  assert.equal(clear.events.length, babble.events.length, "same syllables, same timing");
  assert.ok(clear.samples.some((x, i) => x !== babble.samples[i]), "different sounds");
});

test("the Mouth copes with words that have no vowels, digits and odd spelling", () => {
  for (const line of ["Hmm. Shh! Brr...", "Room 101, level 7.", "Psst—rhythm gym, xylophone."]) {
    const r = CV.render(line, "narrator");
    let peak = 0;
    for (const x of r.samples) peak = Math.max(peak, Math.abs(x));
    assert.ok(peak > 0.05 && peak <= 1, line);
  }
});
