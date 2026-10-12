#!/usr/bin/env node
// Makes 8-bit Voice clips from the command line, with the same engine
// as the app (chipvoice.js), so a line sounds identical in both.
//
//   node cli.mjs "(offended) You said WHAT about my hat?" --voice wizard --out hat.wav
//   node cli.mjs --file lines.txt --voice narrator --dir clips
//   node cli.mjs --file lines.txt --compare --dir compare
//   node cli.mjs --in me.wav --voice robot --out robot.wav
//   node cli.mjs --list
//
// Options
//   --voice <id>       a character or a machine (see --list)
//   --pitch <st>       semitones, -24 to 24
//   --speed <x>        0.4 to 2.5
//   --melody <0-1>     monotone to sing-song
//   --character <0-1>  the machine's own knob
//   --grit <0-1>       bit-crush
//   --phone            through a phone speaker
//   --take <n>         another performance of the same settings
//   --file <path>      one line per clip; blank lines are skipped
//   --in <file.wav>    say a recording again in the voice, instead of a line
//                      (16-bit, 24-bit or float WAV, mono or stereo); a line
//                      given with it is what the dialogue box and --json show
//   --compare          every line in every machine
//   --lineup <path>    also write every clip into one file, with a gap between
//   --speaker <name>   used in file names
//   --json             write the timing (syllables, pitch, characters) next to each WAV
//   --out <file.wav>   for a single line
//   --dir <folder>     for several clips (default: clips)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const require = createRequire(import.meta.url);
const CV = require("./chipvoice.js");

const argv = process.argv.slice(2);
const opts = {};
const words = [];
const FLAGS = new Set(["phone", "compare", "json", "list", "help"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (FLAGS.has(k)) opts[k] = true;
    else opts[k] = argv[++i];
  } else words.push(a);
}

