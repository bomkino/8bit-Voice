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

// A stand-in for a person: the narrator, resampled the way a 44.1 kHz file would be.
const SAID = "Hello there, how are you today?";
function recording(rate = 44100) {
  const r = CV.render(SAID, "narrator");
  const n = Math.round((r.samples.length * rate) / r.sampleRate);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i * r.sampleRate) / rate;
    const j = Math.floor(p);
    x[i] = r.samples[j] + ((r.samples[j + 1] || 0) - r.samples[j]) * (p - j);
  }
  return { x, rate, duration: r.duration };
}

test("listening to a recording finds its syllables, its length and its pitch", () => {
  const { x, rate, duration } = recording();
  const rec = CV.analyzeRecording(x, rate);
  assert.ok(Math.abs(rec.duration - duration) < 0.3, `duration ${rec.duration} vs ${duration}`);
  assert.ok(rec.syllables.length >= 6 && rec.syllables.length <= 10, `${rec.syllables.length} syllables, 8 said`);
  assert.ok(rec.pitch > 70 && rec.pitch < 200, `pitch ${rec.pitch}`);
  assert.equal(rec.k.length, rec.frames * rec.order);
  for (const s of rec.syllables) assert.ok(s.d > 0 && s.t >= 0 && s.t + s.d <= rec.duration + 1e-6);
});

test("every machine says a recording back, as long as it was, scaled by speed", () => {
  const { x, rate } = recording();
  const rec = CV.analyzeRecording(x, rate);
  for (const style of CV.STYLE_ORDER) {
    for (const speed of [1, 2]) {
      const r = CV.renderRecording(rec, { style, speed });
      let peak = 0;
      for (const s of r.samples) peak = Math.max(peak, Math.abs(s));
      assert.ok(peak > 0.05 && peak <= 1, `${style} peak ${peak}`);
      const want = rec.duration / speed;
      assert.ok(r.duration >= want - 0.05 && r.duration < want * 1.15 + (style === "boss" ? 0.8 : 0.2), `${style} ${r.duration} vs ${want}`);
      assert.equal(r.samples.length, Math.round(r.duration * r.sampleRate));
      assert.ok(r.events.length >= rec.syllables.length, `${style} events`);
      assert.deepEqual(r.mood, []);
    }
  }
});

test("a recording comes back the same every time, and a new take is different", () => {
  const { x, rate } = recording();
  const rec = CV.analyzeRecording(x, rate);
  for (const style of ["mouth", "chip", "babble"]) {
    const a = CV.renderRecording(rec, { style, take: 1 }).samples;
    const b = CV.renderRecording(CV.analyzeRecording(x, rate), { style, take: 1 }).samples;
    const c = CV.renderRecording(rec, { style, take: 2 }).samples;
    assert.ok(a.length === b.length && a.every((s, i) => s === b[i]), `${style} isn't repeatable`);
    assert.ok(a.length !== c.length || a.some((s, i) => s !== c[i]), `${style} take 2 is the same`);
  }
  const preset = CV.renderRecording(rec, "narrator");
  assert.equal(preset.voice.style, "mouth");
  // It survives a trip through JSON, to a file or a worker and back.
  const back = CV.renderRecording(JSON.parse(JSON.stringify(rec)), "narrator").samples;
  assert.ok(back.length === preset.samples.length && back.every((s, i) => s === preset.samples[i]));
});

test("the box types along with a recording", () => {
  const { x, rate } = recording();
  const rec = CV.analyzeRecording(x, rate);
  const r = CV.renderRecording(rec, "hero", { text: SAID });
  assert.equal(r.text, SAID);
  let last = 0;
  for (const e of r.events) {
    assert.ok(e.c0 >= last && e.c1 >= e.c0 && e.c1 <= SAID.length);
    last = e.c0;
  }
  assert.equal(r.events[0].c0, 0);
  assert.ok(r.events[r.events.length - 1].c1 >= SAID.lastIndexOf("y"));
  assert.ok(CV.revealTimes(r.text, r.events).every((t) => t >= 0 && t <= r.duration));
  const bare = CV.renderRecording(rec, "hero");
  assert.equal(bare.text, "");
  assert.ok(bare.events.every((e) => e.c0 === 0 && e.c1 === 0));
});

test("silence and very short recordings don't throw", () => {
  const inputs = [new Float32Array(0), new Float32Array(10), new Float32Array(24000), recording().x.slice(0, 1300)];
  for (const x of inputs) {
    const rec = CV.analyzeRecording(x, 44100);
    for (const style of CV.STYLE_ORDER) {
      const r = CV.renderRecording(rec, { style }, { text: "" });
      assert.ok(r.samples.length > 0 && r.samples.every((s) => Number.isFinite(s) && Math.abs(s) <= 1));
      assert.ok(Array.isArray(r.events));
      assert.equal(CV.talkLevel(r.events, 0.1) >= 0, true);
    }
  }
});
