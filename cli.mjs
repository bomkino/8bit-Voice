#!/usr/bin/env node
// Makes 8-bit Voice clips from the command line, with the same engine
// as the app (chipvoice.js), so a line sounds identical in both.
//
//   node cli.mjs "(offended) I never said I'd call." --voice heist-producer --phone
//   node cli.mjs --file lines.txt --voice space-director --phone --dir clips
//   node cli.mjs --file lines.txt --compare --dir compare
//   node cli.mjs --list
//
// Options
//   --voice <id>       a client preset or a machine (see --list)
//   --pitch <st>       semitones, -24 to 24
//   --speed <x>        0.4 to 2.5
//   --melody <0-1>     monotone to sing-song
//   --character <0-1>  the machine's own knob
//   --grit <0-1>       bit-crush
//   --phone            through a phone speaker
//   --take <n>         another performance of the same settings
//   --file <path>      one line per clip; blank lines are skipped
//   --compare          every line in all six machines
//   --lineup <path>    also write every clip into one file, with a gap between
//   --speaker <name>   used in file names
//   --json             write the timing (syllables, pitch, characters) next to each WAV
//   --out <file.wav>   for a single line
//   --dir <folder>     for several clips (default: clips)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

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

if (opts.help || (!words.length && !opts.file && !opts.list)) {
  const head = readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 31);
  console.log(head.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

if (opts.list) {
  console.log("Client presets");
  for (const id of CV.PRESET_ORDER) {
    const p = CV.PRESETS[id];
    console.log(`  ${id.padEnd(17)} ${p.episode.padEnd(5)} ${p.name}: ${p.note}`);
  }
  console.log("\nMachines");
  for (const id of CV.STYLE_ORDER) {
    const s = CV.STYLES[id];
    console.log(`  ${id.padEnd(17)} ${s.name}, ${s.era}. Character knob: ${s.character}.`);
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

const styles = opts.compare ? CV.STYLE_ORDER : [voice.style];
const who = opts.speaker ? CV.slug(opts.speaker, 16) + "-" : "";
const made = [];

for (const style of styles) {
  lines.forEach((line, i) => {
    const v = Object.assign({}, voice, { style });
    const r = CV.render(line, v);
    const name =
      lines.length === 1 && styles.length === 1 && opts.out
        ? opts.out
        : join(
            opts.dir || "clips",
            (opts.compare ? `${style}-` : "") +
              `${who}${String(i + 1).padStart(2, "0")}-${CV.slug(r.text, 36)}.wav`,
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