if (opts.help || (!words.length && !opts.file && !opts.list && !opts.in)) {
  const src = readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
  const head = src.slice(0, src.findIndex((l) => !l.startsWith("//")));
  console.log(head.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

if (opts.list) {
  console.log("Characters");
  for (const id of CV.PRESET_ORDER) {
    const p = CV.PRESETS[id];
    console.log(`  ${id.padEnd(11)} ${p.name}, ${p.tag.toLowerCase()}. ${p.note}`);
  }
  console.log("\nMachines");
  for (const id of CV.STYLE_ORDER) {
    const s = CV.STYLES[id];
    console.log(`  ${id.padEnd(11)} ${s.name}, ${s.era}. Character knob: ${s.character}.`);
  }
  console.log("\nStage directions, in brackets before a line");
  console.log("  " + CV.MOOD_ORDER.map((k) => CV.MOODS[k].label.toLowerCase()).join(", "));
  console.log('  "very" pushes one further: (very fast and very high)');
  process.exit(0);
}

const base = opts.voice
  ? CV.PRESETS[opts.voice]
    ? CV.PRESETS[opts.voice].voice
    : CV.STYLES[opts.voice]
      ? { style: opts.voice }
      : fail(`Unknown voice "${opts.voice}". Run with --list to see them.`)
  : {};
const voice = CV.normVoice(
  Object.assign({}, base, {
    ...(opts.pitch != null && { pitch: +opts.pitch }),
    ...(opts.speed != null && { speed: +opts.speed }),
    ...(opts.melody != null && { melody: +opts.melody }),
    ...(opts.character != null && { character: +opts.character }),
    ...(opts.grit != null && { grit: +opts.grit }),
    ...(opts.phone && { phone: true }),
    ...(opts.take != null && { take: +opts.take }),
  }),
);

const lines = opts.file
  ? readFileSync(opts.file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  : [words.join(" ")];

// A recording is listened to once, then said in every voice asked for.
const rec = opts.in ? CV.analyzeRecording(...readWav(opts.in)) : null;
if (rec && lines.length > 1) fail("--in makes one clip; give it one line at most.");
const inName = opts.in ? CV.slug(basename(opts.in).replace(/\.wav$/i, ""), 36) : "";

const styles = opts.compare ? CV.STYLE_ORDER : [voice.style];
const who = opts.speaker ? CV.slug(opts.speaker, 16) + "-" : "";
const made = [];

for (const style of styles) {
  lines.forEach((line, i) => {
    const v = Object.assign({}, voice, { style });
    const r = rec ? CV.renderRecording(rec, v, { text: line }) : CV.render(line, v);
    const name =
      lines.length === 1 && styles.length === 1 && opts.out
        ? opts.out
        : join(
            opts.dir || "clips",
            (opts.compare ? `${style}-` : "") +
              (rec
                ? `${who}${inName}-${opts.voice ? CV.slug(opts.voice, 16) : style}.wav`
                : `${who}${String(i + 1).padStart(2, "0")}-${CV.slug(r.text, 36)}.wav`),
          );
    mkdirSync(dirname(name), { recursive: true });
    writeFileSync(name, CV.encodeWav(r.samples, r.sampleRate));
    if (opts.json) {
      const timing = {
        line,
        text: r.text,
        mood: r.mood,
        voice: r.voice,
        duration: +r.duration.toFixed(4),
        sampleRate: r.sampleRate,
        events: r.events.map((e) => ({
          t: +e.t.toFixed(4),
          d: +e.d.toFixed(4),
          chars: [e.c0, e.c1],
          pitch: [+e.p0.toFixed(2), +e.p1.toFixed(2)],
          level: +e.a.toFixed(3),
          cut: e.cut,
        })),
      };
      writeFileSync(name.replace(/\.wav$/, ".json"), JSON.stringify(timing, null, 2) + "\n");
    }
    made.push({ name, r });
    const mood = r.moodLabel ? ` (${r.moodLabel})` : "";
    console.log(`${name}  ${r.duration.toFixed(2)} s  ${CV.STYLES[style].name}${mood}`);
  });
}

if (opts.lineup) {
  const sr = CV.SAMPLE_RATE;
  const gap = Math.round(sr * 0.45);
  const total = made.reduce((s, m) => s + m.r.samples.length + gap, 0);
  const all = new Float32Array(total);
  let p = 0;
  for (const m of made) {
    all.set(m.r.samples, p);
    p += m.r.samples.length + gap;
  }
  mkdirSync(dirname(opts.lineup), { recursive: true });
  writeFileSync(opts.lineup, CV.encodeWav(all, sr));
  console.log(`${opts.lineup}  ${(total / sr).toFixed(2)} s  all clips in a row`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// Reads a WAV file: 8, 16, 24 or 32-bit PCM, or 32 or 64-bit float, any
// number of channels, mixed down to one. Returns [samples, sampleRate].
function readWav(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    fail(`Can't read ${path}.`);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => buf.toString("ascii", o, o + 4);
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") fail(`${path} isn't a WAV file.`);
  let fmt = null;
  let data = null;
  for (let o = 12; o + 8 <= buf.length; ) {
    const size = dv.getUint32(o + 4, true);
    if (tag(o) === "fmt ") {
      let code = dv.getUint16(o + 8, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in its sub-format GUID.
      if (code === 0xfffe && size >= 26) code = dv.getUint16(o + 32, true);
      fmt = { code, channels: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    } else if (tag(o) === "data") {
      data = { start: o + 8, size: Math.min(size, buf.length - o - 8) };
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) fail(`${path} has no audio in it.`);
  const { code, channels, rate, bits } = fmt;
  const float = code === 3;
  if (!(code === 1 && [8, 16, 24, 32].includes(bits)) && !(float && (bits === 32 || bits === 64))) {
    fail(`${path} is a kind of WAV this can't read (format ${code}, ${bits}-bit). Save it as 16-bit PCM.`);
  }
  const step = bits / 8;
  const n = Math.floor(data.size / (step * channels));
  const out = new Float32Array(n);
  const read = (p) => {
    if (float) return bits === 32 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
    if (bits === 8) return (dv.getUint8(p) - 128) / 128;
    if (bits === 16) return dv.getInt16(p, true) / 32768;
    if (bits === 24) return ((dv.getUint8(p + 2) << 24) | (dv.getUint8(p + 1) << 16) | (dv.getUint8(p) << 8)) / 2147483648;
    return dv.getInt32(p, true) / 2147483648;
  };
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(data.start + (i * channels + c) * step);
    out[i] = s / channels;
  }
  return [out, rate];
}
