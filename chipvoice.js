/*!
 * chipvoice.js · the engine behind 8-bit Voice, by pitch.dog
 * https://github.com/bomkino/8bit-Voice · MIT License
 *
 * Type a line and get it back as a video-game voice. The words stay unreadable;
 * the rhythm, the melody and the punctuation stay human, so anyone listening
 * can tell what was meant.
 *
 * Every sound is synthesized here from square, triangle and wavetable oscillators,
 * formant filters and noise. There are no samples, so there is nothing to license.
 * The same line, voice and take always give the same clip, sample for sample.
 *
 * Works as a <script> tag (window.ChipVoice), with require() in Node, and as an
 * import in a bundler such as Remotion's.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChipVoice = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.2.0';
  const SAMPLE_RATE = 48000;

  // ───────────────────────────── small utilities ─────────────────────────────

  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  const hashSigned = (s) => (hash32(s) / 4294967296) * 2 - 1;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const semis = (st) => Math.pow(2, st / 12);

  // Band-limited step correction for the pulse and saw oscillators.
  function blep(t, dt) {
    if (t < dt) {
      t /= dt;
      return t + t - t * t - 1;
    }
    if (t > 1 - dt) {
      t = (t - 1) / dt;
      return t * t + t + t + 1;
    }
    return 0;
  }

  // ───────────────────────────────── styles ─────────────────────────────────
  // Six different machines, not six pitches of one. Each has its own way of
  // turning text into sound; `character` is the one knob that means something
  // different in each.

  const STYLES = {
    square: {
      name: 'Square',
      era: 'NES square wave',
      blurb: 'Square-wave syllables that follow the words. Each vowel changes the tone.',
      character: 'Bite',
      characterHint: 'From pure blips to hissy consonants',
      unit: 'syl',
      baseHz: 196,
      rate: 7.4,
      melody: 1.0,
      decl: 3,
      jitter: 2.2,
      vowelPitch: 0.8,
      tick: 60,
      scale: null,
      legato: 0.1,
      wordGap: 0.03,
      pause: 1,
      leadIn: 0.05,
      tail: 0.2,
    },
    pocket: {
      name: 'Pocket',
      era: 'Game Boy wave channel',
      blurb: 'A 4-bit wavetable shaped like vowels. Buzzy, nasal and a little musical.',
      character: 'Nasal',
      characterHint: 'From round and mellow to pinched and buzzy',
      unit: 'syl',
      baseHz: 262,
      rate: 7.0,
      melody: 1.15,
      decl: 3,
      jitter: 2.6,
      vowelPitch: 0.6,
      tick: 60,
      scale: 'pentatonic',
      legato: 0.08,
      wordGap: 0.03,
      pause: 1,
      leadIn: 0.05,
      tail: 0.22,
    },
    babble: {
      name: 'Babble',
      era: 'Animal Crossing-style chatter',
      blurb: 'Every letter gets its own sound, very fast. Cute, chatty, unstoppable.',
      character: 'Squeak',
      characterHint: 'From a big animal to a very small one',
      unit: 'letter',
      baseHz: 300,
      rate: 15.5,
      melody: 1.0,
      decl: 3,
      jitter: 2.4,
      vowelPitch: 0.7,
      tick: 0,
      scale: null,
      legato: 0,
      wordGap: 0.035,
      pause: 0.9,
      leadIn: 0.04,
      tail: 0.15,
    },
    typewriter: {
      name: 'Typewriter',
      era: 'Undertale-style text blips',
      blurb: 'One blip per letter, steady as a text box. Deadpan by design.',
      character: 'Click',
      characterHint: 'From a soft boop to a sharp tick',
      unit: 'char',
      baseHz: 392,
      rate: 23,
      melody: 0.5,
      decl: 0,
      jitter: 2.5,
      vowelPitch: 0,
      tick: 60,
      scale: null,
      legato: 0,
      wordGap: 0,
      pause: 1,
      leadIn: 0.04,
      tail: 0.12,
    },
    boss: {
      name: 'Boss',
      era: 'Final-boss voice',
      blurb: 'Slow and deep, doubled an octave down, with the old echo-channel trick.',
      character: 'Menace',
      characterHint: 'From a stern voice to a demon with reverb',
      unit: 'syl',
      baseHz: 98,
      rate: 4.4,
      melody: 1.2,
      decl: 4,
      jitter: 2.0,
      vowelPitch: 0.7,
      tick: 60,
      scale: 'phrygian',
      legato: 0.05,
      wordGap: 0.05,
      pause: 1.25,
      leadIn: 0.05,
      tail: 0.75,
    },
    chip: {
      name: 'Speech chip',
      era: '80s arcade speech chip',
      blurb: 'A robot reading random phonemes, like Q*bert swearing. Almost words.',
      character: 'Buzz',
      characterHint: 'From a clean robot to a cheap toy',
      unit: 'syl',
      baseHz: 123,
      rate: 5.6,
      melody: 0.9,
      decl: 2,
      jitter: 2.0,
      vowelPitch: 0,
      tick: 0,
      scale: null,
      legato: 0.03,
      wordGap: 0.04,
      pause: 1,
      leadIn: 0.05,
      tail: 0.15,
    },
    mouth: {
      name: 'Mouth',
      era: '80s home-computer speech',
      blurb: 'A tiny throat and mouth that try to say your words. Turn Clarity up and you can almost make them out.',
      character: 'Clarity',
      characterHint: 'From cheerful gibberish to almost words',
      unit: 'syl',
      baseHz: 110,
      rate: 5.2,
      melody: 0.85,
      decl: 3.5,
      jitter: 1.5,
      vowelPitch: 0,
      tick: 0,
      scale: null,
      legato: 0,
      wordGap: 0.03,
      pause: 1.1,
      leadIn: 0.06,
      tail: 0.22,
    },
  };
  const STYLE_ORDER = ['square', 'pocket', 'babble', 'typewriter', 'boss', 'chip', 'mouth'];

  const SCALES = {
    pentatonic: [0, 2, 4, 7, 9],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };

  // ──────────────────────────────── presets ────────────────────────────────
  // The cast: fourteen characters, each a machine dialled in. Every knob stays
  // adjustable, and `face` names the portrait the app draws for them.

  const PRESETS = {
    hero: {
      name: 'Hero', tag: 'Adventure', face: 'hero',
      note: 'Brave, bright and a little out of breath.',
      voice: { style: 'square', pitch: 2, speed: 1.05, melody: 0.55, character: 0.55, grit: 0 },
    },
    wizard: {
      name: 'Old wizard', tag: 'Fantasy', face: 'wizard',
      note: 'Theatrical, loves a long vowel, hears violins.',
      voice: { style: 'pocket', pitch: -7, speed: 0.85, melody: 0.85, character: 0.3, grit: 0 },
    },
    villain: {
      name: 'Villain', tag: 'Boss fight', face: 'villain',
      note: 'Calm, deep and a little too pleased with the plan.',
      voice: { style: 'boss', pitch: 3, speed: 1.1, melody: 0.4, character: 0.45, grit: 0 },
    },
    sidekick: {
      name: 'Sidekick', tag: 'Cozy', face: 'sidekick',
      note: 'Bubbly, impatient, talks faster than they think.',
      voice: { style: 'babble', pitch: 0, speed: 1.05, melody: 0.65, character: 0.55, grit: 0 },
    },
    agent: {
      name: 'Secret agent', tag: 'Stealth', face: 'agent',
      note: 'Clipped and quick. Says everything like a code word.',
      voice: { style: 'square', pitch: -3, speed: 1.12, melody: 0.4, character: 0.75, grit: 0 },
    },
    computer: {
      name: 'Ship computer', tag: 'Sci-fi', face: 'computer',
      note: 'Calm and synthetic. Says it the same way every time.',
      voice: { style: 'chip', pitch: 0, speed: 1, melody: 0.55, character: 0.45, grit: 0 },
    },
    robot: {
      name: 'Robot', tag: 'Sci-fi', face: 'robot',
      note: 'Flat, buzzy and very slightly broken.',
      voice: { style: 'chip', pitch: -6, speed: 0.95, melody: 0.1, character: 0.8, grit: 0.35 },
    },
    fairy: {
      name: 'Fairy', tag: 'Fantasy', face: 'fairy',
      note: 'Tiny, sparkly and thrilled about everything.',
      voice: { style: 'babble', pitch: 10, speed: 1.2, melody: 0.85, character: 0.75, grit: 0 },
    },
    ghost: {
      name: 'Ghost', tag: 'Spooky', face: 'ghost',
      note: 'Floaty and wobbly. Takes its time.',
      voice: { style: 'pocket', pitch: 4, speed: 0.8, melody: 0.9, character: 0.6, grit: 0 },
    },
    golem: {
      name: 'Stone golem', tag: 'Boss fight', face: 'golem',
      note: 'Huge and slow. Every word is an earthquake.',
      voice: { style: 'boss', pitch: -9, speed: 0.78, melody: 0.25, character: 0.7, grit: 0.15 },
    },
    guard: {
      name: 'Guard', tag: 'Anywhere', face: 'guard',
      note: 'No time, no patience, no inflection.',
      voice: { style: 'typewriter', pitch: -4, speed: 1.15, melody: 0.15, character: 0.65, grit: 0 },
    },
    critter: {
      name: 'Villager', tag: 'Cozy', face: 'critter',
      note: 'Squeaky small talk, mostly about fruit.',
      voice: { style: 'babble', pitch: 7, speed: 1.15, melody: 0.7, character: 0.6, grit: 0 },
    },
    narrator: {
      name: 'Narrator', tag: 'Almost human', face: 'narrator',
      note: 'Warm and unhurried. You can almost make out the words.',
      voice: { style: 'mouth', pitch: 0, speed: 0.95, melody: 0.5, character: 0.92, grit: 0 },
    },
    henchling: {
      name: 'Henchling', tag: 'Gibberish', face: 'henchling',
      note: 'Small, loyal, sings everything. Loves bananas, probably.',
      voice: { style: 'mouth', pitch: 15, speed: 1.3, melody: 0.95, character: 0.08, grit: 0 },
    },
  };
  const PRESET_ORDER = ['hero', 'narrator', 'henchling', 'wizard', 'villain', 'sidekick', 'agent', 'computer', 'robot', 'fairy', 'ghost', 'golem', 'guard', 'critter'];

  const DEFAULT_VOICE = { style: 'square', pitch: 0, speed: 1, melody: 0.5, character: 0.5, grit: 0, phone: false, take: 1 };

  function normVoice(v) {
    if (typeof v === 'string') v = PRESETS[v] ? PRESETS[v].voice : { style: v };
    v = Object.assign({}, DEFAULT_VOICE, v || {});
    if (!STYLES[v.style]) v.style = 'square';
    const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
    return {
      style: v.style,
      pitch: clamp(num(v.pitch, 0), -24, 24),
      speed: clamp(num(v.speed, 1), 0.4, 2.5),
      melody: clamp(num(v.melody, 0.5), 0, 1),
      character: clamp(num(v.character, 0.5), 0, 1),
      grit: clamp(num(v.grit, 0), 0, 1),
      phone: !!v.phone,
      take: Math.max(1, Math.floor(num(v.take, 1))),
    };
  }

  // ───────────────────────────────── moods ─────────────────────────────────
  // Put the stage direction in brackets before a line, the way the scripts do:
  // "(8-bit, panicking, very fast and very high) How do you know what I'm—".
  // Directions combine, and "very" pushes one further.

  const MOODS = {
    whisper: { label: 'Whisper', re: /whisper/, tempo: 1.12, melody: 0.55, level: -6, whisper: true },
    quiet: { label: 'Quiet', re: /\b(quiet|quietly|soft|softly|murmur\w*|mutter\w*|hushed|under (his|her|their|my) breath)/, tempo: 1.08, melody: 0.7, pitch: -1, level: -3.5 },
    shout: { label: 'Shouting', re: /\b(shout\w*|yell\w*|scream\w*|angry|furious|loud|loudly|bellow\w*)/, tempo: 0.9, melody: 1.3, pitch: 3, level: 2.5, grit: 0.12 },
    awed: { label: 'Awed', re: /\b(awe|awed|amazed|in wonder|reverent|stunned|breathless)/, tempo: 1.22, melody: 1.2, pitch: 1, level: -1.5, vibrato: 1 },
    faster: { label: 'Faster and faster', re: /faster and faster|speeding up|accelerat/, accel: 0.55 },
    fast: { label: 'Fast', re: /\b(fast|quick|quickly|rapid|rapidly|hurried|rushed)\b/, tempo: 0.72 },
    slow: { label: 'Slow', re: /\b(slow|slowly|drawn out|tired|sleepy|drowsy)/, tempo: 1.35 },
    high: { label: 'High', re: /\b(high|squeaky|shrill|falsetto)\b/, pitch: 5 },
    low: { label: 'Low', re: /\b(low|deep|gravelly)\b/, pitch: -5 },
    flat: { label: 'Flat', re: /\b(flat|deadpan|monotone|bored|dry|dryly|unimpressed)/, melody: 0.12 },
    excited: { label: 'Excited', re: /\b(excited|thrilled|giddy|delighted|squeal\w*|happy)/, tempo: 0.88, melody: 1.45, pitch: 2, level: 1 },
    sad: { label: 'Sad', re: /\b(sad|sadly|sigh\w*|crying|tearful|defeated)/, tempo: 1.2, melody: 0.6, pitch: -2, level: -2 },
    offended: { label: 'Offended', re: /\b(offended|indignant|insulted|huffy|outraged)/, melody: 1.35, pitch: 2, level: 1 },
    panic: { label: 'Panicking', re: /\b(panic\w*|nervous|scared|terrified|frantic)/, tempo: 0.8, pitch: 2, vibrato: 1.2, melody: 1.15 },
  };
  const MOOD_ORDER = ['whisper', 'quiet', 'shout', 'awed', 'faster', 'fast', 'slow', 'high', 'low', 'flat', 'excited', 'sad', 'offended', 'panic'];

  // Returns { keys, very } for a direction such as "slow, awed".
  function moodFrom(direction) {
    const d = String(direction || '').toLowerCase();
    const keys = [];
    const very = {};
    for (const k of MOOD_ORDER) {
      const m = d.match(MOODS[k].re);
      if (!m) continue;
      if (k === 'fast' && keys.includes('faster')) continue;
      keys.push(k);
      if (/very\s+$|extremely\s+$|so\s+$/.test(d.slice(0, m.index))) very[k] = true;
    }
    return { keys, very };
  }

  // Folds a list of directions into one set of multipliers.
  function moodMix(mood) {
    if (typeof mood === 'string') mood = { keys: mood && mood !== 'normal' ? [mood] : [], very: {} };
    else if (Array.isArray(mood)) mood = { keys: mood, very: {} };
    mood = mood || { keys: [], very: {} };
    const out = { keys: [], tempo: 1, melody: 1, pitch: 0, level: 0, grit: 0, vibrato: 0, accel: 1, whisper: false };
    for (const k of mood.keys || []) {
      const m = MOODS[k];
      if (!m) continue;
      const x = mood.very && mood.very[k] ? 1.5 : 1;
      out.keys.push(k);
      if (m.tempo) out.tempo *= Math.pow(m.tempo, x);
      if (m.melody) out.melody *= Math.pow(m.melody, x);
      if (m.pitch) out.pitch += m.pitch * x;
      if (m.level) out.level += m.level;
      if (m.grit) out.grit += m.grit;
      if (m.vibrato) out.vibrato = Math.max(out.vibrato, m.vibrato);
      if (m.accel) out.accel = Math.min(out.accel, Math.pow(m.accel, x));
      if (m.whisper) out.whisper = true;
    }
    out.level = clamp(out.level, -8, 3);
    out.label = out.keys.map((k) => MOODS[k].label).join(' · ');
    return out;
  }

  // Accepts a line the way a script writes it: an optional SPEAKER: label and
  // optional (stage directions) in front. Returns the words that get voiced.
  function parseLine(raw) {
    let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    let speaker = null;
    let direction = '';
    const sp = s.match(/^([A-Z][A-Z0-9 .'’-]{2,30}?)\s*(\([^)]*\))?\s*:\s+/);
    if (sp && /[a-z]/.test(s.slice(sp[0].length))) {
      speaker = sp[1].trim();
      if (sp[2]) direction += sp[2].slice(1, -1) + ' ';
      s = s.slice(sp[0].length);
    }
    let m;
    while ((m = s.match(/^\(([^)]*)\)\s*/))) {
      direction += m[1] + ' ';
      s = s.slice(m[0].length);
    }
    direction = direction.trim();
    // "(8-bit, speakerphone)" puts that line through the phone speaker.
    const phone = /speaker ?phone|on (the |a )?phone|over the phone|on speaker/i.test(direction);
    return { text: s, mood: moodFrom(direction), direction, speaker, phone };
  }

  // ───────────────────────────── text analysis ─────────────────────────────

  const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
  const FUNCTION_WORDS = new Set([
    'a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'is', 'it', 'its', 'i', 'im',
    'you', 'me', 'my', 'we', 'be', 'so', 'but', 'as', 'by', 'if', 'am', 'are', 'was', 'he', 'she', 'they',
  ]);
  const UNSTRESSED_PREFIX = new Set(['a', 'be', 'de', 're', 'to', 'un', 'con', 'com', 'ex', 'pro', 'per', 'en']);
  const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  function sepType(sep, isEnd) {
    if (/…|\.\s?\.\s?\./.test(sep)) return 'trail';
    const q = sep.includes('?');
    const e = sep.includes('!');
    if (q && e) return 'qexclaim';
    if (q) return 'question';
    if (e) return 'exclaim';
    if (/[—–]|--/.test(sep) || (isEnd && /-\s*$/.test(sep))) return isEnd ? 'cut' : 'dash';
    if (sep.includes('.')) return 'stop';
    if (/[;:]/.test(sep)) return 'semi';
    if (sep.includes(',')) return 'comma';
    if (!isEnd && /^[-‐]$/.test(sep)) return 'join';
    return isEnd ? 'stop' : 'space';
  }

  function syllabify(w) {
    const n = w.length;
    if (!n) return [];
    const isV = new Array(n);
    for (let i = 0; i < n; i++) isV[i] = 'aeiou'.includes(w[i]);
    for (let i = 0; i < n; i++) {
      if (w[i] === 'y') isV[i] = !(i === 0 || (i + 1 < n && 'aeiou'.includes(w[i + 1])));
      if (w[i] === 'u' && i > 0 && w[i - 1] === 'q') isV[i] = false;
    }
    const groups = [];
    for (let i = 0; i < n; ) {
      if (isV[i]) {
        let j = i;
        while (j < n && isV[j]) j++;
        groups.push([i, j]);
        i = j;
      } else i++;
    }
    if (!groups.length) return [{ s: 0, e: n, onset: w, nucleus: '', coda: '', magicE: false }];
    let magicE = false;
    const last = groups[groups.length - 1];
    if (groups.length > 1 && last[0] === n - 1 && w[n - 1] === 'e' && !(w[n - 2] === 'l' && n > 2 && !isV[n - 3])) {
      groups.pop();
      const prevG = groups[groups.length - 1];
      magicE = prevG[1] - prevG[0] === 1 && n - 1 - prevG[1] === 1;
    }
    const KEEP = ['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'qu', 'tr', 'pr', 'br', 'cr', 'dr', 'gr', 'fr', 'pl', 'bl', 'cl', 'gl', 'fl', 'sl', 'st', 'sp', 'sc', 'sk', 'sm', 'sn', 'sw', 'tw'];
    const out = [];
    let start = 0;
    for (let g = 0; g < groups.length; g++) {
      const [vs, ve] = groups[g];
      let end;
      if (g === groups.length - 1) end = n;
      else {
        const cons = w.slice(ve, groups[g + 1][0]);
        let k = 0;
        if (cons.length > 1) k = KEEP.includes(cons.slice(-2)) ? cons.length - 2 : cons.length - 1;
        end = ve + k;
      }
      out.push({
        s: start,
        e: end,
        onset: w.slice(start, vs),
        nucleus: w.slice(vs, ve),
        coda: w.slice(ve, end),
        magicE: g === groups.length - 1 && magicE,
      });
      start = end;
    }
    return out;
  }

  const VOW = {
    a: { st: 0, duty: 0.5, tri: 0.0, F: [780, 1250, 2550] },
    e: { st: 1.5, duty: 0.25, tri: 0.0, F: [520, 1850, 2550] },
    i: { st: 3, duty: 0.125, tri: 0.0, F: [320, 2250, 2950] },
    o: { st: -1.5, duty: 0.5, tri: 0.4, F: [520, 900, 2450] },
    u: { st: -2.5, duty: 0.25, tri: 0.65, F: [340, 820, 2250] },
    '@': { st: -0.5, duty: 0.25, tri: 0.15, F: [560, 1400, 2450] },
  };
  const VOWEL_PAIRS = {
    ee: ['i'], ea: ['i'], ie: ['i'], ei: ['e', 'i'], ey: ['e', 'i'], ai: ['e', 'i'], ay: ['e', 'i'],
    oo: ['u'], ou: ['a', 'u'], ow: ['a', 'u'], oa: ['o'], oe: ['o'], oi: ['o', 'i'], oy: ['o', 'i'],
    au: ['o'], aw: ['o'], ue: ['u'], ui: ['u'], eu: ['i', 'u'], ew: ['i', 'u'], ia: ['i', 'a'], io: ['i', 'o'],
    ua: ['u', 'a'], uo: ['u', 'o'],
  };
  function vowelClasses(nuc, magicE) {
    if (!nuc) return ['@'];
    if (nuc.length >= 2 && VOWEL_PAIRS[nuc.slice(0, 2)]) return VOWEL_PAIRS[nuc.slice(0, 2)];
    const c = nuc[0] === 'y' ? 'i' : nuc[0];
    if (magicE) return { a: ['e', 'i'], i: ['a', 'i'], o: ['o', 'u'], u: ['i', 'u'], e: ['i'] }[c] || [c];
    return [VOW[c] ? c : '@'];
  }

  function consTokens(str, isOnset, nextVowel) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      const c2 = str.slice(i, i + 2);
      if (c2 === 'ch' || c2 === 'sh' || c2 === 'th' || c2 === 'ng') { out.push(c2); i++; continue; }
      if (c2 === 'ph') { out.push('f'); i++; continue; }
      if (c2 === 'wh') { out.push('w'); i++; continue; }
      if (c2 === 'ck') { out.push('k'); i++; continue; }
      if (c2 === 'gh') { if (isOnset && i === 0) out.push('g'); i++; continue; }
      if (c2 === 'qu') { out.push('k', 'w'); i++; continue; }
      if (c === 'q') { out.push('k'); continue; }
      if (c === 'x') { out.push('k', 's'); continue; }
      if (c === 'c') { const nx = str[i + 1] || nextVowel || ''; out.push('eiy'.includes(nx) ? 's' : 'k'); continue; }
      if (i > 0 && c === str[i - 1]) continue;
      if (CONS[c]) out.push(c);
    }
    return out;
  }

  function analyze(text) {
    const words = [];
    let m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) words.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
    for (let i = 0; i < words.length; i++) {
      const a = i === 0 ? 0 : words[i - 1].end;
      words[i].before = text.slice(a, words[i].start);
    }
    const trailing = words.length ? text.slice(words[words.length - 1].end) : text;
    const lettersInLine = (text.match(/\p{L}/gu) || []).length;
    const upperInLine = (text.match(/\p{Lu}/gu) || []).length;
    const allCaps = lettersInLine >= 4 && upperInLine / lettersInLine > 0.8;

    for (const w of words) {
      let letters = '';
      const map = [];
      for (let k = 0; k < w.raw.length; k++) {
        const ch = w.raw[k];
        if (ch === "'" || ch === '’') continue;
        let base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        if (!/^[a-z0-9]+$/.test(base)) base = /\p{L}/u.test(ch) ? 'tanesirolu'[hash32(ch) % 10] : '';
        for (const b of base) {
          letters += b;
          map.push(w.start + k);
        }
      }
      w.lower = letters;
      w.map = map;
      const lettersOnly = w.raw.replace(/[^\p{L}]/gu, '');
      w.caps = !allCaps && lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase() && lettersOnly !== lettersOnly.toLowerCase();
      w.func = FUNCTION_WORDS.has(letters);
      // Digits become their names, all pointing back at the digit itself.
      const syl = [];
      let run = '';
      let runMap = [];
      const flush = () => {
        if (!run) return;
        for (const s of syllabify(run)) {
          syl.push(Object.assign(s, { c0: runMap[s.s], c1: runMap[Math.max(s.s, s.e - 1)] + 1, letters: run.slice(s.s, s.e), lmap: runMap.slice(s.s, s.e) }));
        }
        run = '';
        runMap = [];
      };
      for (let k = 0; k < letters.length; k++) {
        const ch = letters[k];
        if (/[0-9]/.test(ch)) {
          flush();
          const name = DIGIT_NAMES[+ch];
          for (const s of syllabify(name)) {
            syl.push(Object.assign(s, { c0: map[k], c1: map[k] + 1, letters: name.slice(s.s, s.e), lmap: new Array(s.e - s.s).fill(map[k]) }));
          }
        } else {
          run += ch;
          runMap.push(map[k]);
        }
      }
      flush();
      // Stress: first syllable, unless it is a weak prefix.
      let stressAt = 0;
      if (syl.length > 1 && UNSTRESSED_PREFIX.has(syl[0].letters)) stressAt = 1;
      syl.forEach((s, i) => {
        s.stressed = syl.length > 1 && i === stressAt && !w.func;
        const nextV = (s.nucleus || '')[0] || '';
        s.onsetT = consTokens(s.onset, true, nextV);
        s.codaT = consTokens(s.coda, false, '');
        s.vowels = vowelClasses(s.nucleus, s.magicE);
        s.text = s.letters;
      });
      w.syl = syl;
    }

    // Phrases end at punctuation; the punctuation decides the melody.
    const phrases = [];
    let w0 = 0;
    for (let i = 0; i < words.length; i++) {
      const isLast = i === words.length - 1;
      const type = isLast ? sepType(trailing, true) : sepType(words[i + 1].before, false);
      words[i].after = type;
      if (isLast || (type !== 'space' && type !== 'join')) {
        phrases.push({ w0, w1: i + 1, type });
        w0 = i + 1;
      }
    }
    const leadingTrail = words.length > 0 && /…|\.\s?\.\s?\./.test(words[0].before);
    return { text, words, phrases, leadingTrail, allCaps };
  }

  // ────────────────────────────── consonants ──────────────────────────────
  // How the chip machines say each consonant: a burst on the noise channel
  // [period index, volume 0-15, ticks], a pitch kick into the vowel, or a
  // nasal hum or a glide from another pitch.

  const CONS = {
    p: { noise: [6, 9, 1], kick: 3 },
    t: { noise: [2, 10, 1], kick: 3 },
    k: { noise: [4, 10, 1], kick: 2.5 },
    ch: { noise: [3, 9, 2], kick: 2, short: true },
    b: { noise: [8, 4, 1], kick: -3, overlap: true },
    d: { noise: [5, 4, 1], kick: -2.5, overlap: true },
    g: { noise: [7, 4, 1], kick: -3, overlap: true },
    j: { noise: [3, 5, 1], kick: -2, overlap: true },
    s: { noise: [1, 7, 2], pre: true },
    sh: { noise: [3, 6, 2], pre: true },
    f: { noise: [5, 3, 2], pre: true },
    th: { noise: [6, 3, 1], pre: true },
    h: { noise: [8, 3, 1], pre: true, soft: true },
    z: { noise: [2, 4, 1], overlap: true, buzz: true },
    v: { noise: [6, 3, 1], overlap: true, buzz: true },
    m: { hum: [-1.5, 1] },
    n: { hum: [-1, 1] },
    ng: { hum: [-2, 1] },
    l: { glide: [-1.5, 2], duty: 0.25 },
    r: { glide: [-2.5, 2], duty: 0.125 },
    w: { glide: [-4, 2], duty: 0.5 },
    y: { glide: [3, 2], duty: 0.125 },
  };

  // ─────────────────────────────── planning ───────────────────────────────
  // Turns text into timed units (syllables, letters or characters) with a
  // pitch path and a level. The melody comes from the punctuation: statements
  // fall, questions rise, commas lift, ellipses trail off, a dash cuts the
  // last syllable short.

  const PAUSE = { comma: 0.17, semi: 0.24, stop: 0.32, exclaim: 0.3, question: 0.34, qexclaim: 0.34, trail: 0.52, dash: 0.14, cut: 0 };
  const FINAL_LEN = { comma: 1.2, semi: 1.25, stop: 1.35, exclaim: 1.3, question: 1.45, qexclaim: 1.45, trail: 1.8, dash: 1, cut: 1 };
  const CHAR_PAUSE = { comma: 6, semi: 8, stop: 10, exclaim: 10, question: 10, qexclaim: 10, trail: 16, dash: 5, cut: 0 };

  function quantize(st, scale) {
    const degs = SCALES[scale];
    if (!degs) return st;
    const oct = Math.floor(st / 12);
    const r = st - oct * 12;
    let best = 0;
    let bd = 99;
    for (const d of degs.concat([12])) {
      if (Math.abs(r - d) < bd) {
        bd = Math.abs(r - d);
        best = d;
      }
    }
    return oct * 12 + best;
  }

  function letterToken(letters, i) {
    const c = letters[i];
    if (c === 'c') return 'eiy'.includes(letters[i + 1] || '') ? 's' : 'k';
    if (c === 'q') return 'k';
    if (c === 'x') return 'k';
    if (c === 'y') return 'aeiou'.includes(letters[i + 1] || '') ? 'y' : null;
    return CONS[c] ? c : null;
  }

  function plan(input, voiceIn, opts) {
    opts = opts || {};
    const line = typeof input === 'string' ? parseLine(input) : input;
    const text = line.text || '';
    const voice = normVoice(voiceIn);
    if (line.phone) voice.phone = true;
    const S = STYLES[voice.style];
    const M = moodMix(opts.mood != null ? opts.mood : line.mood);
    const an = analyze(text);
    const R = mulberry(hash32(text + '\u0001' + voice.style + '\u0001' + voice.take));
    const salt = voice.take > 1 ? '#' + voice.take : '';
    const mel = S.melody * (0.15 + 1.7 * voice.melody) * M.melody;

    // Gather the units of each phrase first, so "faster and faster" knows how
    // far through the line each one is.
    const phraseItems = an.phrases.map((ph) => {
      const items = [];
      for (let wi = ph.w0; wi < ph.w1; wi++) {
        const w = an.words[wi];
        w.syl.forEach((s, si) => {
          const base = { word: wi, wordStart: si === 0, wordEnd: si === w.syl.length - 1, stressed: s.stressed, func: w.func, caps: w.caps };
          if (S.unit === 'syl') {
            items.push(Object.assign({}, base, {
              kind: 'syl', key: s.text, c0: s.c0, c1: s.c1, onset: s.onsetT, coda: s.codaT, vowels: s.vowels, n: s.letters.length,
              src: { letters: s.letters, onset: s.onset, nucleus: s.nucleus, coda: s.coda, magicE: s.magicE, word: w.lower, si, ns: w.syl.length, keys: w.syl.map((x) => x.letters), stressed: s.stressed, func: w.func },
            }));
          } else if (S.unit === 'letter') {
            const L = s.letters;
            for (let li = 0; li < L.length; li++) {
              const isVowel = 'aeiou'.includes(L[li]) || (L[li] === 'y' && !letterToken(L, li));
              const tok = isVowel ? null : letterToken(L, li);
              items.push(Object.assign({}, base, {
                kind: 'letter', key: L[li] + L, c0: s.lmap[li], c1: s.lmap[li] + 1,
                onset: tok ? [tok] : [], coda: [], vowels: isVowel ? vowelClasses(L[li] === 'y' ? 'i' : L[li], false) : [s.vowels[0]],
                isVowel, wordStart: base.wordStart && li === 0, wordEnd: base.wordEnd && li === L.length - 1, n: 1,
              }));
            }
          }
        });
        if (S.unit === 'char') {
          for (let k = w.start; k < w.end; k++) {
            const ch = text[k];
            if (!/[\p{L}\p{N}]/u.test(ch)) continue;
            items.push({ kind: 'char', key: ch.toLowerCase() + k, c0: k, c1: k + 1, word: wi, wordStart: k === w.start, wordEnd: k === w.end - 1, caps: w.caps, stressed: false, func: w.func, onset: [], coda: [], vowels: [], n: 1 });
          }
        }
      }
      return items;
    });
    const total = phraseItems.reduce((s, a) => s + a.length, 0);

    const units = [];
    let g = 0;
    let t = S.leadIn + (an.leadingTrail ? 0.14 * (M.tempo / voice.speed) : 0);
    an.phrases.forEach((ph, phi) => {
      const items = phraseItems[phi];
      const N = items.length;
      const type = ph.type;
      let tempo = M.tempo / voice.speed;
      items.forEach((it, k) => {
        tempo = (M.tempo / voice.speed) * lerp(1, M.accel, total > 1 ? g / (total - 1) : 0);
        g++;
        const charDur = (1 / S.rate) * tempo;
        const x = N > 1 ? k / (N - 1) : 1;
        const isLast = k === N - 1;
        // Melody, in semitones above or below the voice's base.
        let p = S.decl * mel * (0.5 - x);
        p += hashSigned(it.key + salt) * S.jitter * mel;
        if (it.vowels.length) p += VOW[it.vowels[0]].st * S.vowelPitch;
        if (it.stressed) p += 1.2 * mel;
        if (it.func) p -= 0.6 * mel;
        if (it.caps) p += 3;
        if (type === 'exclaim' || type === 'qexclaim') p += 1.5 * mel + 0.5;
        if ((type === 'question' || type === 'qexclaim') && k === N - 2) p -= 0.8 * mel;
        let p1 = p + (R() - 0.5) * 0.3 * mel;
        let final = null;
        if (isLast && S.unit !== 'char') {
          final = type;
          if (type === 'stop') p1 = p - 3.2 * mel;
          else if (type === 'exclaim') { p += 1.2 * mel; p1 = p - 2.5 * mel; }
          else if (type === 'question' || type === 'qexclaim') p1 = p + 5.5 * mel;
          else if (type === 'trail') p1 = p - 4.5 * mel;
          else if (type === 'comma') p1 = p + 1.6 * mel;
          else if (type === 'semi') p1 = p - 1.2 * mel;
          else p1 = p;
        }
        if (S.unit === 'char') {
          p = hashSigned(it.key + salt) * S.jitter * mel + (it.caps ? 2 : 0);
          if (isLast && (type === 'question' || type === 'qexclaim')) p += 2;
          p1 = p - 1.5;
        }
        p += M.pitch;
        p1 += M.pitch;
        if (S.scale) {
          p = quantize(p, S.scale);
          p1 = quantize(p1, S.scale);
        }

        // Level.
        let a = 1;
        if (it.stressed) a *= 1.12;
        if (it.func) a *= 0.9;
        if (it.caps) a *= 1.25;
        if (type === 'exclaim' || type === 'qexclaim') a *= 1.12;
        if (isLast && type === 'trail') a *= 0.78;
        if (isLast && type === 'stop') a *= 0.94;
        a *= 1 + (R() - 0.5) * 0.08;

        // Length.
        let d;
        let gap;
        if (S.unit === 'char') {
          d = charDur;
          gap = it.wordEnd ? charDur : 0;
        } else if (S.unit === 'letter') {
          d = charDur * (it.isVowel ? 1.15 : 0.85) * (it.stressed ? 1.06 : 1) * (it.caps ? 1.1 : 1) * (isLast ? FINAL_LEN[type] * 1.15 : 1);
          d *= 1 + (R() - 0.5) * 0.1;
          gap = it.wordEnd ? S.wordGap * tempo : 0.004;
        } else {
          const weight = clamp(0.62 + 0.11 * (it.n - 2), 0.6, 1.45);
          d = charDur * weight * (it.stressed ? 1.08 : 1) * (it.func ? 0.82 : 1) * (it.caps ? 1.15 : 1) * (isLast ? FINAL_LEN[type] : 1);
          d *= 1 + (R() - 0.5) * 0.1;
          gap = S.legato * d + (it.wordEnd ? S.wordGap * tempo : 0);
        }
        // A line cut off by a dash gets a syllable long enough to hear it stop.
        if (isLast && (type === 'cut' || type === 'dash') && S.unit !== 'char') d = Math.max(d, 0.12 * Math.min(1, tempo * 1.4));
        if (units.length === 0 && an.leadingTrail) {
          d *= 1.2;
          a *= 0.85;
        }

        units.push({
          kind: it.kind, t, d, c0: it.c0, c1: it.c1, p0: p, p1, amp: a, final,
          cut: isLast && (type === 'cut' || type === 'dash'),
          onset: it.onset, coda: it.coda, vowels: it.vowels, stressed: it.stressed, caps: it.caps, key: it.key, isVowel: it.isVowel, src: it.src,
        });
        t += d + (isLast ? 0 : gap);
      });
      if (phi < an.phrases.length - 1) {
        t += S.unit === 'char' ? (CHAR_PAUSE[type] || 0) * (1 / S.rate) * tempo : (PAUSE[type] || 0) * S.pause * Math.pow(tempo, 0.75);
      }
    });

    // The chip machines run on a 60 Hz frame clock, like a console's sound
    // driver: every unit starts and stops on a frame.
    if (S.tick) {
      let cursor = 0;
      for (const u of units) {
        const k0 = Math.max(cursor, Math.round(u.t * S.tick));
        const kd = Math.max(2, Math.round(u.d * S.tick));
        u.t = k0 / S.tick;
        u.d = kd / S.tick;
        cursor = k0 + kd;
      }
    }
    const last = units[units.length - 1];
    const end = last ? last.t + last.d : 0.3;
    const duration = end + (last && last.cut ? 0.06 : S.tail);
    return { version: VERSION, text, mood: M, voice, style: voice.style, units, duration };
  }

  // ─────────────────────────── the chip machines ───────────────────────────
  // A tiny console sound chip: two pulse channels, a 32-step triangle, a
  // 15-bit LFSR noise channel and a 4-bit wavetable channel. Registers are
  // written once per 60 Hz frame and the oscillators run at the sample rate,
  // which is what makes glides step and envelopes tick like the real thing.

  const NES_CPU = 1789773;
  const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
  const WHISPER_NOISE = { i: 1, e: 2, a: 3, o: 4, u: 5, '@': 3 };

  function makeTracks(n) {
    const ch = () => ({ f: new Float32Array(n), v: new Float32Array(n), d: new Float32Array(n).fill(0.5), m: new Uint8Array(n) });
    return { n, p1: ch(), p2: ch(), tri: ch(), noi: ch(), wav: ch() };
  }
  function setCh(c, k, f, v, d, m) {
    if (k < 0 || k >= c.f.length) return;
    c.f[k] = f;
    c.v[k] = clamp(Math.round(v), 0, 15);
    if (d != null) c.d[k] = d;
    if (m != null) c.m[k] = m;
  }
  function setNoise(T, k, period, v, short) {
    if (k < 0 || k >= T.n) return;
    T.noi.f[k] = clamp(period, 0, 15);
    T.noi.v[k] = clamp(Math.round(v), 0, 15);
    T.noi.m[k] = short ? 1 : 0;
  }
  const nesFreq = (f) => {
    const p = clamp(Math.round(NES_CPU / (16 * f) - 1), 8, 2047);
    return NES_CPU / (16 * (p + 1));
  };

  function renderTracks(T, tick, sr, mix, tables, gbVolume) {
    const N = Math.ceil((T.n * sr) / tick);
    const out = new Float32Array(N);
    let ph1 = 0, ph2 = 0, pht = 0, phw = 0;
    let lfsr = 1, nacc = 0, nout = 0;
    let s1 = 0, s2 = 0, st = 0, sn = 0, sw = 0;
    const vs = 1 - Math.exp(-1 / (0.0007 * sr));
    const gbLevel = (v) => (v >= 11 ? 1 : v >= 6 ? 0.5 : v >= 2 ? 0.25 : 0);
    for (let i = 0; i < N; i++) {
      const k = Math.min(T.n - 1, ((i * tick) / sr) | 0);
      let s = 0;
      let c = T.p1;
      s1 += (c.v[k] / 15 - s1) * vs;
      if (c.f[k] > 0) {
        const dt = c.f[k] / sr;
        ph1 += dt;
        ph1 -= Math.floor(ph1);
        if (s1 > 1e-4) {
          const d = c.d[k];
          let x = ph1 < d ? 1 : -1;
          x += blep(ph1, dt);
          x -= blep((ph1 - d + 1) % 1, dt);
          s += (x - (2 * d - 1)) * s1 * mix.p1;
        }
      }
      c = T.p2;
      s2 += (c.v[k] / 15 - s2) * vs;
      if (c.f[k] > 0) {
        const dt = c.f[k] / sr;
        ph2 += dt;
        ph2 -= Math.floor(ph2);
        if (s2 > 1e-4) {
          const d = c.d[k];
          let x = ph2 < d ? 1 : -1;
          x += blep(ph2, dt);
          x -= blep((ph2 - d + 1) % 1, dt);
          s += (x - (2 * d - 1)) * s2 * mix.p2;
        }
      }
      c = T.tri;
      st += (c.v[k] / 15 - st) * vs;
      if (c.f[k] > 0) {
        pht += c.f[k] / sr;
        pht -= Math.floor(pht);
        if (st > 1e-4) {
          const step = (pht * 32) | 0;
          const q = step < 16 ? 15 - step : step - 16;
          s += (q / 7.5 - 1) * st * mix.tri;
        }
      }
      c = T.noi;
      sn += (c.v[k] / 15 - sn) * vs;
      if (sn > 1e-4) {
        nacc += NES_CPU / NOISE_PERIODS[c.f[k] | 0] / sr;
        let sum = 0, cnt = 0;
        while (nacc >= 1) {
          nacc -= 1;
          const bit = (lfsr ^ (lfsr >> (c.m[k] ? 6 : 1))) & 1;
          lfsr = (lfsr >> 1) | (bit << 14);
          sum += lfsr & 1 ? -1 : 1;
          cnt++;
        }
        if (cnt) nout = sum / cnt;
        s += nout * sn * mix.noi;
      }
      if (tables) {
        c = T.wav;
        const target = gbVolume ? gbLevel(c.v[k]) : c.v[k] / 15;
        sw += (target - sw) * vs;
        if (c.f[k] > 0) {
          phw += c.f[k] / sr;
          phw -= Math.floor(phw);
          if (sw > 1e-4) s += tables[c.m[k]][(phw * 32) | 0] * sw * mix.wav;
        }
      }
      out[i] = s;
    }
    return out;
  }

  // Game Boy-style 4-bit wavetables, one per vowel. Harmonics are weighted by
  // the vowel's formants, then the wave is crushed to 32 steps of 16 levels.
  const VOWEL_INDEX = { a: 0, e: 1, i: 2, o: 3, u: 4, '@': 5 };
  function vowelTables(nasal) {
    const order = ['a', 'e', 'i', 'o', 'u', '@'];
    return order.map((v) => {
      const F = VOW[v].F;
      const f0 = 260;
      const bw = [110 + 120 * nasal, 140 + 160 * nasal, 220 + 200 * nasal];
      const g = [1, 0.7 + 0.2 * nasal, 0.35 + 0.5 * nasal];
      const amps = [];
      for (let h = 1; h <= 15; h++) {
        const fh = h * f0;
        let a = 0.12 / Math.pow(h, 0.9);
        for (let k = 0; k < 3; k++) a += g[k] / (1 + Math.pow((fh - F[k]) / bw[k], 2));
        if (nasal > 0) a += (0.6 * nasal) / (1 + Math.pow((fh - 2700) / 300, 2)) - 0.25 * nasal * (h === 1 ? 1 : 0);
        amps.push(Math.max(0, a));
      }
      const wave = new Float32Array(32);
      let mx = 0;
      for (let n = 0; n < 32; n++) {
        let x = 0;
        for (let h = 1; h <= 15; h++) x += amps[h - 1] * Math.cos((2 * Math.PI * h * n) / 32 + (h % 3 === 2 ? 1.1 : 0));
        wave[n] = x;
        mx = Math.max(mx, Math.abs(x));
      }
      for (let n = 0; n < 32; n++) {
        const q = Math.round(((wave[n] / mx + 1) / 2) * 15);
        wave[n] = q / 7.5 - 1;
      }
      return wave;
    });
  }

  function writeChipSyllable(T, u, o) {
    const tick = o.tick;
    const bite = o.bite;
    const k0 = Math.round(u.t * tick);
    const kd = Math.max(2, Math.round(u.d * tick));
    const on = u.onset || [];
    const co = u.coda || [];
    const A = clamp(u.amp * 0.8, 0.15, 1);
    const peak = Math.max(2, Math.round(15 * A));
    const V0 = o.voiceCh;
    const c1 = CONS[on[0]];
    const cL = CONS[on[on.length - 1]];
    let pre = 0, kick = 0, glide = 0, glideT = 0, sDuty = null, hum = 0, humSt = 0, soft = 0;
    if (c1 && c1.noise && bite > 0.03) {
      const [pi, vol, nt] = c1.noise;
      const nv = Math.round(vol * (0.3 + 0.9 * bite) * (0.6 + 0.4 * A));
      const n = Math.min(nt, Math.max(1, kd - 2));
      for (let j = 0; j < n; j++) setNoise(T, k0 + j, pi + (o.noiseShift || 0), Math.max(1, nv - 2 * j), !!c1.short);
      if (c1.pre) pre = Math.min(n, kd - 2);
      else if (!c1.overlap) pre = Math.min(1, kd - 2);
    }
    if (cL) {
      if (cL.kick) kick = cL.kick * (0.35 + 0.9 * bite);
      if (cL.glide) {
        glide = cL.glide[0];
        glideT = cL.glide[1];
        sDuty = cL.duty;
      }
      if (cL.hum && kd > 3) {
        hum = 1;
        humSt = cL.hum[0];
      }
      if (cL.soft) soft = 3;
    }
    let codaKind = null;
    let codaTok = null;
    if (!u.cut && co.length) {
      const cc = CONS[co[co.length - 1]];
      if (cc) {
        codaTok = cc;
        if (cc.hum) codaKind = 'nasal';
        else if (cc.noise && (cc.pre || cc.buzz)) codaKind = 'fric';
        else if (cc.noise) codaKind = 'stop';
        else if (cc.glide) codaKind = 'liquid';
      }
    }
    let codaT = codaKind === 'stop' || codaKind === 'fric' || codaKind === 'nasal' ? 2 : 0;
    let vT = kd - pre - hum - codaT;
    while (vT < 2 && codaT > 0) {
      codaT--;
      vT++;
    }
    if (vT < 1) vT = 1;
    if (u.cut) vT = Math.max(1, Math.round(vT * 0.62));
    const vowels = u.vowels && u.vowels.length ? u.vowels : ['@'];
    const fq = (st) => (o.nes ? nesFreq(o.base * semis(st)) : o.base * semis(st));
    let k = k0 + pre;
    if (hum) {
      setCh(V0, k, fq(u.p0 + humSt), Math.max(1, peak - 6), 0.5, VOWEL_INDEX['@']);
      k++;
    }
    let lastSt = u.p0;
    let sustain = peak;
    for (let j = 0; j < vT; j++, k++) {
      const q = vT > 1 ? j / (vT - 1) : 0;
      const vi = vowels.length > 1 && q >= 0.5 ? 1 : 0;
      const V = VOW[vowels[vi]] || VOW['@'];
      let st = u.p0 + (u.p1 - u.p0) * (u.final ? Math.pow(q, 1.6) : q);
      st += V.st * o.vowelPitch;
      if (j < 2 && kick) st += kick * (j === 0 ? 1 : 0.4);
      if (j < glideT) st += glide * (1 - (j + 1) / (glideT + 1));
      if (codaKind === 'liquid' && j >= vT - 2) st -= 1;
      const ts = j / tick;
      if (o.vib && ts > 0.13) st += o.vib * Math.sin(2 * Math.PI * 5.6 * (ts - 0.13)) * Math.min(1, (ts - 0.13) / 0.12);
      lastSt = st;
      let vol = peak - (j === 0 ? soft : 0) - Math.floor(j / 2);
      vol = Math.max(vol, Math.max(2, peak - 5));
      sustain = vol;
      if (j === vT - 1 && !u.cut && vT > 2) vol = Math.max(1, vol - 4);
      const duty = j < glideT && sDuty != null ? sDuty : V.duty;
      const f = fq(st);
      if (o.whisper) {
        setNoise(T, k, WHISPER_NOISE[vowels[vi]] || 3, Math.max(1, vol - 3), false);
      } else {
        const triAmt = o.triMix ? V.tri * o.triMix : 0;
        setCh(V0, k, f, vol * (1 - 0.35 * triAmt), duty, VOWEL_INDEX[vowels[vi]]);
        if (triAmt > 0) setCh(T.tri, k, f, vol * triAmt, 0.5);
        if (o.layers) o.layers(T, k, f, vol, j, vT);
      }
    }
    if (codaKind === 'nasal') {
      for (let j = 0; j < codaT; j++, k++) {
        if (o.whisper) setNoise(T, k, 6, Math.max(1, sustain - 8), false);
        else setCh(V0, k, fq(lastSt + codaTok.hum[0]), Math.max(1, sustain - 6 - 2 * j), 0.5, VOWEL_INDEX['@']);
      }
    } else if (codaKind === 'stop') {
      k++;
      setNoise(T, k, codaTok.noise[0] + (o.noiseShift || 0), Math.round(codaTok.noise[1] * 0.55 * (0.3 + 0.9 * bite)), !!codaTok.short);
    } else if (codaKind === 'fric') {
      for (let j = 0; j < codaT; j++, k++) {
        setNoise(T, k, codaTok.noise[0] + (o.noiseShift || 0), Math.max(1, Math.round(codaTok.noise[1] * (0.6 - 0.25 * j) * (0.3 + 0.9 * bite))), !!codaTok.short);
      }
    }
  }

  // ─────────────────────────────── filters ───────────────────────────────

  function onePoleLP(x, sr, fc) {
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += (x[i] - y) * a;
      x[i] = y;
    }
    return x;
  }
  function onePoleHP(x, sr, fc) {
    const a = Math.exp((-2 * Math.PI * fc) / sr);
    let xp = 0, y = 0;
    for (let i = 0; i < x.length; i++) {
      y = a * (y + x[i] - xp);
      xp = x[i];
      x[i] = y;
    }
    return x;
  }
  function biquad(type, f, q, sr) {
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  function runBQ(s, x) {
    const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
    s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
    return y;
  }
  function setBP(s, f, q, sr) {
    const w = (2 * Math.PI * clamp(f, 40, sr * 0.45)) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    s.b0 = al / a0; s.b1 = 0; s.b2 = -al / a0; s.a1 = (-2 * c) / a0; s.a2 = (1 - al) / a0;
  }
  function filterBQ(x, s) {
    for (let i = 0; i < x.length; i++) x[i] = runBQ(s, x[i]);
    return x;
  }
  // Hold every sample for a while and drop bits: the sound of cheap hardware.
  function crush(x, sr, rate, bits) {
    const step = sr / rate;
    const levels = Math.pow(2, bits - 1);
    let acc = 0, held = 0;
    for (let i = 0; i < x.length; i++) {
      acc += 1;
      if (acc >= step || i === 0) {
        acc -= step;
        if (acc < 0 || acc >= step) acc = 0;
        held = Math.round(clamp(x[i], -1, 1) * levels) / levels;
      }
      x[i] = held;
    }
    return x;
  }

  // ───────────────────────────── the machines ─────────────────────────────

  function synthChip(pl, sr, kind) {
    const v = pl.voice;
    const S = STYLES[pl.style];
    const tick = S.tick;
    const T = makeTracks(Math.ceil(pl.duration * tick) + 2);
    const base = S.baseHz * semis(v.pitch);
    const c = v.character;
    const whisper = pl.mood.whisper;
    const vib = 0.35 * pl.mood.vibrato + (kind === 'pocket' ? 0.3 : kind === 'boss' ? 0.28 : 0.1);
    const o = { tick, base, whisper, vib, vowelPitch: S.vowelPitch, nes: kind !== 'pocket' };
    let mix;
    let tables = null;
    if (kind === 'square') {
      Object.assign(o, { voiceCh: T.p1, bite: c, triMix: 1 });
      mix = { p1: 0.5, p2: 0.35, tri: 0.55, noi: 0.42, wav: 0 };
    } else if (kind === 'pocket') {
      Object.assign(o, { voiceCh: T.wav, bite: 0.55, triMix: 0 });
      tables = vowelTables(c);
      mix = { p1: 0.4, p2: 0.3, tri: 0.4, noi: 0.36, wav: 0.75 };
    } else {
      // boss
      const menace = c;
      Object.assign(o, {
        voiceCh: T.p1, bite: 0.5, triMix: 0, noiseShift: 2,
        layers(TT, k, f, vol) {
          setCh(TT.tri, k, f / 2, vol * 0.95, 0.5);
          if (menace > 0.15) setCh(TT.p2, k, f * 0.5 * 1.4983, vol * 0.55 * menace, 0.25);
          if (menace > 0.25 && TT.noi.v[k] === 0) setNoise(TT, k, 12 + (k & 1), 1 + 2.2 * menace, false);
        },
      });
      mix = { p1: 0.42, p2: 0.32, tri: 0.75, noi: 0.4, wav: 0 };
    }
    for (const u of pl.units) writeChipSyllable(T, u, o);
    let out = renderTracks(T, tick, sr, mix, tables, kind === 'pocket');
    if (kind === 'pocket') {
      onePoleHP(out, sr, 60);
      onePoleLP(out, sr, 9000);
    } else {
      onePoleHP(out, sr, kind === 'boss' ? 30 : 90);
      onePoleLP(out, sr, 12000);
    }
    if (kind === 'boss') {
      // The echo-channel trick: the same line again, later and quieter.
      const m = c;
      const taps = [[0.19, 0.3 + 0.25 * m], [0.38, 0.12 + 0.18 * m], [0.57, 0.08 * m]];
      const src = Float32Array.from(out);
      const lp = biquad('lp', 2600, 0.7, sr);
      const echo = new Float32Array(out.length);
      for (let i = 0; i < out.length; i++) echo[i] = runBQ(lp, src[i]);
      for (const [dly, g] of taps) {
        const D = Math.round(dly * sr);
        for (let i = D; i < out.length; i++) out[i] += echo[i - D] * g;
      }
    }
    return out;
  }

  function synthTypewriter(pl, sr) {
    const v = pl.voice;
    const S = STYLES.typewriter;
    const N = Math.ceil(pl.duration * sr);
    const out = new Float32Array(N);
    const base = S.baseHz * semis(v.pitch);
    const click = v.character;
    const blipLen = lerp(0.065, 0.024, click);
    const duty = lerp(0.5, 0.14, click);
    const whisper = pl.mood.whisper;
    let seed = hash32(pl.text) | 1;
    for (const u of pl.units) {
      const len = Math.min(blipLen, u.d * 0.95 + 0.01);
      const n0 = Math.round(u.t * sr);
      const n1 = Math.min(N, n0 + Math.round(len * sr));
      const f0 = base * semis(u.p0);
      const f1 = base * semis(u.p1);
      const A = clamp(u.amp, 0.3, 1.3) * 0.75;
      const tau = len / 3;
      let ph = 0;
      for (let n = n0; n < n1; n++) {
        const tt = (n - n0) / sr;
        const q = tt / len;
        const f = f0 * Math.pow(f1 / f0, q);
        const dt = f / sr;
        ph += dt;
        ph -= Math.floor(ph);
        let x;
        if (whisper) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          x = ((seed >>> 0) / 4294967296) * 2 - 1;
          x *= 0.7;
        } else {
          x = ph < duty ? 1 : -1;
          x += blep(ph, dt);
          x -= blep((ph - duty + 1) % 1, dt);
          x -= 2 * duty - 1;
        }
        const env = Math.min(1, tt / 0.001) * Math.exp(-tt / tau) * Math.min(1, (len - tt) / 0.003);
        out[n] += x * env * A;
      }
    }
    onePoleHP(out, sr, 120);
    onePoleLP(out, sr, whisper ? 5000 : 10000);
    return out;
  }

  // A small formant voice for Babble and the speech chip: a buzzy source
  // through three resonances that move from sound to sound, plus filtered noise.
  function renderFormant(ctrl, sr, src) {
    const blk = Math.max(1, Math.round(sr / ctrl.rate));
    const N = ctrl.n * blk;
    const out = new Float32Array(N);
    const f = [biquad('bp', 500, 5, sr), biquad('bp', 1500, 10, sr), biquad('bp', 2500, 12, sr)];
    const nb = biquad('bp', 3000, 1, sr);
    const bw = src.bw || [80, 100, 150];
    const gains = src.gains || [1, 0.65, 0.3];
    let ph = 0;
    let seed = (src.seed | 0) || 0x9e3779b9;
    const sm = { F1: ctrl.F1[0], F2: ctrl.F2[0], F3: ctrl.F3[0], nf: ctrl.nf[0] };
    const aF = 1 - Math.exp(-1 / ((src.smooth || 0.008) * ctrl.rate));
    for (let fi = 0; fi < ctrl.n; fi++) {
      sm.F1 += (ctrl.F1[fi] - sm.F1) * aF;
      sm.F2 += (ctrl.F2[fi] - sm.F2) * aF;
      sm.F3 += (ctrl.F3[fi] - sm.F3) * aF;
      sm.nf += (ctrl.nf[fi] - sm.nf) * 0.6;
      setBP(f[0], sm.F1, sm.F1 / bw[0], sr);
      setBP(f[1], sm.F2, sm.F2 / bw[1], sr);
      setBP(f[2], sm.F3, sm.F3 / bw[2], sr);
      setBP(nb, sm.nf, ctrl.nq[fi] || 1, sr);
      const nx = Math.min(fi + 1, ctrl.n - 1);
      for (let j = 0; j < blk; j++) {
        const a = j / blk;
        const f0 = lerp(ctrl.f0[fi], ctrl.f0[nx], src.stepPitch ? 0 : a);
        const av = lerp(ctrl.av[fi], ctrl.av[nx], a);
        const an = lerp(ctrl.an[fi], ctrl.an[nx], a);
        const dt = f0 / sr;
        ph += dt;
        ph -= Math.floor(ph);
        let s;
        if (src.saw) {
          s = 2 * ph - 1 - blep(ph, dt);
          const d = src.duty;
          let pu = ph < d ? 1 : -1;
          pu += blep(ph, dt);
          pu -= blep((ph - d + 1) % 1, dt);
          s = lerp(s, pu - (2 * d - 1), src.pulseMix);
        } else {
          const d = src.duty;
          s = ph < d ? 1 : -1;
          s += blep(ph, dt);
          s -= blep((ph - d + 1) % 1, dt);
          s -= 2 * d - 1;
        }
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const wn = ((seed >>> 0) / 4294967296) * 2 - 1;
        const vsrc = s * av;
        let y = gains[0] * runBQ(f[0], vsrc) + gains[1] * runBQ(f[1], vsrc) + gains[2] * runBQ(f[2], vsrc);
        y += (src.direct || 0) * vsrc;
        y += runBQ(nb, wn * an) * 1.6;
        out[fi * blk + j] = y;
      }
    }
    return out;
  }

  function makeCtrl(n, rate) {
    const z = () => new Float32Array(n);
    const c = { n, rate, f0: z(), av: z(), an: z(), F1: z(), F2: z(), F3: z(), nf: z(), nq: z() };
    c.F1.fill(500); c.F2.fill(1500); c.F3.fill(2500); c.nf.fill(3000); c.nq.fill(1);
    return c;
  }

  const SOFT_CONS = {
    p: { noise: [1500, 0.7, 0.5], frac: 0.25 },
    t: { noise: [4500, 0.9, 0.55], frac: 0.22 },
    k: { noise: [2500, 1.0, 0.5], frac: 0.25 },
    b: { noise: [800, 0.7, 0.22], voiced: 0.4, frac: 0.2 },
    d: { noise: [3000, 0.8, 0.22], voiced: 0.4, frac: 0.2 },
    g: { noise: [2000, 1.0, 0.22], voiced: 0.4, frac: 0.2 },
    s: { noise: [6500, 1.6, 0.6], frac: 0.4 },
    sh: { noise: [3000, 1.8, 0.55], frac: 0.4 },
    f: { noise: [7000, 0.6, 0.22], frac: 0.35 },
    th: { noise: [6000, 0.5, 0.18], frac: 0.3 },
    h: { noise: [1800, 0.4, 0.22], frac: 0.3 },
    z: { noise: [6000, 1.5, 0.35], voiced: 0.4, frac: 0.35 },
    v: { noise: [5000, 0.6, 0.16], voiced: 0.45, frac: 0.3 },
    ch: { noise: [3200, 1.5, 0.55], frac: 0.35 },
    j: { noise: [3000, 1.5, 0.35], voiced: 0.4, frac: 0.3 },
    m: { F: [280, 1100, 2300], voiced: 0.55, frac: 0.35 },
    n: { F: [280, 1600, 2500], voiced: 0.55, frac: 0.3 },
    ng: { F: [280, 2000, 2600], voiced: 0.5, frac: 0.3 },
    l: { F: [380, 1050, 2600], voiced: 0.65, frac: 0.3 },
    r: { F: [420, 1250, 1650], voiced: 0.65, frac: 0.3 },
    w: { F: [320, 700, 2300], voiced: 0.6, frac: 0.3 },
    y: { F: [280, 2300, 3000], voiced: 0.6, frac: 0.25 },
  };

  function synthBabble(pl, sr) {
    const v = pl.voice;
    const S = STYLES.babble;
    const rate = 500;
    const ctrl = makeCtrl(Math.ceil(pl.duration * rate) + 2, rate);
    const base = S.baseHz * semis(v.pitch);
    const squeak = lerp(0.92, 1.45, v.character);
    const whisper = pl.mood.whisper;
    let lastF = VOW.a.F;
    for (const u of pl.units) {
      const i0 = Math.round(u.t * rate);
      const i1 = Math.max(i0 + 2, Math.round((u.t + u.d) * rate));
      const L = i1 - i0;
      const V = VOW[u.vowels[0]] || VOW['@'];
      const C = u.onset.length ? SOFT_CONS[u.onset[0]] : null;
      const frac = C ? C.frac : 0;
      for (let i = i0; i < i1 && i < ctrl.n; i++) {
        const q = (i - i0) / Math.max(1, L - 1);
        const inC = C && q < frac;
        const st = u.p0 + (u.p1 - u.p0) * q - 1.1 * q;
        ctrl.f0[i] = base * semis(st);
        const F = inC && C.F ? C.F : V.F;
        ctrl.F1[i] = F[0] * squeak;
        ctrl.F2[i] = F[1] * squeak;
        ctrl.F3[i] = F[2] * squeak;
        const att = Math.min(1, (i - i0 + 1) / 3);
        const rel = Math.min(1, (i1 - i) / 5);
        const env = att * rel * (0.82 + 0.18 * (1 - q));
        let av = inC ? (C.voiced || 0.04) : 1;
        let an = 0;
        if (inC && C.noise) {
          an = C.noise[2];
          ctrl.nf[i] = C.noise[0] * Math.sqrt(squeak);
          ctrl.nq[i] = C.noise[1];
        }
        if (whisper) {
          an = Math.max(an, 0.35);
          av = 0;
          ctrl.nf[i] = F[1] * squeak;
          ctrl.nq[i] = 1.2;
        }
        ctrl.av[i] = av * env * u.amp;
        ctrl.an[i] = an * env * u.amp;
      }
      lastF = V.F;
    }
    void lastF;
    const out = renderFormant(ctrl, sr, { duty: 0.3, bw: [70 * squeak, 90 * squeak, 140 * squeak], gains: [1, 0.75, 0.35], direct: 0.06, smooth: 0.006, seed: hash32(pl.text) });
    onePoleHP(out, sr, 100);
    crush(out, sr, 22050, 8);
    onePoleLP(out, sr, 9000);
    return out;
  }

  // The speech chip reads made-up phonemes: each syllable is swapped, by a
  // hash, for another one, so it sounds like words without being any.
  const CHIP_ONSETS = ['b', 'd', 'g', 'k', 'p', 't', 'm', 'n', 'l', 'r', 's', 'z', 'f', 'v', 'sh', 'h', 'w', 'y'];
  const CHIP_VOWELS = [['a'], ['e'], ['i'], ['o'], ['u'], ['a', 'i'], ['a', 'u'], ['e', 'i'], ['o', 'u'], ['@'], ['a'], ['o']];
  const CHIP_CODAS = ['n', 'm', 's', 't', 'k', 'l', 'r', 'z', 'p', 'd'];

  function synthSpeechChip(pl, sr) {
    const v = pl.voice;
    const S = STYLES.chip;
    const rate = 500;
    const ctrl = makeCtrl(Math.ceil(pl.duration * rate) + 2, rate);
    const base = S.baseHz * semis(v.pitch);
    const buzz = v.character;
    const whisper = pl.mood.whisper;
    const salt = '|chip' + v.take;
    const tempo = pl.mood.tempo / v.speed;
    for (const u of pl.units) {
      const h = hash32(u.key + salt);
      const onset = u.onset.length || h & 64 ? [CHIP_ONSETS[h % CHIP_ONSETS.length]] : [];
      const vow = CHIP_VOWELS[(h >>> 9) % CHIP_VOWELS.length];
      const coda = u.coda.length && !u.cut ? [CHIP_CODAS[(h >>> 15) % CHIP_CODAS.length]] : [];
      // The chip has four pitch levels and holds each one: stepped, robotic.
      const lvl = (st) => clamp(Math.round((st + 3) / 2), 0, 3) * 2 - 3;
      const i0 = Math.round(u.t * rate);
      const i1 = Math.max(i0 + 4, Math.round((u.t + u.d) * rate));
      const segs = [];
      const cd = (x) => Math.round(x * tempo * rate);
      for (const c of onset) segs.push({ c, len: CONS[c] && CONS[c].noise && !CONS[c].pre ? cd(0.05) : cd(0.065) });
      const codaLen = coda.length ? cd(0.055) : 0;
      const used = segs.reduce((s, x) => s + x.len, 0);
      let vlen = i1 - i0 - used - codaLen;
      if (vlen < cd(0.06)) vlen = cd(0.06);
      if (u.cut) vlen = Math.max(4, Math.round(vlen * 0.6));
      const half = vow.length > 1 ? Math.round(vlen / 2) : vlen;
      segs.push({ v: vow[0], len: half, st: lvl(u.p0) });
      if (vow.length > 1) segs.push({ v: vow[1], len: vlen - half, st: lvl(u.final ? u.p1 : u.p0) });
      for (const c of coda) segs.push({ c, len: codaLen });
      let i = i0;
      for (const sg of segs) {
        for (let j = 0; j < sg.len; j++, i++) {
          if (i < 0 || i >= ctrl.n) continue;
          const env = Math.min(1, (j + 1) / 2) * Math.min(1, (sg.len - j) / 2);
          const pst = sg.st != null ? sg.st : lvl(u.p0);
          ctrl.f0[i] = base * semis(pst);
          if (sg.v) {
            const F = VOW[sg.v].F;
            ctrl.F1[i] = F[0]; ctrl.F2[i] = F[1]; ctrl.F3[i] = F[2];
            ctrl.av[i] = whisper ? 0 : u.amp * env;
            ctrl.an[i] = whisper ? 0.4 * u.amp * env : 0;
            if (whisper) { ctrl.nf[i] = F[1]; ctrl.nq[i] = 1.4; }
          } else {
            const C = SOFT_CONS[sg.c] || SOFT_CONS.t;
            const stop = CONS[sg.c] && CONS[sg.c].noise && !CONS[sg.c].pre && !CONS[sg.c].buzz;
            if (C.F) { ctrl.F1[i] = C.F[0]; ctrl.F2[i] = C.F[1]; ctrl.F3[i] = C.F[2]; }
            if (stop) {
              const burst = j >= sg.len * 0.6;
              ctrl.av[i] = burst ? 0 : (C.voiced || 0) * 0.25 * u.amp;
              ctrl.an[i] = burst ? C.noise[2] * 0.8 * u.amp : 0;
              ctrl.nf[i] = C.noise[0]; ctrl.nq[i] = C.noise[1];
            } else {
              ctrl.av[i] = whisper ? 0 : (C.voiced || 0) * u.amp * env;
              ctrl.an[i] = C.noise ? C.noise[2] * 0.65 * u.amp * env : 0;
              if (C.noise) { ctrl.nf[i] = C.noise[0]; ctrl.nq[i] = C.noise[1]; }
            }
          }
        }
      }
    }
    const out = renderFormant(ctrl, sr, { saw: true, duty: 0.18, pulseMix: 0.35 + 0.5 * buzz, bw: [90, 110, 160], gains: [1, 0.7, 0.4], direct: 0.1 + 0.25 * buzz, smooth: 0.004, stepPitch: true, seed: hash32(pl.text + 'chip') });
    onePoleHP(out, sr, 110);
    crush(out, sr, lerp(11025, 7000, buzz), buzz > 0.6 ? 6 : 8);
    onePoleLP(out, sr, lerp(5200, 3600, buzz));
    return out;
  }

  // ─────────────────────────────── the mouth ───────────────────────────────
  // A small model of a throat and a mouth, the way the talking computers of
  // the 80s worked: a glottal pulse through five resonances (the formants)
  // that glide from sound to sound, with noise for the hisses and the pops.
  // Letters become speech sounds through a few dozen spelling rules and a
  // short list of common words. Clarity decides how many of those sounds are
  // the real ones; the rest are swapped, by a hash, for a made-up language,
  // so at the bottom of the knob it is cheerful gibberish that still sounds
  // like somebody talking.

  // Vowel targets: F1, F2, F3 in Hz for an adult voice.
  const MV = {
    iy: [270, 2290, 3010], ih: [390, 1990, 2550], ei: [450, 2060, 2650], eh: [530, 1840, 2480],
    ae: [660, 1720, 2410], aa: [730, 1090, 2440], ao: [570, 840, 2410], oh: [490, 910, 2350],
    uh: [440, 1020, 2240], uw: [300, 870, 2240], ah: [640, 1190, 2390], ax: [500, 1450, 2500],
    er: [490, 1350, 1690],
  };
  const MDIPH = { ey: ['ei', 'iy'], ay: ['aa', 'iy'], aw: ['aa', 'uw'], ow: ['oh', 'uw'], oy: ['ao', 'iy'] };
  const isMV = (p) => !!(MV[p] || MDIPH[p]);

  // Consonants: how each one is made. F is where the formants point while the
  // mouth makes it (so the vowel next door bends towards it); fric and burst
  // are [centre Hz, bandwidth Hz, level].
  const MC = {
    p: { k: 'stop', F: [400, 900, 2100], burst: [1100, 2000, 0.45], asp: 1 },
    b: { k: 'stop', voiced: 1, F: [300, 900, 2100], burst: [1000, 2000, 0.22] },
    t: { k: 'stop', F: [400, 1700, 2600], burst: [4200, 2500, 0.6], asp: 1 },
    d: { k: 'stop', voiced: 1, F: [300, 1700, 2600], burst: [3800, 2500, 0.3] },
    k: { k: 'stop', F: [400, 0, 0], burst: [2300, 900, 0.65], asp: 1 },
    g: { k: 'stop', voiced: 1, F: [300, 0, 0], burst: [2100, 900, 0.32] },
    f: { k: 'fric', F: [400, 1100, 2100], fric: [7000, 5000, 0.13] },
    v: { k: 'fric', voiced: 1, F: [300, 1100, 2100], fric: [6000, 5000, 0.08] },
    th: { k: 'fric', F: [400, 1400, 2700], fric: [6500, 5000, 0.11] },
    dh: { k: 'fric', voiced: 1, F: [300, 1400, 2700], fric: [5500, 5000, 0.06] },
    s: { k: 'fric', F: [400, 1700, 2700], fric: [5600, 1400, 0.5] },
    z: { k: 'fric', voiced: 1, F: [300, 1700, 2700], fric: [5400, 1400, 0.3] },
    sh: { k: 'fric', F: [400, 1900, 2400], fric: [2900, 1500, 0.5] },
    zh: { k: 'fric', voiced: 1, F: [300, 1900, 2400], fric: [2800, 1500, 0.3] },
    h: { k: 'h' },
    ch: { k: 'aff', F: [400, 1900, 2400], burst: [3400, 2000, 0.5], fric: [2900, 1500, 0.45] },
    j: { k: 'aff', voiced: 1, F: [300, 1900, 2400], burst: [3200, 2000, 0.25], fric: [2800, 1500, 0.28] },
    m: { k: 'nasal', F: [250, 1000, 2200] },
    n: { k: 'nasal', F: [250, 1650, 2600] },
    ng: { k: 'nasal', F: [250, 2100, 2700] },
    l: { k: 'liq', F: [360, 1150, 2800] },
    r: { k: 'liq', F: [330, 1060, 1450] },
    w: { k: 'liq', F: [290, 620, 2150] },
    y: { k: 'liq', F: [260, 2100, 3000] },
  };

  // Common words, which spelling rules get wrong. Syllables split with "/".
  const MLEX = (() => {
    const src = 'a=ax an=ae n the=dh ax to=t uw too=t uw two=t uw of=ax v and=ae n d or=ao r for=f ao r from=f r ah m ' +
      'in=ih n on=aa n at=ae t is=ih z it=ih t its=ih t s as=ae z was=w ah z are=aa r be=b iy been=b ih n i=ay im=ay m ' +
      'ill=ay l ive=ay v id=ay d me=m iy my=m ay you=y uw your=y ao r youre=y ao r we=w iy he=h iy she=sh iy ' +
      'they=dh ey them=dh eh m their=dh eh r there=dh eh r theyre=dh eh r this=dh ih s that=dh ae t thats=dh ae t s ' +
      'these=dh iy z those=dh ow z then=dh eh n than=dh ae n with=w ih dh what=w ah t whats=w ah t s who=h uw ' +
      'why=w ay how=h aw where=w eh r when=w eh n do=d uw does=d ah z dont=d ow n t done=d ah n one=w ah n ' +
      'once=w ah n s some=s ah m come=k ah m have=h ae v has=h ae z had=h ae d give=g ih v live=l ih v ' +
      'love=l ah v said=s eh d says=s eh z know=n ow no=n ow so=s ow go=g ow oh=ow ok=ow/k ey okay=ow/k ey ' +
      'yes=y eh s yeah=y eh hi=h ay hey=h ey hello=h ax/l ow bye=b ay good=g uh d great=g r ey t could=k uh d ' +
      'would=w uh d should=sh uh d were=w er word=w er d work=w er k world=w er l d eye=ay eyes=ay z ' +
      'people=p iy/p ax l very=v eh/r iy only=ow n/l iy any=eh/n iy many=m eh/n iy every=eh v/r iy ' +
      'again=ax/g eh n water=w ao/t er over=ow/v er after=ae f/t er never=n eh/v er ever=eh/v er ' +
      'little=l ih/t ax l really=r iy/l iy something=s ah m/th ih ng nothing=n ah/th ih ng because=b ih/k ah z ' +
      'today=t ax/d ey tonight=t ax/n ay t friend=f r eh n d friends=f r eh n d z time=t ay m now=n aw ' +
      'right=r ay t night=n ay t light=l ay t think=th ih ng k thank=th ae ng k thanks=th ae ng k s ' +
      'please=p l iy z sorry=s aa/r iy wait=w ey t want=w aa n t need=n iy d see=s iy look=l uh k ' +
      'here=h iy r hear=h iy r put=p uh t push=p uh sh pull=p uh l full=f uh l call=k ao l all=ao l ' +
      'talk=t ao k walk=w ao k other=ah/dh er mother=m ah/dh er brother=b r ah/dh er father=f aa/dh er ' +
      'money=m ah/n iy guy=g ay buy=b ay busy=b ih/z iy door=d ao r floor=f l ao r four=f ao r ' +
      'pretty=p r ih/t iy move=m uw v whose=h uw z also=ao l/s ow always=ao l/w ey z around=ax/r aw n d ' +
      'about=ax/b aw t into=ih n/t uw just=j ah s t not=n aa t can=k ae n cant=k ae n t will=w ih l ' +
      'get=g eh t got=g aa t make=m ey k take=t ey k like=l ay k say=s ey way=w ey day=d ey play=p l ey ' +
      'game=g ey m games=g ey m z lets=l eh t s our=aw er hour=aw er us=ah s if=ih f up=ah p but=b ah t ' +
      'out=aw t ' + 'mister=m ih s/t er hero=h iy/r ow treasure=t r eh/zh er princess=p r ih n/s eh s ' +
      'castle=k ae/s ax l kingdom=k ih ng/d ax m quest=k w eh s t level=l eh/v ax l world=w er l d';
    const lex = {};
    let word = null;
    let phones = '';
    const flush = () => { if (word) lex[word] = phones.split('/').map((x) => x.trim().split(/\s+/)); };
    for (const tok of src.trim().split(/\s+/)) {
      if (tok.includes('=')) {
        flush();
        [word, phones] = tok.split('=');
      } else phones += ' ' + tok;
    }
    flush();
    return lex;
  })();

  // Splits a run of phonemes into onset, vowels and coda.
  function splitPhones(list) {
    let a = list.findIndex(isMV);
    if (a < 0) return { on: list.slice(), v: [], co: [] };
    let b = a;
    while (b + 1 < list.length && isMV(list[b + 1])) b++;
    return { on: list.slice(0, a), v: list.slice(a, b + 1), co: list.slice(b + 1) };
  }

  const VOICED = new Set(['b', 'd', 'g', 'v', 'dh', 'z', 'zh', 'j', 'm', 'n', 'ng', 'l', 'r', 'w', 'y']);
  const DH_WORDS = new Set(['though', 'thus', 'thy', 'thee', 'thine', 'therefore', 'whether', 'either', 'neither', 'rather', 'together', 'weather', 'feather', 'leather']);

  // The spelling rules: one syllable of a word to speech sounds.
  function mouthRules(u) {
    const s = u.src;
    const lexW = MLEX[s.word];
    if (lexW && lexW.length === s.ns) return splitPhones(lexW[s.si]);
    let on = (u.onset || []).slice();
    let co = (u.coda || []).slice();
    let nuc = s.nucleus;
    let coda = s.coda;
    const first = s.si === 0;
    const last = s.si === s.ns - 1;
    const w = s.word;
    const L = s.letters;
    if (L === 'tion' || L === 'sion') return { on: ['sh'], v: ['ax'], co: ['n'] };
    if (L === 'ture') return { on: ['ch'], v: ['er'], co: [] };
    if (!nuc) {
      // "hmm", "shh", "brr", "pfft": the consonants are the sound.
      if (/^[hm]+$/.test(L)) return { on: [], v: [], co: ['m'] };
      if (/^s*h+$/.test(L)) return { on: [], v: [], co: ['sh'] };
      return { on, v: ['ax'], co };
    }
    if (first && /^(kn|gn)/.test(w) && on.length > 1) on.shift();
    if (first && /^wr/.test(w) && on[0] === 'w') on.shift();
    if (last && /mb$/.test(w) && co[co.length - 1] === 'b') co.pop();
    if (on.includes('th') && (s.func || DH_WORDS.has(w))) on = on.map((c) => (c === 'th' ? 'dh' : c));
    // "w" after a vowel is part of it: ow, aw, ew.
    if (coda[0] === 'w') { nuc += 'w'; coda = coda.slice(1); if (co[0] === 'w') co.shift(); }
    // A word ending in a plural "-es" or a past "-ed" after one consonant
    // keeps the vowel before it long, and the ending loses its vowel.
    const next = s.keys[s.si + 1];
    const endsQuiet = (k) => k && /^[bdfgklmnprtvz]e[sd]$/.test(k) && s.si + 1 === s.ns - 1;
    let magicE = s.magicE || (endsQuiet(next) && !coda && nuc.length === 1);
    if (last && s.si > 0 && /^[bdfgklmnprvz]e[sd]$/.test(L)) {
      const c = on.length ? on : [L[0]];
      const voiced = VOICED.has(c[c.length - 1]);
      return { on: [], v: [], co: c.concat([L[2] === 's' ? 'z' : voiced ? 'd' : 't']) };
    }
    if (last && s.si > 0 && /^ye[sd]$/.test(L) && /[aeo]$/.test(s.keys[s.si - 1])) return { on: [], v: [], co: [L[2] === 's' ? 'z' : 'd'] };
    const n2 = nuc.slice(0, 2);
    const c0 = coda[0] || '';
    const r = c0 === 'r';
    const stressed = s.ns === 1 || s.stressed;
    const wOnset = on[on.length - 1] === 'w';
    let v;
    if (n2.length === 2 && n2[0] !== n2[1] || /^(ee|oo)/.test(nuc)) {
      if (n2 === 'ee') v = 'iy';
      else if (n2 === 'ea') v = /^(d|th|v)/.test(coda) && !r ? 'eh' : 'iy';
      else if (n2 === 'ie') v = last && !coda && w.length <= 3 ? 'ay' : 'iy';
      else if (n2 === 'ei' || n2 === 'ey') v = last && s.ns > 1 && n2 === 'ey' ? 'iy' : 'ey';
      else if (n2 === 'ai' || n2 === 'ay') v = 'ey';
      else if (n2 === 'oo') v = c0 === 'k' || (c0 === 'd' && /^(g|w|h|st|c)$/.test(s.onset)) || (c0 === 't' && s.onset === 'f') ? 'uh' : 'uw';
      else if (n2 === 'ou') v = /^gh/.test(coda) ? 'ao' : /^ld/.test(coda) ? 'uh' : r ? 'ao' : !coda && last ? 'uw' : 'aw';
      else if (n2 === 'ow') v = (last && s.ns > 1) || /^(sh|gr|kn|bl|fl|gl|sl|l|r|thr|sn|s|st|thr)$/.test(s.onset) || /^kn/.test(w) ? 'ow' : 'aw';
      else if (n2 === 'oa' || n2 === 'oe') v = 'ow';
      else if (n2 === 'oi' || n2 === 'oy') v = 'oy';
      else if (n2 === 'au' || n2 === 'aw') v = 'ao';
      else if (n2 === 'ue' || n2 === 'ui' || n2 === 'ew' || n2 === 'eu') v = 'uw';
      else if (n2 === 'uy') v = 'ay';
      else if (n2 === 'ia' || n2 === 'io' || n2 === 'iu') return { on, v: ['iy', 'ax'], co };
      else if (n2 === 'ua' || n2 === 'uo') return { on, v: ['uw', 'ax'], co };
      else v = null;
      if (v === 'ey' && r) v = 'eh';
    }
    if (!v) {
      const c = nuc[0] === 'y' ? 'y' : nuc[0];
      if (r) {
        if (magicE) v = { a: 'eh', e: 'iy', i: 'ay', o: 'ao', u: 'uw', y: 'ay' }[c];
        else if (c === 'a' && (wOnset || stressed)) v = wOnset ? 'ao' : 'aa';
        else if (c === 'o') v = 'ao';
        else { v = 'er'; co.shift(); }
      } else if (magicE) v = { a: 'ey', e: 'iy', i: 'ay', o: 'ow', u: 'uw', y: 'ay' }[c];
      else if (/^gh/.test(coda) && c === 'i') v = 'ay';
      else if (c === 'i' && /^(nd|ld)$/.test(coda)) v = 'ay';
      else if (c === 'o' && /^(ld|lt|ll)$/.test(coda)) v = 'ow';
      else if (c === 'a' && /^l[lktd]/.test(coda)) { v = 'ao'; if (/^lk/.test(coda)) co = co.filter((x) => x !== 'l'); }
      else if (c === 'a' && wOnset) v = 'aa';
      else if (!coda) {
        if (c === 'y') v = s.ns === 1 ? 'ay' : last ? 'iy' : 'ih';
        else if (c === 'e') v = stressed ? 'iy' : last && s.ns > 1 ? 'iy' : 'ih';
        else if (c === 'a') v = stressed ? 'ey' : 'ax';
        else if (c === 'i') v = stressed ? 'ay' : 'ih';
        else if (c === 'o') v = stressed || last ? 'ow' : 'ax';
        else v = 'uw';
      } else {
        v = { a: 'ae', e: 'eh', i: 'ih', o: 'aa', u: 'ah', y: 'ih' }[c] || 'ax';
        if (c === 'u' && /^(p|b|f|sh)$/.test(s.onset) && /^(ll|sh|t)$/.test(coda)) v = 'uh';
      }
      // Unstressed short vowels relax to a schwa, the way people say them.
      if (s.ns > 1 && !stressed && /^(ae|eh|aa|ah)$/.test(v)) v = 'ax';
      if (v === 'uw' && /^(m|k|f|h|p|b|v|c)$/.test(s.onset) && (magicE || !coda)) on = on.concat(['y']);
    }
    // A final "s" after a voiced sound is a "z".
    if (last && co[co.length - 1] === 's' && !/ss$/.test(w)) {
      const prev = co.length > 1 ? co[co.length - 2] : null;
      if (prev ? VOICED.has(prev) : s.ns > 1 && !/[aeiou]s$/.test(w)) co[co.length - 1] = 'z';
    }
    // "g" before e, i or y is often soft: magic, giant, page.
    if (on[0] === 'g' && /^[eiy]/.test(nuc) && !(first && /^(ge[tia]|gi[vrfl]|gid|gig|gea)/.test(w))) on[0] = 'j';
    return { on, v: [v], co };
  }

  // The made-up language: the same syllable always turns into the same
  // nonsense. Below a third of Clarity it is a bouncier one, all b, m and
  // open vowels, like a crowd of very small, very happy henchmen.
  const MBOUNCE = { on: ['b', 'b', 'p', 'm', 'm', 'n', 'l', 'd', 't', 'k', 'g', 'p', 'b', 'l', 'y', 'w'], v: ['aa', 'aa', 'ow', 'iy', 'ah', 'eh', 'uw', 'ay', 'ey', 'aa', 'iy', 'ow'], co: ['n', 'l', 's', 'm', 'p'] };
  const MANY = { on: ['b', 'd', 'g', 'k', 'p', 't', 'm', 'n', 'l', 'r', 's', 'z', 'f', 'v', 'sh', 'h', 'w', 'y', 'ch', 'j', 'th'], v: ['iy', 'ih', 'ey', 'eh', 'ae', 'aa', 'ao', 'ow', 'uh', 'uw', 'ah', 'ay', 'aw', 'er', 'oy'], co: ['n', 'm', 's', 't', 'k', 'l', 'r', 'z', 'p', 'd', 'ng', 'f'] };
  function mouthScramble(key, salt, bouncy) {
    const h = hash32(key + salt);
    const I = bouncy ? MBOUNCE : MANY;
    const on = h & 7 ? [I.on[h % I.on.length]] : [];
    const v = [I.v[(h >>> 7) % I.v.length]];
    const co = (bouncy ? (h >>> 13) % 5 === 0 : (h >>> 13) % 3 !== 0) ? [I.co[(h >>> 17) % I.co.length]] : [];
    return { on, v, co, h };
  }

  function mouthPhones(u, clarity, salt) {
    const real = mouthRules(u);
    if (clarity >= 0.995) return real;
    const keepV = clamp((clarity - 0.06) / 0.6, 0, 1);
    const keepC = clamp((clarity - 0.3) / 0.62, 0, 1);
    const bouncy = clarity < 0.36;
    const s = u.src;
    let fake = mouthScramble(u.key, salt, bouncy);
    // Down at the bottom, a long word repeats its last sound: ba-na-na.
    if (clarity < 0.3 && s.si > 0 && s.si === s.ns - 1 && s.ns >= 2 && (hash32(s.word + salt) & 3) !== 0) {
      const prev = mouthScramble(s.keys[s.si - 1], salt, bouncy);
      fake = { on: prev.on.length ? prev.on : fake.on, v: prev.v, co: fake.co, h: fake.h };
    }
    const r = (i) => (hash32(u.key + salt + '|' + i) >>> 0) / 4294967296;
    const v = real.v.length && r(0) < keepV ? real.v : fake.v;
    const pick = (list, alt, base) => {
      if (!list.length) return keepC > 0.5 ? [] : alt.slice(0, 1);
      const out = [];
      list.forEach((c, i) => out.push(r(base + i) < keepC ? c : alt[i % Math.max(1, alt.length)] || MANY.on[(fake.h >>> (i * 3)) % MANY.on.length]));
      return bouncy ? out.slice(-1) : out;
    };
    let on = pick(real.on, fake.on, 1);
    let co = real.co.length || keepC < 0.5 ? pick(real.co, fake.co, 9) : [];
    if (bouncy && (fake.h >>> 21) % 3) co = [];
    return { on, v, co };
  }

  function mouthDur(c, pos) {
    const C = MC[c];
    if (!C) return 0.05;
    if (C.k === 'stop') return pos === 'on' ? 0.042 + (C.asp ? 0.035 : 0) : 0.06;
    if (C.k === 'aff') return 0.1;
    if (C.k === 'fric') return c === 's' || c === 'sh' ? 0.095 : C.voiced ? 0.06 : 0.075;
    if (C.k === 'h') return 0.055;
    if (C.k === 'nasal') return pos === 'co' ? 0.08 : 0.06;
    return c === 'w' || c === 'y' ? 0.05 : 0.055;
  }

    function synthMouth(pl, sr) {
    const v = pl.voice;
    const S = STYLES.mouth;
    const rate = 1000;
    const n = Math.ceil(pl.duration * rate) + 2;
    const z = (x) => new Float32Array(n).fill(x);
    const F1 = z(500), F2 = z(1500), F3 = z(2500), B1 = z(70), B2 = z(100), B3 = z(160);
    const st = z(NaN), AV = z(0), AH = z(0), AF = z(0), FF = z(4000), FB = z(2000);
    const clarity = v.character;
    const salt = '|mouth' + v.take;
    const tempo = pl.mood.tempo / v.speed;
    const whisper = pl.mood.whisper;
    const bounce = Math.pow(1 - clarity, 2) * 1.8;
    const base = S.baseHz * semis(v.pitch);
    // A smaller throat for a higher voice: pitch it up and it shrinks, the
    // way a sped-up tape does.
    const fs = semis(clamp(v.pitch, -12, 24) * 0.42);
    const put = (i, F, av, ah, af, ff, fb, nasal) => {
      if (i < 0 || i >= n) return;
      F1[i] = F[0]; F2[i] = F[1]; F3[i] = F[2];
      if (nasal) { B1[i] = 100; B2[i] = 260; B3[i] = 380; }
      AV[i] = av; AH[i] = ah; AF[i] = af;
      if (ff) { FF[i] = ff; FB[i] = fb; }
    };
    for (const u of pl.units) {
      const ph = u.src ? mouthPhones(u, clarity, salt) : { on: [], v: ['ax'], co: [] };
      const i0 = Math.round(u.t * rate);
      const i1 = Math.max(i0 + 30, Math.round((u.t + u.d) * rate));
      const span = i1 - i0;
      const vowels = ph.v.flatMap((x) => (MDIPH[x] ? MDIPH[x] : [x]));
      const segs = [];
      ph.on.forEach((c, k) => segs.push({ c, pos: 'on', d: mouthDur(c, 'on') * (k > 0 ? 0.8 : 1), noAsp: ph.on[k - 1] === 's' }));
      const coSegs = (u.cut ? [] : ph.co).map((c) => ({ c, pos: 'co', d: mouthDur(c, 'co') }));
      const cons = segs.concat(coSegs).reduce((a, x) => a + x.d, 0) * Math.min(1.25, tempo) * rate;
      const vMin = vowels.length ? Math.max(40, span * 0.4) : 0;
      const k = cons > 0 ? Math.max(0.35, Math.min(1, (span - vMin) / cons)) : 1;
      for (const x of segs.concat(coSegs)) x.n = Math.max(6, Math.round(x.d * Math.min(1.25, tempo) * rate * k));
      let vn = span - segs.concat(coSegs).reduce((a, x) => a + x.n, 0);
      if (vowels.length) vn = Math.max(30, vn);
      if (u.cut) vn = Math.max(20, Math.round(vn * 0.6));
      const all = segs.concat(vowels.length ? [{ vowel: true, n: vn }] : [], coSegs);
      const vF = (j) => (MV[vowels[j]] || MV.ax);
      const firstV = vF(0);
      const lastV = vF(Math.max(0, vowels.length - 1));
      const A = clamp(u.amp, 0.3, 1.4);
      let i = i0;
      for (const sg of all) {
        const near = sg.pos === 'co' ? lastV : firstV;
        for (let j = 0; j < sg.n; j++, i++) {
          const q = sg.n > 1 ? j / (sg.n - 1) : 0;
          // Pitch, in semitones from the base, for every frame of the unit.
          const qu = (i - i0) / Math.max(1, span - 1);
          let p = u.p0 + (u.p1 - u.p0) * (u.final ? Math.pow(qu, 1.5) : qu);
          p += bounce * Math.sin(Math.PI * clamp(qu, 0, 1)) * (u.stressed ? 1.4 : 1);
          if (i >= 0 && i < n) st[i] = p;
          if (sg.vowel) {
            const vi = vowels.length > 1 && q >= 0.45 ? 1 : 0;
            const F = vF(vi);
            const env = Math.min(1, (j + 1) / 6) * (1 - 0.22 * q) * (u.cut && j > sg.n - 4 ? 0.3 : 1);
            const tail = u.final && q > 0.7 ? 1 - 0.5 * (q - 0.7) / 0.3 : 1;
            put(i, F, whisper ? 0 : A * env * tail, whisper ? 0.55 * A * env : 0, 0);
            continue;
          }
          const C = MC[sg.c] || MC.t;
          let F = C.F || near;
          if (sg.c === 'k' || sg.c === 'g') F = [C.F[0], near[1] * 1.08 + 150, Math.max(near[1] * 1.08 + 450, 2400)];
          if (C.k === 'stop' || C.k === 'aff') {
            const asp = C.asp && !sg.noAsp && sg.pos === 'on';
            const clo = C.k === 'aff' ? 0.35 : sg.pos === 'co' ? 0.7 : asp ? 0.5 : 0.72;
            const bur = C.k === 'aff' ? 0.45 : sg.pos === 'co' ? 1 : asp ? 0.62 : 0.9;
            if (q < clo) put(i, F, C.voiced && !whisper ? 0.1 * A : 0, 0, 0);
            else if (q < bur) put(i, F, C.voiced && !whisper ? 0.2 * A : 0, 0, C.burst[2] * A * (sg.pos === 'co' ? 0.6 : 1), C.burst[0], C.burst[1]);
            else if (C.k === 'aff') put(i, F, C.voiced && !whisper ? 0.3 * A : 0, 0, C.fric[2] * A, C.fric[0], C.fric[1]);
            else if (asp) put(i, firstV, 0, 0.4 * A * (1 - 0.5 * q), 0);
            else put(i, F, C.voiced && !whisper ? 0.4 * A : 0, 0, C.burst[2] * 0.3 * A, C.burst[0], C.burst[1]);
          } else if (C.k === 'fric') {
            const env = Math.min(1, (j + 1) / 8) * Math.min(1, (sg.n - j) / 8);
            put(i, F, C.voiced && !whisper ? 0.35 * A : 0, 0, C.fric[2] * A * env, C.fric[0], C.fric[1]);
          } else if (C.k === 'h') {
            put(i, firstV, 0, 0.42 * A * Math.min(1, (j + 1) / 10), 0);
          } else if (C.k === 'nasal') {
            put(i, C.F, whisper ? 0 : 0.55 * A, whisper ? 0.2 * A : 0, 0, 0, 0, true);
          } else {
            put(i, C.F, whisper ? 0 : 0.72 * A, whisper ? 0.3 * A : 0, 0);
          }
        }
      }
    }
    // Between units the pitch holds where the next one starts, so the voice
    // glides through the line instead of restarting.
    let nextP = NaN;
    for (let i = n - 1; i >= 0; i--) { if (isNaN(st[i])) st[i] = nextP; else nextP = st[i]; }
    let prevP = 0;
    for (let i = 0; i < n; i++) { if (isNaN(st[i])) st[i] = prevP; else prevP = st[i]; }
    // Zero-phase smoothing: the mouth moves before a sound as well as after.
    const smooth = (x, tau) => {
      const a = 1 - Math.exp(-1 / (tau * rate));
      let y = x[0];
      for (let i = 0; i < n; i++) { y += (x[i] - y) * a; x[i] = y; }
      y = x[n - 1];
      for (let i = n - 1; i >= 0; i--) { y += (x[i] - y) * a; x[i] = y; }
    };
    for (const x of [F1, F2, F3]) smooth(x, 0.012);
    for (const x of [B1, B2, B3]) smooth(x, 0.01);
    smooth(st, 0.028);
    smooth(AV, 0.0035);
    smooth(AH, 0.004);
    smooth(AF, 0.002);
    smooth(FF, 0.004);
    smooth(FB, 0.004);

    // The sound itself, a sample at a time.
    const N = (n - 1) * Math.round(sr / rate);
    const blk = Math.round(sr / rate);
    const out = new Float32Array(N);
    const R = mulberry(hash32(pl.text + salt));
    const res = () => ({ a: 0, b: 0, c: 0, y1: 0, y2: 0 });
    const setRes = (r, f, bw) => {
      f = Math.min(f, sr * 0.45);
      const T = 1 / sr;
      r.c = -Math.exp(-2 * Math.PI * bw * T);
      r.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
      r.a = 1 - r.b - r.c;
    };
    const runRes = (r, x) => {
      const y = r.a * x + r.b * r.y1 + r.c * r.y2;
      r.y2 = r.y1;
      r.y1 = y;
      return y;
    };
    const cas = [res(), res(), res(), res(), res()];
    const fr = biquad('bp', 4000, 2, sr);
    const vib = 0.3 * pl.mood.vibrato;
    let phase = 0;
    let jit = 1, shim = 1, drift = 0, driftV = 0;
    let tilt = 0;
    const aTilt = 1 - Math.exp((-2 * Math.PI * 2600) / sr);
    let seedA = hash32(pl.text + 'asp') | 1;
    let seedF = hash32(pl.text + 'fric') | 1;
    const OQ = 0.6;
    for (let fi = 0; fi < n - 1; fi++) {
      setRes(cas[0], F1[fi] * fs, B1[fi]);
      setRes(cas[1], F2[fi] * fs, B2[fi]);
      setRes(cas[2], F3[fi] * fs, B3[fi]);
      setRes(cas[3], 3400 * fs, 250);
      setRes(cas[4], 4300 * fs, 320);
      setBP(fr, FF[fi] * Math.sqrt(fs), Math.max(0.7, (FF[fi] * Math.sqrt(fs)) / FB[fi]), sr);
      // A slow wander in pitch: nobody holds a note perfectly still.
      driftV += (R() - 0.5) * 0.04 - drift * 0.02;
      drift = clamp(drift + driftV * 0.05, -0.35, 0.35);
      for (let j = 0; j < blk; j++) {
        const a = j / blk;
        const s0 = lerp(st[fi], st[fi + 1], a);
        const tt = (fi + a) / rate;
        let stv = s0 + drift;
        if (vib) stv += vib * Math.sin(2 * Math.PI * 5.4 * tt);
        const f0 = base * semis(stv) * jit;
        phase += f0 / sr;
        if (phase >= 1) {
          phase -= 1;
          jit = 1 + (R() - 0.5) * 0.012;
          shim = 1 + (R() - 0.5) * 0.08;
        }
        const x = phase / OQ;
        const g = phase < OQ ? x * (2 - 3 * x) : 0;
        tilt += (g - tilt) * aTilt;
        seedA ^= seedA << 13; seedA ^= seedA >>> 17; seedA ^= seedA << 5;
        const na = ((seedA >>> 0) / 4294967296) * 2 - 1;
        seedF ^= seedF << 13; seedF ^= seedF >>> 17; seedF ^= seedF << 5;
        const nf = ((seedF >>> 0) / 4294967296) * 2 - 1;
        const av = lerp(AV[fi], AV[fi + 1], a);
        const ah = lerp(AH[fi], AH[fi + 1], a);
        const af = lerp(AF[fi], AF[fi + 1], a);
        // Breath rides on the voice too, louder while the folds are open.
        const breath = av * 0.05 * (phase < OQ ? 1 : 0.25);
        let y = tilt * av * shim * 2.2 + na * (ah * 0.4 + breath);
        for (let r = 0; r < 5; r++) y = runRes(cas[r], y);
        y += runBQ(fr, nf * af) * 2.5;
        out[fi * blk + j] = y;
      }
    }
    onePoleHP(out, sr, 70);
    let pk = 0;
    for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(out[i]));
    if (pk > 0) for (let i = 0; i < N; i++) out[i] *= 0.9 / pk;
    // Through an old computer's converter: crunchy for gibberish, clean
    // enough to follow when Clarity is up.
    crush(out, sr, lerp(16000, 22050, clarity), Math.round(lerp(8, 12, clarity)));
    onePoleLP(out, sr, lerp(7000, 10000, clarity));
    return out;
  }

  // ─────────────────────────────── finishing ───────────────────────────────

  function speakerphone(x, sr) {
    const hp = biquad('hp', 420, 0.8, sr);
    const lp = biquad('lp', 3300, 0.9, sr);
    const lp2 = biquad('lp', 4200, 0.7, sr);
    const pk = biquad('bp', 1700, 1.4, sr);
    for (let i = 0; i < x.length; i++) {
      let y = runBQ(lp, runBQ(hp, x[i]));
      y += 0.5 * runBQ(pk, y);
      y = Math.tanh(2.2 * y) / Math.tanh(2.2);
      x[i] = runBQ(lp2, y);
    }
    return x;
  }

  function finish(x, sr, pl) {
    const v = pl.voice;
    const M = pl.mood;
    const grit = clamp(v.grit + M.grit, 0, 1);
    if (grit > 0.01) crush(x, sr, sr / (1 + grit * 5), Math.round(16 - grit * 10));
    if (v.phone) {
      // Gain-stage into the little speaker so the saturation stays consistent.
      let pk = 0;
      for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
      if (pk > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i] / pk) * 0.7;
      speakerphone(x, sr);
    }
    // Level: the same loudness for every voice, quieter for whispers.
    const win = Math.round(sr * 0.02);
    const rms = [];
    let mx = 0;
    for (let i = 0; i + win <= x.length; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) s += x[j] * x[j];
      const r = Math.sqrt(s / win);
      rms.push(r);
      mx = Math.max(mx, r);
    }
    let sum = 0, cnt = 0;
    for (const r of rms) if (r > mx * 0.1) { sum += r * r; cnt++; }
    const active = cnt ? Math.sqrt(sum / cnt) : 0;
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (active > 0 && peak > 0) {
      const target = Math.pow(10, (-18 + M.level) / 20);
      const g = Math.min(target / active, (2.5 * 0.89) / peak);
      const thr = 0.7;
      for (let i = 0; i < x.length; i++) {
        let y = x[i] * g;
        const a = Math.abs(y);
        if (a > thr) y = Math.sign(y) * (thr + 0.19 * Math.tanh((a - thr) / 0.19));
        x[i] = y;
      }
    }
    const fi = Math.min(x.length, Math.round(sr * 0.003));
    for (let i = 0; i < fi; i++) x[i] *= i / fi;
    const fo = Math.min(x.length, Math.round(sr * 0.012));
    for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= i / fo;
    return x;
  }

  function render(input, voice, opts) {
    opts = opts || {};
    return voiceClip(plan(input, voice, opts), opts.sampleRate || SAMPLE_RATE);
  }

  // Plays a plan on its machine, levels it, and lists when each unit sounds.
  // A plan made from a recording brings the recording, for the Mouth.
  function voiceClip(pl, sr, rec) {
    let x;
    if (!pl.units.length) x = new Float32Array(Math.round(sr * 0.25));
    else if (rec && pl.style === 'mouth') x = synthRecording(rec, pl, sr);
    else if (pl.style === 'typewriter') x = synthTypewriter(pl, sr);
    else if (pl.style === 'babble') x = synthBabble(pl, sr);
    else if (pl.style === 'chip') x = synthSpeechChip(pl, sr);
    else if (pl.style === 'mouth') x = synthMouth(pl, sr);
    else x = synthChip(pl, sr, pl.style);
    const N = Math.round(pl.duration * sr);
    if (x.length !== N) {
      const y = new Float32Array(N);
      y.set(x.subarray(0, Math.min(N, x.length)));
      x = y;
    }
    finish(x, sr, pl);
    return {
      samples: x,
      sampleRate: sr,
      duration: pl.duration,
      text: pl.text,
      mood: pl.mood.keys,
      moodLabel: pl.mood.label,
      voice: pl.voice,
      events: pl.units.map((u) => ({ t: u.t, d: u.d, c0: u.c0, c1: u.c1, a: u.amp, p0: u.p0, p1: u.p1, cut: u.cut })),
    };
  }

  // ─────────────────────────── the voice changer ───────────────────────────
  // Say a line into the microphone, or open a recording, and any character
  // says it back in its own machine. Listening measures the voice a hundred
  // times a second: its pitch, whether it buzzes or hisses, how loud it is,
  // and the shape of the mouth as a small filter, the way the speech chips of
  // the 80s stored it. Then it finds the syllables. The Mouth speaks those
  // frames again through its own throat, so the words survive. Every other
  // machine gets the syllables as if it had planned them from text, so it
  // keeps the person's rhythm and melody and still sounds like itself.

  const REC_RATE = 16000;
  const REC_FPS = 100;
  const REC_HOP = REC_RATE / REC_FPS;
  const REC_ORDER = 16;
  const PRE_EMPH = 0.9;

  // Windowed-sinc resampling, so a recording at any rate can be heard at ours.
  // The filter is worked out once for 256 positions between two samples;
  // `zc` is how many of its ripples it keeps on each side.
  function resample(x, from, to, zc) {
    if (from === to) return Float32Array.from(x);
    const ratio = to / from;
    const N = Math.round(x.length * ratio);
    const out = new Float32Array(N);
    const fc = 0.92 * Math.min(1, ratio);
    const half = Math.ceil((zc || 6) / fc);
    const taps = 2 * half;
    const PH = 256;
    const W = new Float32Array((PH + 1) * taps);
    for (let ph = 0; ph <= PH; ph++) {
      for (let m = 0; m < taps; m++) {
        const u = m - half + 1 - ph / PH;
        const z = Math.abs(u) / half;
        if (z >= 1) continue;
        const s = u === 0 ? 1 : Math.sin(Math.PI * fc * u) / (Math.PI * fc * u);
        W[ph * taps + m] = fc * s * (0.42 + 0.5 * Math.cos(Math.PI * z) + 0.08 * Math.cos(2 * Math.PI * z));
      }
    }
    const L = x.length;
    for (let n = 0; n < N; n++) {
      const c = n / ratio;
      const ci = Math.floor(c);
      const o = Math.round((c - ci) * PH) * taps;
      const j0 = ci - half + 1;
      let s = 0;
      if (j0 >= 0 && j0 + taps <= L) {
        for (let m = 0; m < taps; m++) s += x[j0 + m] * W[o + m];
      } else {
        for (let m = 0; m < taps; m++) if (j0 + m >= 0 && j0 + m < L) s += x[j0 + m] * W[o + m];
      }
      out[n] = s;
    }
    return out;
  }

  function quantile(arr, q) {
    if (!arr.length) return 0;
    const s = Float64Array.from(arr).sort();
    return s[clamp(Math.round(q * (s.length - 1)), 0, s.length - 1)];
  }

  // The level of each frame, over a window centred on it.
  function frameRms(x, n, win) {
    const out = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      const a = Math.max(0, Math.round((f + 0.5) * REC_HOP - win / 2));
      const b = Math.min(x.length, Math.round((f + 0.5) * REC_HOP + win / 2));
      let s = 0;
      for (let i = a; i < b; i++) s += x[i] * x[i];
      out[f] = Math.sqrt(s / win);
    }
    return out;
  }

  // Reflection coefficients from an autocorrelation (Levinson-Durbin). They
  // keep the filter stable however they are blended. Returns what is left
  // unpredicted.
  function levinson(R, p, k, ko, a, tmp) {
    let E = R[0];
    a.fill(0);
    for (let i = 1; i <= p; i++) {
      let acc = R[i];
      for (let j = 1; j < i; j++) acc -= a[j] * R[i - j];
      const ki = E > 0 ? clamp(acc / E, -0.995, 0.995) : 0;
      k[ko + i - 1] = ki;
      for (let j = 1; j < i; j++) tmp[j] = a[j] - ki * a[i - j];
      for (let j = 1; j < i; j++) a[j] = tmp[j];
      a[i] = ki;
      E *= 1 - ki * ki;
    }
    return E;
  }

  // The filter's response in dB at 101 frequencies from 0 to 4 kHz.
  const ENV_BINS = 101;
  let envTable = null;
  function lpcEnvelope(k, ko, p) {
    const bins = ENV_BINS;
    if (!envTable || envTable.p !== p) {
      envTable = { p, cos: new Float64Array(bins * p), sin: new Float64Array(bins * p) };
      for (let b = 0; b < bins; b++) {
        const w = (2 * Math.PI * ((b * 4000) / (bins - 1))) / REC_RATE;
        for (let j = 1; j <= p; j++) {
          envTable.cos[b * p + j - 1] = Math.cos(w * j);
          envTable.sin[b * p + j - 1] = Math.sin(w * j);
        }
      }
    }
    const a = new Float64Array(p + 1);
    const tmp = new Float64Array(p + 1);
    for (let i = 1; i <= p; i++) {
      const ki = k[ko + i - 1];
      for (let j = 1; j < i; j++) tmp[j] = a[j] - ki * a[i - j];
      for (let j = 1; j < i; j++) a[j] = tmp[j];
      a[i] = ki;
    }
    const out = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let re = 1, im = 0;
      for (let j = 1; j <= p; j++) {
        re -= a[j] * envTable.cos[b * p + j - 1];
        im += a[j] * envTable.sin[b * p + j - 1];
      }
      out[b] = -10 * Math.log10(re * re + im * im + 1e-12);
    }
    return out;
  }

  // The first two formants of a vowel, from the peaks of the filter.
  function formants(env) {
    const hz = (b) => (b * 4000) / (env.length - 1);
    const peaks = [];
    for (let b = 1; b < env.length - 1; b++) {
      if (env[b] > env[b - 1] && env[b] >= env[b + 1] && hz(b) > 180 && hz(b) < 3400) {
        const d = env[b - 1] - 2 * env[b] + env[b + 1];
        peaks.push(hz(b + (d < 0 ? (0.5 * (env[b - 1] - env[b + 1])) / d : 0)));
      }
    }
    const F1 = peaks.find((f) => f < 1100) || 500;
    const F2 = peaks.find((f) => f > F1 + 180 && f > 600) || F1 * 1.7;
    return [F1, F2];
  }

  // Which of the machines' six vowels a pair of formants is nearest to.
  function vowelClass(F, scale) {
    let best = '@';
    let bd = Infinity;
    for (const v of ['a', 'e', 'i', 'o', 'u', '@']) {
      const d1 = Math.log(F[0] / scale / VOW[v].F[0]);
      const d2 = Math.log(F[1] / scale / VOW[v].F[1]);
      const d = d1 * d1 + 0.7 * d2 * d2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  // Listens to a recording. Takes mono samples at any rate; gives back the
  // frames and the syllables, as plain numbers, ready for renderRecording.
  function analyzeRecording(samples, sampleRate) {
    const sr0 = sampleRate > 0 ? sampleRate : SAMPLE_RATE;
    const len0 = samples ? samples.length : 0;
    const raw = new Float32Array(len0);
    for (let i = 0; i < len0; i++) raw[i] = isFinite(samples[i]) ? samples[i] : 0;
    let x = resample(raw, sr0, REC_RATE, 4);
    filterBQ(x, biquad('hp', 50, 0.7, REC_RATE));

    // Trim the silence at each end: speech starts with the first run of three
    // loud frames, so a click before it doesn't count.
    let n = Math.ceil(x.length / REC_HOP);
    let lv = frameRms(x, n, 2 * REC_HOP);
    const top = quantile(lv, 0.98);
    const floor = quantile(lv, 0.1);
    // A recording with no pauses (one long "aaah") is all voice.
    const thr = Math.max(Math.min(floor * 2.5, top * 0.3), top * 0.03, 1e-6);
    let a = -1, b = -1;
    for (let f = 0; f + 2 < n && a < 0; f++) if (lv[f] > thr && lv[f + 1] > thr && lv[f + 2] > thr) a = f;
    for (let f = n - 1; f >= 2 && b < 0; f--) if (lv[f] > thr && lv[f - 1] > thr && lv[f - 2] > thr) b = f;
    const empty = {
      version: VERSION, fps: REC_FPS, duration: 0, frames: 0, order: REC_ORDER, pitch: 120, whisper: false,
      f0: new Float32Array(0), voicing: new Float32Array(0), rms: new Float32Array(0), gain: new Float32Array(0),
      k: new Float32Array(0), syllables: [],
    };
    if (a < 0) return empty;
    const s0 = Math.max(0, a * REC_HOP - Math.round(0.06 * REC_RATE));
    const s1 = Math.min(x.length, (b + 1) * REC_HOP + Math.round(0.1 * REC_RATE));
    x = x.slice(s0, s1);

    // Level it: the loud part of the speech at -20 dB, and no peak over 0.95.
    let loud = 0;
    for (let f = a; f <= b; f++) loud = Math.max(loud, lv[f]);
    const active = [];
    for (let f = a; f <= b; f++) if (lv[f] > thr) active.push(lv[f]);
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const norm = Math.min(0.1 / Math.max(1e-9, quantile(active, 0.95)), 0.95 / Math.max(1e-9, peak));
    for (let i = 0; i < x.length; i++) x[i] *= norm;
    // Only a recording with real pauses tells us how loud the room is.
    const noise = floor < top * 0.05 ? floor * norm : 0;

    n = Math.ceil(x.length / REC_HOP);
    const L = x.length;
    const P = REC_ORDER;

    // The mouth, every frame: a 25 ms window, emphasised so the high formants
    // count, through Levinson-Durbin. Also the level, and how bright it is.
    const W = 400;
    const win = new Float32Array(W);
    let wsum = 0;
    for (let i = 0; i < W; i++) {
      win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (W - 1));
      wsum += win[i] * win[i];
    }
    const lagWin = new Float64Array(P + 1);
    for (let j = 0; j <= P; j++) lagWin[j] = Math.exp(-0.5 * Math.pow((2 * Math.PI * 60 * j) / REC_RATE, 2));
    const K = new Float32Array(n * P);
    const gain = new Float32Array(n);
    const rms = new Float32Array(n);
    const bright = new Float32Array(n);
    const buf = new Float64Array(W);
    const R = new Float64Array(P + 1);
    const la = new Float64Array(P + 1);
    const lt = new Float64Array(P + 1);
    for (let f = 0; f < n; f++) {
      const c = Math.round((f + 0.5) * REC_HOP) - W / 2;
      let e0 = 0, e1 = 0, prev = 0;
      let xp = c > 0 && c <= L ? x[c - 1] : 0;
      for (let i = 0; i < W; i++) {
        const j = c + i;
        const s = j >= 0 && j < L ? x[j] : 0;
        const sw = s * win[i];
        e0 += sw * sw;
        e1 += sw * prev;
        prev = sw;
        buf[i] = (s - PRE_EMPH * xp) * win[i];
        xp = s;
      }
      for (let j = 0; j <= P; j++) {
        let s = 0;
        for (let i = j; i < W; i++) s += buf[i] * buf[i - j];
        R[j] = s * lagWin[j];
      }
      R[0] *= 1.0001;
      const E = R[0] > 1e-12 ? levinson(R, P, K, f * P, la, lt) : 0;
      gain[f] = Math.sqrt(Math.max(0, E) / wsum);
      rms[f] = Math.sqrt(e0 / wsum);
      bright[f] = e0 > 1e-12 ? 1 - e1 / e0 : 1;
    }

    // The pitch, YIN-style, on a copy at 8 kHz: for each period from 60 to
    // 600 Hz, how unlike itself the wave is one period later. The best few
    // dips are candidates, and a path through them that avoids sudden octave
    // jumps is the pitch.
    const YW = 200;
    const tMin = 13;
    const tMax = 134;
    const pad = YW + tMax;
    const lp = [biquad('lp', 1800, 0.54, REC_RATE), biquad('lp', 1800, 1.31, REC_RATE)];
    const L8 = Math.floor(L / 2) + 2 * pad;
    const x8 = new Float32Array(L8);
    for (let i = 0; i < L; i++) {
      const y = runBQ(lp[1], runBQ(lp[0], x[i]));
      if (!(i & 1)) x8[pad + i / 2] = y;
    }
    const sq = new Float64Array(L8 + 1);
    for (let i = 0; i < L8; i++) sq[i + 1] = sq[i] + x8[i] * x8[i];
    const MAXC = 4;
    const cf = new Float32Array(n * MAXC);
    const cs = new Float32Array(n * MAXC);
    const cn = new Uint8Array(n);
    const dp = new Float64Array(tMax + 2);
    const xc = new Float64Array(tMax + 5);
    const quietV = Math.max(noise * 2, 0.002);
    for (let f = 0; f < n; f++) {
      if (rms[f] < quietV) continue;
      const st = pad + Math.round((f + 0.5) * (REC_HOP / 2) - (YW + tMax) / 2);
      if (st < 0 || st + YW + tMax + 4 > L8) continue;
      const e0 = sq[st + YW] - sq[st];
      if (e0 <= 1e-9) continue;
      // Four periods at a time: the same samples, read once.
      for (let t = 1; t <= tMax + 1; t += 4) {
        let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
        for (let j = st, e = st + YW; j < e; j++) {
          const v = x8[j];
          r0 += v * x8[j + t];
          r1 += v * x8[j + t + 1];
          r2 += v * x8[j + t + 2];
          r3 += v * x8[j + t + 3];
        }
        xc[t] = r0;
        xc[t + 1] = r1;
        xc[t + 2] = r2;
        xc[t + 3] = r3;
      }
      let cum = 0;
      dp[0] = 1;
      for (let t = 1; t <= tMax + 1; t++) {
        const d = e0 + (sq[st + t + YW] - sq[st + t]) - 2 * xc[t];
        cum += d;
        dp[t] = cum > 0 ? (d * t) / cum : 1;
      }
      // Local minima, best first; the first dip under 0.15 is always one.
      const list = [];
      for (let t = tMin; t <= tMax; t++) {
        if (dp[t] < dp[t - 1] && dp[t] <= dp[t + 1] && dp[t] < 0.6) list.push(t);
      }
      const firstDip = list.find((t) => dp[t] < 0.15);
      list.sort((p, q) => dp[p] - dp[q]);
      if (firstDip && list.indexOf(firstDip) >= MAXC) list.splice(MAXC - 1, 0, firstDip);
      let m = 0;
      for (const t of list.slice(0, MAXC)) {
        const den = dp[t - 1] - 2 * dp[t] + dp[t + 1];
        const sh = den > 0 ? clamp((0.5 * (dp[t - 1] - dp[t + 1])) / den, -0.5, 0.5) : 0;
        cf[f * MAXC + m] = 8000 / (t + sh);
        cs[f * MAXC + m] = Math.max(0, dp[t] - (den > 0 ? 0.25 * (dp[t - 1] - dp[t + 1]) * sh : 0)) + (t === firstDip ? 0 : 0.04);
        m++;
      }
      cn[f] = m;
    }
    // The path: unvoiced costs a little, unless the frame is quiet or hissing.
    const S = MAXC + 1;
    const cost = new Float32Array(n * S).fill(Infinity);
    const back = new Int8Array(n * S);
    const local = (f, j) => {
      if (j === 0) return rms[f] < quietV ? 0 : bright[f] > 1 ? 0.12 : 0.3;
      return cs[f * MAXC + j - 1] - 0.03 * Math.log2(cf[f * MAXC + j - 1] / 60) + (rms[f] < quietV ? 2 : 0);
    };
    const freq = (f, j) => cf[f * MAXC + j - 1];
    for (let f = 0; f < n; f++) {
      for (let j = 0; j <= cn[f]; j++) {
        const lc = local(f, j);
        if (f === 0) {
          cost[j] = lc;
          continue;
        }
        let best = Infinity, bi = 0;
        for (let i = 0; i <= cn[f - 1]; i++) {
          let tc = cost[(f - 1) * S + i];
          if (i === 0 && j === 0) tc += 0;
          else if (i === 0 || j === 0) tc += 0.2;
          else tc += 0.5 * Math.abs(Math.log2(freq(f, j) / freq(f - 1, i)));
          if (tc < best) {
            best = tc;
            bi = i;
          }
        }
        cost[f * S + j] = best + lc;
        back[f * S + j] = bi;
      }
    }
    const f0 = new Float32Array(n);
    const voicing = new Float32Array(n);
    if (n) {
      let j = 0;
      for (let i = 1; i <= cn[n - 1]; i++) if (cost[(n - 1) * S + i] < cost[(n - 1) * S + j]) j = i;
      for (let f = n - 1; f >= 0; f--) {
        if (j > 0) {
          f0[f] = freq(f, j);
          voicing[f] = clamp(1.25 - 2.2 * cs[f * MAXC + j - 1], 0.35, 1);
        }
        j = back[f * S + j];
      }
    }
    // A voiced blip shorter than 40 ms is a mistake; then a light median.
    for (let f = 0; f < n; ) {
      if (!f0[f]) { f++; continue; }
      let e = f;
      while (e < n && f0[e]) e++;
      if (e - f < 4) for (let i = f; i < e; i++) { f0[i] = 0; voicing[i] = 0; }
      else {
        const src = f0.slice(f, e);
        for (let i = f + 1; i < e - 1; i++) {
          const w3 = [src[i - f - 1], src[i - f], src[i - f + 1]].sort((p, q) => p - q);
          f0[i] = w3[1];
        }
      }
      f = e;
    }

    // A loud, dull frame with no pitch is still a voice, usually a creak below
    // 60 Hz: it borrows the pitch beside it and buzzes at half strength.
    for (let f = 0; f < n; f++) {
      if (f0[f] || bright[f] > 0.3 || rms[f] < quietV * 4) continue;
      let l = f - 1, r = f + 1;
      while (l >= 0 && f - l <= 15 && !f0[l]) l--;
      while (r < n && r - f <= 15 && !f0[r]) r++;
      const hl = l >= 0 && f - l <= 15 && f0[l] > 0 ? f0[l] : 0;
      const hr = r < n && r - f <= 15 && f0[r] > 0 ? f0[r] : 0;
      if (!hl && !hr) continue;
      f0[f] = hl && hr ? hl * Math.pow(hr / hl, (f - l) / (r - l)) : hl || hr;
      voicing[f] = 0.5;
    }

    // Take the room out of the level, so pauses stay quiet.
    for (let f = 0; f < n; f++) {
      const r = Math.sqrt(Math.max(0, rms[f] * rms[f] - 2.25 * noise * noise));
      gain[f] *= rms[f] > 0 ? r / rms[f] : 0;
      rms[f] = r;
    }
    const voicedHz = [];
    for (let f = 0; f < n; f++) if (f0[f]) voicedHz.push(f0[f]);
    const pitch = voicedHz.length ? quantile(voicedHz, 0.5) : 120;
    let act = 0;
    for (let f = 0; f < n; f++) if (rms[f] > thr * norm) act++;
    const whisper = act > 10 && voicedHz.length < act * 0.1;

    const rec = {
      version: VERSION, fps: REC_FPS, duration: L / REC_RATE, frames: n, order: P, pitch, whisper,
      f0, voicing, rms, gain, k: K, syllables: [],
    };
    rec.syllables = findSyllables(rec, x, bright, Math.max(thr * norm, noise * 2));
    return rec;
  }

  // Syllables: the peaks of loudness in the vowel band, where the voice is
  // buzzing, with a real dip between them. Consonants before a vowel belong
  // to it, the way they do in the text machines.
  function findSyllables(rec, x, bright, thr) {
    const n = rec.frames;
    const { f0, rms } = rec;
    const band = Float32Array.from(x);
    filterBQ(band, biquad('hp', 300, 0.7, REC_RATE));
    filterBQ(band, biquad('lp', 3000, 0.7, REC_RATE));
    const br = frameRms(band, n, 2 * REC_HOP);
    const Lr = new Float32Array(n);
    for (let f = 0; f < n; f++) Lr[f] = 20 * Math.log10(br[f] + 1e-6);
    const Ld = new Float32Array(n);
    for (let f = 0; f < n; f++) Ld[f] = (Lr[Math.max(0, f - 1)] + 2 * Lr[f] + Lr[Math.min(n - 1, f + 1)]) / 4;
    const act = new Uint8Array(n);
    for (let f = 0; f < n; f++) act[f] = rms[f] > thr ? 1 : 0;
    const buzz = (f) => (rec.whisper ? act[f] : f0[f] > 0);
    const top = quantile(Ld, 0.98);

    let peaks = [];
    for (let f = 0; f < n; f++) {
      if (!act[f] || !buzz(f) || Ld[f] < top - 30) continue;
      let isMax = true;
      for (let j = Math.max(0, f - 2); j <= Math.min(n - 1, f + 2) && isMax; j++) {
        if (Ld[j] > Ld[f] || (Ld[j] === Ld[f] && j < f)) isMax = false;
      }
      if (isMax) peaks.push(f);
    }
    // Two peaks are one syllable unless the loudness dips by 2.5 dB between
    // them, or the voice stops, or they are under 70 ms apart.
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i + 1 < peaks.length; i++) {
        const p = peaks[i], q = peaks[i + 1];
        let m = Infinity, gap = 0, run = 0, unv = 0;
        for (let f = p; f <= q; f++) {
          m = Math.min(m, Ld[f]);
          if (!act[f]) gap++;
          run = buzz(f) ? 0 : run + 1;
          unv = Math.max(unv, run);
        }
        if (q - p < 7 || (Math.min(Ld[p], Ld[q]) - m < 2.5 && !gap && unv < 2)) {
          peaks.splice(Ld[p] >= Ld[q] ? i + 1 : i, 1);
          changed = true;
          break;
        }
      }
    }
    if (!peaks.length) return [];

    // Where each one starts and stops.
    const start = [], end = [];
    let f = peaks[0];
    while (f > 0 && act[f - 1]) f--;
    start.push(f);
    for (let i = 0; i + 1 < peaks.length; i++) {
      const p = peaks[i], q = peaks[i + 1];
      let g0 = -1, g1 = -1;
      for (let j = p + 1; j < q; j++) if (!act[j]) { if (g0 < 0) g0 = j; g1 = j; }
      if (g0 >= 0) {
        end.push(g0);
        start.push(g1 + 1);
        continue;
      }
      // A hiss or a burst before the next vowel goes with it.
      let u = q;
      while (u > p + 1 && buzz(u - 1)) u--;
      let cut = u;
      if (u > p + 1) {
        while (cut > p + 1 && !buzz(cut - 1)) cut--;
      } else {
        cut = p + 1;
        for (let j = p + 1; j < q; j++) if (Ld[j] < Ld[cut]) cut = j;
      }
      end.push(cut);
      start.push(cut);
    }
    f = peaks[peaks.length - 1];
    while (f < n - 1 && act[f + 1]) f++;
    end.push(f + 1);

    const peakL = peaks.map((p) => Ld[p]);
    const midL = quantile(peakL, 0.5);
    const durs = peaks.map((p, i) => end[i] - start[i]);
    const midD = quantile(durs, 0.5);
    const st = (f) => 12 * Math.log2(f0[f] / rec.pitch);

    // The vowel of each syllable from its formants, with the speaker's size
    // taken out: a smaller mouth moves every formant up together.
    const forms = peaks.map((p, i) => {
      let a = p, b = p;
      while (a > start[i] && buzz(a - 1) && Ld[a - 1] > Ld[p] - 6) a--;
      while (b < end[i] - 1 && buzz(b + 1) && Ld[b + 1] > Ld[p] - 6) b++;
      const at = (f0, f1) => {
        const env = new Float32Array(ENV_BINS);
        let cnt = 0;
        for (let f = f0; f <= f1; f++) {
          const e = lpcEnvelope(rec.k, f * rec.order, rec.order);
          for (let j = 0; j < ENV_BINS; j++) env[j] += e[j];
          cnt++;
        }
        for (let j = 0; j < ENV_BINS; j++) env[j] /= cnt;
        return formants(env);
      };
      const mid = Math.round((a + b) / 2);
      const F = at(Math.max(a, mid - 1), Math.min(b, mid + 1));
      const long = b - a >= 10;
      return { a, b, F, F0: long ? at(a + 1, a + 3) : F, F1: long ? at(b - 3, b - 1) : F };
    });
    let scale = rec.pitch > 165 ? 1.15 : 1;
    if (forms.length >= 4) {
      let s = 0;
      for (const fm of forms) s += 0.5 * Math.log(fm.F[0] / 470) + 0.5 * Math.log(fm.F[1] / 1330);
      scale = clamp(Math.exp(s / forms.length), 0.85, 1.3);
    }

    // What kind of consonant a stretch of frames sounds like.
    const consonant = (f0, f1, onset) => {
      let hiss = 0, hb = 0, quiet = 0, voicedSoft = 0;
      for (let f = f0; f < f1; f++) {
        if (!act[f]) quiet++;
        else if (!buzz(f) || rec.whisper) { hiss++; hb += bright[f]; }
        else voicedSoft++;
      }
      if (hiss >= 3) {
        const m = hb / hiss;
        return [m > 1.25 ? 's' : m > 0.8 ? 'f' : m > 0.45 ? 'sh' : 'h'];
      }
      if (hiss > 0) {
        const m = hb / hiss;
        return [m > 1.15 ? 't' : m < 0.75 ? 'k' : 'p'];
      }
      if (onset && quiet > 0 && voicedSoft === 0) return ['d'];
      if (voicedSoft >= 3) return [onset ? 'm' : 'n'];
      if (voicedSoft >= 1) return onset ? ['l'] : [];
      return [];
    };

    return peaks.map((p, i) => {
      const s = start[i], e = end[i];
      const fm = forms[i];
      const vs = [];
      for (let f = s; f < e; f++) if (f0[f]) vs.push(st(f));
      let p0 = 0, p1 = 0;
      if (vs.length) {
        const m = Math.max(1, Math.round(vs.length * 0.3));
        p0 = quantile(vs.slice(0, m), 0.5);
        p1 = quantile(vs.slice(-m), 0.5);
      } else {
        for (let r = 1; r < n; r++) {
          const j = f0[p - r] ? p - r : f0[p + r] ? p + r : -1;
          if (j >= 0 && j < n) { p0 = p1 = st(j); break; }
        }
      }
      const v0 = vowelClass(fm.F0, scale);
      const v1 = vowelClass(fm.F1, scale);
      const vowels = v0 !== v1 && fm.b - fm.a >= 10 ? [v0, v1] : [vowelClass(fm.F, scale)];
      const last = i === peaks.length - 1 || start[i + 1] - e >= 15;
      return {
        t: s / REC_FPS,
        d: (e - s) / REC_FPS,
        peak: p / REC_FPS,
        a: clamp(Math.pow(10, (peakL[i] - midL) / 60), 0.6, 1.4),
        p0: +p0.toFixed(3),
        p1: +p1.toFixed(3),
        vowels,
        onset: consonant(s, fm.a, true),
        coda: consonant(fm.b + 1, e, false),
        stressed: peakL[i] > midL + 1.5 && e - s > midD,
        end: last,
      };
    });
  }

  // Spreads the characters of a line over the units in order, phrase by
  // phrase when the pauses and the punctuation agree, so the box types along.
  function spreadText(text, units, sylOf, phraseEnds) {
    const an = analyze(text);
    const ts = [];
    const tPhrase = [];
    an.phrases.forEach((ph) => {
      const g = [];
      for (let wi = ph.w0; wi < ph.w1; wi++) for (const s of an.words[wi].syl) g.push(ts.push(s) - 1);
      if (g.length) tPhrase.push(g);
    });
    const nr = phraseEnds.length;
    const rPhrase = [];
    let g = [];
    for (let i = 0; i < nr; i++) {
      g.push(i);
      if (phraseEnds[i] || i === nr - 1) { rPhrase.push(g); g = []; }
    }
    const groups = rPhrase.length === tPhrase.length ? rPhrase.map((r, i) => [r, tPhrase[i]]) : [[rPhrase.flat(), tPhrase.flat()]];
    const range = new Array(nr).fill(null);
    for (const [r, t] of groups) {
      t.forEach((ti, j) => {
        const ri = r[t.length > 1 ? Math.round((j * (r.length - 1)) / (t.length - 1)) : 0];
        range[ri] = [range[ri] ? range[ri][0] : ts[ti].c0, ts[ti].c1];
      });
    }
    let pos = 0;
    for (let i = 0; i < nr; i++) {
      if (range[i]) pos = range[i][1];
      else range[i] = [pos, pos];
    }
    // Units inside a syllable share its letters.
    const count = new Array(nr).fill(0);
    for (const u of units) count[sylOf(u)]++;
    const seen = new Array(nr).fill(0);
    for (const u of units) {
      const i = sylOf(u);
      const [c0, c1] = range[i];
      const span = c1 - c0;
      u.c0 = c0 + Math.floor((seen[i] * span) / count[i]);
      u.c1 = c0 + Math.floor(((seen[i] + 1) * span) / count[i]);
      seen[i]++;
    }
  }

  // Turns the syllables into a plan for the chosen machine, exactly the
  // shape plan() makes from text, timed to the recording.
  function planRecording(rec, voiceIn, text) {
    const line = parseLine(text || '');
    const voice = normVoice(voiceIn);
    if (line.phone) voice.phone = true;
    const S = STYLES[voice.style];
    const M = moodMix(null);
    if (rec.whisper) M.whisper = true;
    const syl = rec.syllables || [];
    // Melody: 0.5 is the person's own, 0 flattens it, 1 doubles it.
    const mel = voice.melody <= 0.5 ? voice.melody * 2 : 1 + (voice.melody - 0.5) * 2;
    const k = 1 / voice.speed;
    const R = mulberry(hash32(rec.frames + '\u0001' + syl.length + '\u0001' + voice.style + '\u0001' + voice.take));
    const salt = '|rec' + voice.take;
    const chipVowels = voice.style === 'square' || voice.style === 'pocket' || voice.style === 'boss';
    const units = [];
    syl.forEach((s, i) => {
      const t = s.t * k;
      const d = s.d * k;
      const melS = voice.style === 'mouth' ? mel : mel * S.melody;
      let p0 = s.p0 * melS;
      let p1 = s.p1 * melS;
      // The chip machines lift each vowel themselves, so take that back out
      // and the melody stays the person's.
      if (chipVowels) {
        p0 -= VOW[s.vowels[0]].st * S.vowelPitch;
        p1 -= VOW[s.vowels[0]].st * S.vowelPitch;
      }
      if (S.scale) {
        p0 = quantize(p0, S.scale);
        p1 = quantize(p1, S.scale);
      }
      const final = s.end ? (p1 > p0 + 1 ? 'question' : 'stop') : null;
      const next = syl[i + 1];
      const joined = next && !s.end && next.t - (s.t + s.d) < 0.03;
      const base = { syl: i, stressed: s.stressed, caps: false, final, cut: false, src: undefined };
      if (S.unit === 'syl') {
        const dd = voice.style === 'mouth' || !joined ? d : d * (1 - S.legato);
        units.push(Object.assign({}, base, {
          kind: 'syl', t, d: dd, p0, p1, amp: s.a * (1 + (R() - 0.5) * 0.06),
          onset: s.onset.slice(), coda: s.coda.slice(), vowels: s.vowels.slice(), key: 'r' + i + s.vowels.join('') + s.onset.join(''),
        }));
      } else if (S.unit === 'letter') {
        // Babble chatters: a few quick sounds in every syllable.
        const m = Math.max(1, Math.round(d * S.rate * 0.85));
        const SOFT = ['l', 'n', 'm', 'b', 'd', 'w', 'y', 'g'];
        for (let j = 0; j < m; j++) {
          const q0 = j / m, q1 = (j + 1) / m;
          const h = hash32(i + '|' + j + salt);
          const on = j === 0 ? s.onset.slice(0, 1) : h % 5 < 2 ? [SOFT[(h >>> 3) % SOFT.length]] : [];
          const v = s.vowels[s.vowels.length > 1 && q0 >= 0.5 ? 1 : 0];
          units.push(Object.assign({}, base, {
            kind: 'letter', t: t + d * q0, d: Math.max(0.02, d / m - 0.004), p0: lerp(p0, p1, q0), p1: lerp(p0, p1, q1),
            amp: s.a * (j === 0 ? 1 : 0.92) * (1 + (R() - 0.5) * 0.08), onset: on, coda: [], vowels: [v], isVowel: !on.length,
            key: 'r' + i + '.' + j, final: j === m - 1 ? final : null,
          }));
        }
      } else {
        // Typewriter: steady blips for as long as the person is talking.
        const step = 1 / S.rate;
        const m = Math.max(1, Math.round(d / step));
        for (let j = 0; j < m; j++) {
          const q = m > 1 ? j / (m - 1) : 0;
          const p = lerp(p0, p1, q) + hashSigned('r' + i + '.' + j + salt) * 0.6;
          units.push(Object.assign({}, base, {
            kind: 'char', t: t + (j * d) / m, d: d / m, p0: p, p1: p - 1.5, amp: s.a * (1 + (R() - 0.5) * 0.08),
            onset: [], coda: [], vowels: [], key: 'r' + i + '.' + j, final: null,
          }));
        }
      }
    });
    if (S.tick) {
      let cursor = 0;
      for (const u of units) {
        const k0 = Math.max(cursor, Math.round(u.t * S.tick));
        const kd = Math.max(2, Math.round(u.d * S.tick));
        u.t = k0 / S.tick;
        u.d = kd / S.tick;
        cursor = k0 + kd;
      }
    }
    const textOut = line.text;
    if (textOut) spreadText(textOut, units, (u) => u.syl, syl.map((s) => s.end));
    else for (const u of units) u.c0 = u.c1 = 0;
    const last = units[units.length - 1];
    const end = last ? last.t + last.d : 0;
    const duration = units.length ? Math.max(rec.duration * k, end + (voice.style === 'boss' ? S.tail : 0.12)) : 0.3;
    return { version: VERSION, text: textOut, mood: M, voice, style: voice.style, units, duration };
  }

  // The Mouth, re-speaking a recording frame by frame: the person's own mouth
  // shapes as a filter, played by the Mouth's buzz at the new pitch, or by
  // noise where they hissed. Turned down, Clarity blurs the shapes, rounds
  // them off and steps through them, until only the vowels and the tune are
  // left: cheerful gibberish in the person's rhythm.
  function synthRecording(rec, pl, sr) {
    const v = pl.voice;
    const c = v.character;
    const n = rec.frames;
    const P = rec.order;
    const K = Float32Array.from(rec.k);
    const G = Float32Array.from(rec.gain);
    const V = Float32Array.from(rec.voicing);
    const mel = v.melody <= 0.5 ? v.melody * 2 : 1 + (v.melody - 0.5) * 2;

    // Pitch, in semitones from the person's middle, carried through the gaps.
    const st = new Float32Array(n);
    let last = -1;
    for (let f = 0; f <= n; f++) {
      if (f < n && !(rec.f0[f] > 0)) continue;
      const s = f < n ? 12 * Math.log2(rec.f0[f] / rec.pitch) : last >= 0 ? st[last] : 0;
      const s0 = last >= 0 ? st[last] : s;
      for (let j = last + 1; j < f; j++) st[j] = lerp(s0, s, (j - last) / (f - last));
      if (f < n) st[f] = s;
      last = f;
    }
    for (let f = 0; f < n; f++) st[f] *= mel;

    // Low Clarity: each syllable leans towards its vowel and hums it, with a
    // little bounce in the pitch, like the Mouth's gibberish.
    const blur = clamp((0.55 - c) / 0.55, 0, 1);
    const bounce = Math.pow(1 - c, 2) * 1.8;
    for (const s of rec.syllables) {
      const f0 = Math.round(s.t * REC_FPS);
      const f1 = Math.min(n, Math.round((s.t + s.d) * REC_FPS));
      const fp = clamp(Math.round(s.peak * REC_FPS), 0, n - 1);
      for (let f = f0; f < f1; f++) {
        const q = (f - f0) / Math.max(1, f1 - f0 - 1);
        st[f] += bounce * Math.sin(Math.PI * q) * (s.stressed ? 1.4 : 1);
        if (blur > 0) {
          const w = Math.pow(blur, 0.7);
          for (let j = 0; j < P; j++) K[f * P + j] = lerp(K[f * P + j], rec.k[fp * P + j], w);
          V[f] = lerp(V[f], 1, w * 0.8);
        }
      }
    }
    // Blur the mouth in time, both ways, so nothing moves before it should.
    const tau = 0.035 * Math.pow(1 - c, 1.5);
    if (tau > 0.002) {
      const a = 1 - Math.exp(-1 / (tau * REC_FPS));
      const sm = (get, set) => {
        let y = get(0);
        for (let f = 0; f < n; f++) { y += (get(f) - y) * a; set(f, y); }
        y = get(n - 1);
        for (let f = n - 1; f >= 0; f--) { y += (get(f) - y) * a; set(f, y); }
      };
      for (let j = 0; j < P; j++) sm((f) => K[f * P + j], (f, y) => { K[f * P + j] = y; });
      sm((f) => V[f], (f, y) => { V[f] = y; });
    }
    // Fewer coefficients, kept to a few bits: a rounder, cheaper mouth.
    const order = Math.round(lerp(8, P, clamp(c / 0.7, 0, 1)));
    const bits = c < 0.7 ? Math.round(lerp(3, 7, c / 0.7)) : 0;
    if (bits) {
      const q = Math.pow(2, bits - 1) / (Math.PI / 2);
      for (let i = 0; i < K.length; i++) K[i] = Math.sin(Math.round(Math.asin(K[i]) * q) / q);
    }
    const hold = Math.max(1, Math.round(lerp(3, 1, clamp(c / 0.7, 0, 1))));

    // A smaller throat for a higher voice, as in the Mouth: the filter runs
    // at a faster rate, which moves every formant up together.
    const fs = semis(clamp(v.pitch, -12, 24) * 0.42);
    const fsI = REC_RATE * fs;
    const NI = Math.ceil(pl.duration * fsI);
    const blk = Math.max(1, Math.round(fsI / 1000));
    const speed = v.speed;
    const shift = semis(v.pitch);
    const noiseAmt = lerp(0.45, 1, c);
    const b = new Float64Array(P + 1);
    const kk = new Float64Array(P);
    const lat = (fp) => {
      if (hold > 1) fp = Math.floor(fp / hold) * hold;
      const f = Math.floor(fp);
      return [clamp(f, 0, n - 1), clamp(f + 1, 0, n - 1), hold > 1 ? 0 : fp - f];
    };
    // Above a cutoff that rises with the voicing, real voices turn breathy:
    // the buzz is low-passed there and the noise high-passed, so the top end
    // hisses instead of buzzing. Low Clarity keeps the plain buzz.
    const mix = clamp((c - 0.3) / 0.5, 0, 1);
    const run = (corr) => {
      const out = new Float32Array(NI);
      let seed = hash32('noise' + v.take) | 1;
      b.fill(0);
      let de = 0, phase = 0.5, carry = 0;
      let p1 = 0, p2 = 0, n1 = 0, n2 = 0;
      for (let i0 = 0; i0 < NI; i0 += blk) {
        const fp = ((i0 + blk / 2) / fsI) * speed * REC_FPS - 0.5;
        const [f0, f1, a] = lat(fp);
        const live = fp > -1 && fp < n;
        for (let j = 0; j < order; j++) kk[j] = K[f0 * P + j] + (K[f1 * P + j] - K[f0 * P + j]) * a;
        const g = live ? lerp(G[f0], G[f1], a) * lerp(corr[f0], corr[f1], a) : 0;
        const vo = clamp(lerp(V[f0], V[f1], a), 0, 1);
        const hz = clamp(rec.pitch * shift * semis(lerp(st[f0], st[f1], a)), 40, 1400);
        const inc = hz / fsI;
        const cut = lerp(7900, lerp(2800, 5000, clamp((vo - 0.35) / 0.65, 0, 1)), mix) * fs;
        const as = 1 - Math.exp((-2 * Math.PI * cut) / fsI);
        const pulseAmp = Math.sqrt(1 / inc);
        const sv = g * Math.sqrt(vo);
        const sn = g * Math.sqrt(1 - vo) * noiseAmt;
        const iEnd = Math.min(NI, i0 + blk);
        for (let i = i0; i < iEnd; i++) {
          let pu = carry;
          carry = 0;
          phase += inc;
          if (phase >= 1) {
            phase -= 1;
            // Place each pulse between samples, so high voices stay steady.
            const frac = phase / inc;
            pu += pulseAmp * frac;
            carry = pulseAmp * (1 - frac);
          }
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          const w = (((seed >>> 0) / 4294967296) * 2 - 1) * 1.732;
          p1 += (pu - p1) * as;
          p2 += (p1 - p2) * as;
          n1 += (w - n1) * as;
          n2 += (n1 - n2) * as;
          let y = sv * (p2 + w - n2) + sn * w;
          for (let j = order - 1; j >= 0; j--) {
            y += kk[j] * b[j];
            b[j + 1] = b[j] - kk[j] * y;
          }
          b[0] = y;
          de = y + PRE_EMPH * de;
          out[i] = de;
        }
      }
      return out;
    };
    // Play it once, measure it against the recording frame by frame, and
    // play it again with the level put right.
    const corr = new Float32Array(n).fill(1);
    const first = run(corr);
    const wn = Math.round(0.025 * fsI);
    const lc = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      const ci = Math.round((((f + 0.5) / REC_FPS) / speed) * fsI);
      let s = 0;
      for (let i = Math.max(0, ci - (wn >> 1)); i < Math.min(NI, ci + (wn >> 1)); i++) s += first[i] * first[i];
      const got = Math.sqrt(s / wn);
      lc[f] = got > 1e-7 && rec.rms[f] > 1e-7 ? clamp(Math.log(rec.rms[f] / got), -3, 3) : 0;
    }
    for (let f = 0; f < n; f++) corr[f] = Math.exp((lc[Math.max(0, f - 1)] + 2 * lc[f] + lc[Math.min(n - 1, f + 1)]) / 4);
    let out = resample(run(corr), fsI, sr);
    onePoleHP(out, sr, 70);
    let pk = 0;
    for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
    if (pk > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / pk;
    // The Mouth's own converter: crunchy for gibberish, clean when it's clear.
    crush(out, sr, lerp(16000, 22050, c), Math.round(lerp(8, 12, c)));
    onePoleLP(out, sr, lerp(7000, 10000, c));
    return out;
  }

  // Says a recording again in a character's voice. Same result as render():
  // the samples, and events timed to them for mouths, meters and the box.
  // Give the line's text and the box types it along with the syllables.
  function renderRecording(rec, voice, opts) {
    opts = opts || {};
    const sr = opts.sampleRate || SAMPLE_RATE;
    rec = rec && rec.frames != null ? rec : analyzeRecording(new Float32Array(0), REC_RATE);
    return voiceClip(planRecording(rec, voice, opts.text), sr, rec);
  }

  // ───────────────────────────────── files ─────────────────────────────────

  function encodeWav(samples, sr) {
    sr = sr || SAMPLE_RATE;
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
    return new Uint8Array(buf);
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  // A plain (stored, uncompressed) zip: WAVs barely compress anyway.
  function zip(files, date) {
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  function slug(text, max) {
    const s = String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let out = s.slice(0, max || 40);
    // Cut at a word, not inside one.
    if (s.length > out.length && s[out.length] !== '-' && out.includes('-')) out = out.slice(0, out.lastIndexOf('-'));
    return out.replace(/-+$/g, '') || 'line';
  }

  // ───────────────────────── pixel type & dialogue box ─────────────────────────
  // The client's words appear in a made-up rune alphabet: each letter always
  // gets the same glyph, so it reads like a real language nobody speaks. The
  // punctuation stays readable, which is where the tone lives. Names use a
  // plain 5×7 caps face. Everything is drawn pixel by pixel, so it stays crisp
  // at any whole-number scale and needs no font files.

  const ALIEN = {
    a: '....#/...../###../.#.../..#../..##./..#.#', b: '..#../..#../..###/..#../..#../..#../###..',
    c: '....#/...../#...#/#..#./###../.#.../#....', d: '....#/...../#.#../#.#../###../..#../..#..',
    e: '...../...../..#.#/..##./..#../.#.../###..', f: '#..../#..../###../.#.../..###/...#./....#',
    g: '..#../...../###../..#../..#../..##./..#.#', h: '...../...../..#.#/..###/..#.#/.#.../#....',
    i: '#..../...../..#.#/..#.#/..###/..#../..#..', j: '...../...../..#../..##./..#.#/..#../#####',
    k: '..#../..#../..#.#/..##./###../.#.../#....', l: '..#../...../###.#/...#./#.#../##.../#....',
    m: '..#../..#../..#../.##../#.#../..#../..###', n: '...../...../#..../.#.../..#.#/..###/..#.#',
    o: '#..../...../#...#/.#..#/###.#/...#./....#', p: '..#/..#/###/#.#/#.#/..#/..#',
    q: '..#/.../#../#../#.#/###/#.#', r: '..#/..#/#.#/#.#/#.#/.##/..#',
    s: '....#/...../#..../##.../#.#.#/...##/....#', t: '..#../...../..###/..#../#.#../.##../..#..',
    u: '#..../...../....#/...#./###../.#.../###..', v: '...../...../..#../.##../#.#../..#../#####',
    w: '....#/...../###.#/...#./..#../.##../#.#..', x: '....#/....#/....#/...##/###.#/....#/....#',
    y: '..#../...../#.#../#..#./###.#/#..../#....', z: '....#/...../....#/...#./#.#../##.../#.###',
    0: '....#/....#/..###/..#../###../..#../..#..', 1: '#..../...../..#.#/..#.#/..#.#/..##./..#.#',
    2: '..#../...../....#/...#./..###/.##../#.#..', 3: '....#/....#/..#.#/..###/..#.#/.#.../#....',
    4: '#../#../#.#/#.#/#.#/.##/..#', 5: '..#/..#/###/#../#.#/##./#..',
    6: '..#/.../###/..#/###/..#/..#', 7: '....#/....#/..#.#/..##./..#../.##../#.#..',
    8: '..#../...../#..../.#.../#.#../#.##./#.#.#', 9: '....#/...../#.#../.##../..#../..#../###..',
  };
  const LATIN = {
    A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.',
    C: '.###./#...#/#..../#..../#..../#...#/.###.', D: '####./#...#/#...#/#...#/#...#/#...#/####.',
    E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
    G: '.###./#...#/#..../#.###/#...#/#...#/.####', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    I: '###/.#./.#./.#./.#./.#./###', J: '..###/...#./...#./...#./...#./#..#./.##..',
    K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
    M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/#...#/##..#/#.#.#/#..##/#...#/#...#',
    O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
    Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
    S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
    U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
    W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
    0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.',
    2: '.###./#...#/....#/...#./..#../.#.../#####', 3: '####./....#/....#/.###./....#/....#/####.',
    4: '...#./..##./.#.#./#..#./#####/...#./...#.', 5: '#####/#..../####./....#/....#/#...#/.###.',
    6: '..##./.#.../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...',
    8: '.###./#...#/#...#/.###./#...#/#...#/.###.', 9: '.###./#...#/#...#/.####/....#/...#./.##..',
  };
  const PUNCT = {
    '.': './././././././#', ',': '../../../../../.#/#.', '!': '#/#/#/#/#/./#', '?': '.###./#...#/....#/...#./..#../...../..#..',
    "'": '#/#/./././././.', '’': '#/#/./././././.', '‘': '#/#/./././././.', '"': '#.#/#.#/.../.../.../.../...',
    '“': '#.#/#.#/.../.../.../.../...', '”': '#.#/#.#/.../.../.../.../...', '-': '.../.../.../###/.../.../...',
    '‐': '.../.../.../###/.../.../...', '–': '.../.../.../####/.../.../...'.replace('####', '###'),
    '—': '...../...../...../#####/...../...../.....', ':': './././#/./././#', ';': '../../.#/../../.#/#.',
    '(': '.#/#./#./#./#./#./.#', ')': '#./.#/.#/.#/.#/.#/#.', '/': '....#/...#./...#./..#../.#.../.#.../#....',
    '&': '.##../#..#./.##../.#.../#.#.#/#..#./.##.#', '$': '..#../.####/#.#../.###./..#.#/####./..#..',
    '#': '.#.#./#####/.#.#./.#.#./#####/.#.#./.....', '*': '...../#.#.#/.###./#####/.###./#.#.#/.....',
    '+': '...../..#../..#../#####/..#../..#../.....', '=': '...../...../#####/...../#####/...../.....',
    '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##', '@': '.###./#...#/#.###/#.#.#/#.##./#..../.####',
    '…': '...../...../...../...../...../...../#.#.#', '•': '.../.../.../###/.../.../...'.replace('###', '.#.'),
    '<': '...#/..#./.#../#.../.#../..#./...#', '>': '#.../.#../..#./...#/..#./.#../#...',
  };
  const glyphCache = new Map();
  function parseGlyph(str) {
    const rows = str.split('/');
    return { w: rows[0].length, rows };
  }
  // A glyph for one character, or null for a space.
  function glyph(ch, script) {
    const key = (script || 'alien') + ch;
    if (glyphCache.has(key)) return glyphCache.get(key);
    let g = null;
    if (!/\s/.test(ch)) {
      if (PUNCT[ch]) g = parseGlyph(PUNCT[ch]);
      else if (script === 'latin') {
        const up = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
        g = parseGlyph(LATIN[up] || LATIN[up[0]] || PUNCT['?']);
      } else {
        const low = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        if (ALIEN[low]) g = parseGlyph(ALIEN[low]);
        else if (/[\p{L}\p{N}]/u.test(ch)) g = parseGlyph(ALIEN['abcdefghijklmnopqrstuvwxyz'[hash32(ch) % 26]]);
        else g = parseGlyph(PUNCT['•']);
      }
    }
    glyphCache.set(key, g);
    return g;
  }

  function wordWidth(word, script) {
    let w = 0;
    for (const ch of word) {
      const g = glyph(ch, script);
      if (g) w += g.w + 1;
    }
    return Math.max(0, w - 1);
  }

  // Wraps text into lines that fit `width` virtual pixels. Each glyph keeps
  // its index in the text, so callers can reveal it in time with the voice.
  function layoutText(text, width, script) {
    const lines = [];
    let line = { items: [], w: 0 };
    const SPACE = 3;
    const re = /\S+/g;
    let m;
    const pushWord = (word, start) => {
      const ww = wordWidth(word, script);
      if (line.items.length && line.w + SPACE + ww > width) {
        lines.push(line);
        line = { items: [], w: 0 };
      }
      let x = line.items.length ? line.w + SPACE : 0;
      for (let k = 0; k < word.length; k++) {
        const g = glyph(word[k], script);
        if (!g) continue;
        if (x + g.w > width && line.items.length) {
          lines.push(line);
          line = { items: [], w: 0 };
          x = 0;
        }
        line.items.push({ i: start + k, x, g });
        x += g.w + 1;
        line.w = x - 1;
      }
    };
    while ((m = re.exec(text))) pushWord(m[0], m.index);
    if (line.items.length || !lines.length) lines.push(line);
    return lines;
  }

  // Dialogue box colours. `key` is the outer edge, so the box reads on any
  // background.
  const THEMES = {
    ink: { name: 'Ink', key: '#07070b', border: '#f1eadb', fill: '#13141c', text: '#f1eadb', dim: '#8d8a94', accent: '#e9b44c' },
    paper: { name: 'Paper', key: '#f4efe5', border: '#16161d', fill: '#f4efe5', text: '#16161d', dim: '#8c8790', accent: '#c2412d' },
    royal: { name: 'Royal', key: '#0a0c2a', border: '#f4f4ff', fill: '#1f2a8c', text: '#ffffff', dim: '#9aa4e6', accent: '#ffd84d' },
    pocket: { name: 'Pocket', key: '#0f380f', border: '#0f380f', fill: '#9bbc0f', text: '#0f380f', dim: '#306230', accent: '#306230' },
    amber: { name: 'Amber', key: '#000000', border: '#ffb000', fill: '#160d00', text: '#ffb000', dim: '#8a5e00', accent: '#ffd36b' },
    candy: { name: 'Candy', key: '#4a1834', border: '#4a1834', fill: '#ffe3f0', text: '#4a1834', dim: '#b07595', accent: '#ff4f9a' },
  };
  const THEME_ORDER = ['ink', 'paper', 'royal', 'pocket', 'amber', 'candy'];

  // ─────────────────────────────── portraits ───────────────────────────────
  // A 16×16 face for each of the cast. Each letter is a colour from the
  // face's palette (k outline, s skin, h shade, a and b accents, w light,
  // g extra); e is an eye, which closes when the face blinks, and . is the
  // background. The mouth is drawn on top, open as far as the voice is loud.

  const FACES = {
    hero: { bg: '#1f4f2a', pal: 'k141218 s74452a h5a341e a4a2c1d g7a4c32 be0484a wfff6ea cf2c14e f1d8a87', mouth: [7, 12, 2, 'k'],
      rows: '.kkkk......kkkk./kagaak....kaagak/kgaaaakkkkaaaagk/kaaaakaaaakaaaak/.kkkaaaaaaaakkk./...kbbbbbbbbk.../..kabbbbbbbbakbb/..kassssssssakb./..ksEessssEesk../..kskksssskksk../.ckhsssssssshkc./.cksssssssssskc./..kssssssssssk../...kssssssssk.../...kffkkkkffk.../..kffffffffffk..' },
    narrator: { bg: '#3a2140', pal: 'k141218 sb07a52 h8f5d3b a3a3a46 c24170f g6e4a35 bff5a4a dc23a30 wf4efe6 yfcf434 p9c59d1 qffffff z141218', mouth: [7, 12, 2, 'k'],
      rows: '....kkkkkkkk..../...kaaaaaaaak.../..kakgcggcgkak../..kacgccccgcak../..kkgcgccgcgkk../.kbkcssssssckbk./kbbksssssssskbbk/kbbksssssssskbbk/kbbksEessEeskbbk/kbdkskksskkskdbk/.kkkhsssssshkkk./...kssssssssk.../...kssssssssk.../....kssssssk..../..kwwkkkkkyqwk../.kwwwwwkkwpzwwk.' },
    henchling: { bg: '#173a5e', pal: 'k141218 sff9a3c he0712a affd23f b3a3a46 wffffff gff6b8a', mouth: [6, 12, 4, 'k'],
      rows: '......kkkk....../....kkaaaakk..../...kaaaaaaaak.../...kaaaaaaaak.../..kkkkkkkkkkkk../kk.kssssssssk.kk/ksksswwsswwssksk/ksskswekswekssk./.kssswkkswkkssk./..ksssssssssssk./..kgsssssssssgk./..kssssssssssk../..kssssssssssk../...kssssssssk.../....kbbbbbbk..../...kbbbbbbbbk...' },
    wizard: { bg: '#26285e', pal: 'k14141c sc48d5f ha5714a a7b55d6 bf2c14e gdcd6cc ca9a39a fe3b04b rd77a63 wffffff m5b3fb0', mouth: [7, 13, 2, 'k'],
      rows: '..........kk..../.........kaak.../........kaabk.../......kkaaaak.../....kkaaaaaaak../...kaaabaaaaaak./kaaaaaaaaaaaaaak/kkgggssssssgggkk/..kgffssssffgk../..kfEefssfEefk../..kfkkfssfkkfk../..kgffrssrffgk../..kgssssssssgk../..kgssssssssgk../.kmkgsssssskgmk./kmmmkkkkkkkkmmmk' },
    villain: { bg: '#4a1020', pal: 'k0e0b10 sc6acdc ha487c4 a1d1424 wff4d5e ge9b44c bff3b4e cb0283f x7a1528 d8a1236 p7d5aa6 qf4f0ff', mouth: [7, 12, 2, 'd'],
      rows: '................/....kkkkkkkk..../...kaqaaaaaak.../..kaqqaaaaaaak../.kaqgggbbgggaak./.kaqsssaasssaak./.kaqssssssssaak./.kaasppssppsaak./.kaasEessEesaak./.kaaskksskksaak./.kaahsssssshaak./.kaassssssssaak./ckaassssssssaakc/ckaakksssskkaakc/cxkaakksskkaakxc/cxxkaakkkkaakxxc' },
    sidekick: { bg: '#14595a', pal: 'k14141c sf1c6a2 hd99f7a aff6b4a bffffff gb8532a c8c3a1c f2a3d8f wffffff u5bcefa pf5a9b8 qffffff', mouth: [7, 11, 2, 'k'],
      rows: '....kkkkkkkk..../...kaaabbaaaa.../..kaaaaaaaaaakk./..kkkkkkkkkkkaak/..kggggggggggk../..kgssssssssgk../..kgssssssssgk../..kgEessssEegk../.kgkkksssskkkgk./.kghshsssshshgk./kggksssssssskggk/kgk.kssssssk.kgk/.k...kkkkkk...k./....kfffffuk..../...kffffffpfk.../...kffffffqfk...' },
    agent: { bg: '#1d2533', pal: 'k0d0d12 s8a5434 h6d3f25 a1a1414 c241a16 b4b8bd6 wf4f4f4 g9aa3ad t2a2a33 u5bcefa pf5a9b8 qffffff', mouth: [7, 12, 2, 'k'],
      rows: '................/....kkkkkkkk..../...kaaaaaaaak.../..kaaaaaaaaaak../..kassssssssak../..kssssssssssk../..kssssssssssk../..kkkkkkkkkkkk../..kkbbbkkbbbkk../..ksbbkkkkbbsk../..gshsssssshsk../..gcssssssssck../.gkccsssssscck../...kcccccccck.../..wkkcccccckkw../.wwttkkkkkkupqw.' },
    computer: { bg: '#0b1d2e', pal: 'k0a0d12 s2c3e50 h1f2d3a a8fa3b5 b59f0c8 wd7e3ec gff5c7a', mouth: [5, 10, 6, 'b'],
      rows: '................/..kkkkkkkkkkkk../.kaaaaaaaaaaaak./.kakkkkkkkkkkak./.kaksssssssskak./.kaksssssssskak./.kaksbbssbbskak./.kaksbbssbbskak./.kaksssssssskak./.kaksssssssskak./.kaksssssssskak./.kakkkkkkkkkkak./.kaaaaaaaaagak../.kkkkkkkkkkkkkk./.....kaaaak...../...kkkkkkkkkk...' },
    robot: { bg: '#5a3a12', pal: 'k141218 sb8c0c8 h8a939c ae9b44c bff4d4d weef2f5 g5c646d', mouth: [5, 11, 6, 'b'],
      rows: '.......bb......./.......kk......./.......kk......./..kkkkkkkkkkkk../.kssssssssssssk./aksssssssssssska/aksskkkssskkkska/.kskbbkssskbbks./aksskkkssskkkska/aksssssssssssska/.ksgggggggggssk./.ksgkgkgkgkgssk./.kssssssssssssk./.kkkkkkkkkkkkkk./....kggggggk..../..kkkkkkkkkkkk..' },
    fairy: { bg: '#3d2050', pal: 'k1b1224 s9b6240 h7e4c30 a7ef0c8 gc8fff0 b9ff3ff wffffff fffd84d rc46a5a', mouth: [7, 11, 2, 'k'],
      rows: '...f........f.../bb....kkkk....bb/bbb..kaggak..bbb/.bbbkaaaaaakbbb./..bkaaaaaaaakb../...kaassssaak.../..kassssssssak../..kassssssssak../..kasEessEesak../..kaskksskksak../..kahrssssrhak../..kassssssssak../...kassssssak.../....kksssskk..../.bb..kaaaak..bb./..b...kkkk...b..' },
    ghost: { bg: '#1c2a3a', pal: 'k141a26 seaf2ff hb9c8e4 a7f93b8 b9ff3ff wffffff gc8d6ee', mouth: [7, 10, 2, 'k'],
      rows: '................/.....kkkkkk...../....kssssssk..../...kssssssssk.../..kssssssssssk../..kskkssssskksk./..kskkssssskksk./..kssssssssssk../..khssssssssshk./..kssssssssssk../..kssssssssssk../..khssssssssshk./..kssssssssssk../..ksshsssshssk../..ksk.kssk.ksk../..kk...kk...kk..' },
    golem: { bg: '#2c3324', pal: 'k141412 s8d8a7c h6b6a5e a5f8a3a b7fbf4a wffe28a g4d4c44', mouth: [6, 12, 4, 'k'],
      rows: '..kkkkkkkkkkk.../.khsssshsssssk../.ksssssssshssk../kssshssssssssbk./ksbsssssshsssak./kssssssssssssak./kshkkkkssskkkkk./kssskwkssskwksk./ksssskkssskksssk/khsssssssssshssk/kssssshkhssssssk/ksssssssssssssk./kshsssssssssshk./ksssssssssssssk./.kkssssssssskk../...kkkkkkkkk....' },
    guard: { bg: '#4a3b2a', pal: 'k141218 sf2c4a2 hd9a07c a9aa3ad bd0d6dc g6b7480 cc8642f d9a4a22 re04848 wffffff', mouth: [6, 12, 4, 'k'],
      rows: '......krk......./.....krrrk....../....kkkkkkkk..../...kaaaaaaaak.../..kabbaaaaaaak../..kaaaaaaaaaak../..kkkkkkkkkkkk../..kgkggkkggkgk../..kssssssssssk../..ksEessssEesk../..kskksssskksk../..kcssshhsssck../..kccsssssscck../..kcccdccdccck../...kcccccccck.../..kakkcccckkaka.' },
    critter: { bg: '#5a2a3a', pal: 'k1a1214 se8a86a hc9824a afff1e0 bff8fa8 wffffff gffb4c4', mouth: [7, 11, 2, 'k'],
      rows: '.kkk........kkk./kshsk......kshsk/ksbsk......ksbsk/kssskkkkkkkkssk./.kssssssssssssk./kssssssssssssssk/ksswkssssssswksk/kswekssssssweksk/ksskkssssssskksk/kgssssakkassssgk/ksssssaaaassssk./kssssaaaaaassssk/.ksssaaaaaasssk./..kssaaaaaassk../...kkkkkkkkkk.../................' },
  };
  const FACE_ORDER = Object.keys(FACES);
  const faceCache = new Map();
  function faceData(id) {
    if (faceCache.has(id)) return faceCache.get(id);
    const f = FACES[id];
    if (!f) return null;
    const pal = { '.': f.bg };
    for (const e of f.pal.split(' ')) pal[e[0]] = '#' + e.slice(1);
    const d = { bg: f.bg, pal, mouth: f.mouth, rows: f.rows.split('/') };
    faceCache.set(id, d);
    return d;
  }
  // Draws face `id` with its top-left corner at x, y, one unit per pixel of
  // the face. o.open, 0..1, opens the mouth; o.blink closes the eyes;
  // o.bg: false leaves the background out.
  function drawFace(ctx, id, x, y, o) {
    o = o || {};
    const f = faceData(id);
    if (!f) return false;
    for (let r = 0; r < 16; r++) {
      const row = f.rows[r];
      let c = 0;
      while (c < 16) {
        const ch = row[c];
        let e = c + 1;
        while (e < 16 && row[e] === ch) e++;
        // 'e' is an eye and 'E' its glint; both close to skin on a blink
        let col = ch === 'e' ? (o.blink ? f.pal.s : '#14141c') : ch === 'E' ? (o.blink ? f.pal.s : f.pal.w || '#ffffff') : f.pal[ch];
        if (!(ch === '.' && o.bg === false) && col) {
          ctx.fillStyle = col;
          ctx.fillRect(x + c, y + r, e - c, 1);
        }
        c = e;
      }
    }
    const [mx, my, mw, mk] = f.mouth;
    const open = clamp(o.open || 0, 0, 1);
    ctx.fillStyle = f.pal[mk];
    ctx.fillRect(x + mx, y + my, mw, open < 0.15 ? 1 : 2);
    if (open >= 0.5) {
      const inset = mw >= 4 ? 1 : 0;
      ctx.fillStyle = mk === 'k' ? '#c2414b' : f.pal.w;
      ctx.fillRect(x + mx + inset, y + my + 1, mw - 2 * inset, 1);
    }
    return true;
  }
  const LINE_H = 11;
  const TAB_H = 15;

  // o.portrait, optional, puts a framed picture of the speaker at the left of
  // the box, the way RPGs do, and moves the text over: { face, open, blink }
  // for one of the cast, or { size, draw(ctx, x, y) } for your own.
  function measureDialog(o) {
    const width = o.width || 180;
    const ps = o.portrait ? o.portrait.size || 16 : 0;
    const pw = ps ? ps + 7 : 0;
    const lines = layoutText(o.text || '', width - 16 - pw, o.script || 'alien');
    const min = ps ? Math.ceil((ps + 2) / LINE_H) : 1;
    // o.rows fixes the box at that many lines and pages through the text.
    const n = o.rows ? Math.max(o.rows, min) : Math.max(o.lines || 1, min, lines.length);
    const tab = o.speaker ? TAB_H - 3 : 0;
    return { width, height: tab + n * LINE_H + 11, boxHeight: n * LINE_H + 11, tab, lines, n, pw, ps };
  }

  function rrect(ctx, x, y, w, h, r, color) {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    if (r >= 2 && w > 4 && h > 4) {
      ctx.fillRect(x + 2, y, w - 4, h);
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillRect(x, y + 2, w, h - 4);
    } else if (r >= 1 && w > 2 && h > 2) {
      ctx.fillRect(x + 1, y, w - 2, h);
      ctx.fillRect(x, y + 1, w, h - 2);
    } else ctx.fillRect(x, y, w, h);
  }
  function drawGlyph(ctx, g, x, y, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      let run = -1;
      for (let c = 0; c <= row.length; c++) {
        const on = row[c] === '#';
        if (on && run < 0) run = c;
        if (!on && run >= 0) {
          ctx.fillRect(x + run, y + r, c - run, 1);
          run = -1;
        }
      }
    }
  }
  function drawWindow(ctx, x, y, w, h, T) {
    rrect(ctx, x, y, w, h, 2, T.key);
    rrect(ctx, x + 1, y + 1, w - 2, h - 2, 2, T.border);
    rrect(ctx, x + 2, y + 2, w - 4, h - 4, 1, T.fill);
  }

  // Draws the dialogue box into a canvas where one unit is one pixel of the
  // box. Scale the canvas up with `image-rendering: pixelated`.
  //   o.text, o.speaker, o.script ('alien' | 'latin'), o.width, o.lines
  //   o.rows and o.from: a box of exactly that many lines showing the text
  //   from line o.from, for paging through a long line the way games do
  //   o.visible(i) -> whether character i is showing (default: all)
  //   o.open 0..1 (the box unfolding), o.cursor (show the ▼), o.level 0..1
  //   (the talk meter by the name), o.whisper (dim text), o.theme
  function drawDialog(ctx, o) {
    const T = typeof o.theme === 'object' ? o.theme : THEMES[o.theme || 'ink'];
    const M = measureDialog(o);
    const x0 = o.x || 0;
    const y0 = (o.y || 0) + M.tab;
    const W = M.width;
    const H = M.boxHeight;
    const open = o.open == null ? 1 : clamp(o.open, 0, 1);
    const script = o.script || 'alien';
    if (open <= 0) return M;
    if (open < 1) {
      // Unfolds from a line in the middle, in whole pixels.
      const h = Math.max(4, Math.round(H * open));
      drawWindow(ctx, x0, y0 + Math.round((H - h) / 2), W, h, T);
      return M;
    }
    if (o.speaker) {
      const name = String(o.speaker).toUpperCase();
      const tw = wordWidth(name.replace(/\s/g, ' '), 'latin') + (name.split(' ').length - 1) * 2;
      const meter = 9;
      const tabW = tw + 12 + meter;
      drawWindow(ctx, x0 + 5 + M.pw, y0 - M.tab, tabW, TAB_H, T);
      let tx = x0 + 5 + M.pw + 6;
      for (const ch of name) {
        if (ch === ' ') { tx += 5; continue; }
        const g = glyph(ch, 'latin');
        if (!g) continue;
        drawGlyph(ctx, g, tx, y0 - M.tab + 4, T.text);
        tx += g.w + 1;
      }
      // Talk meter: three bars that move with the voice.
      const lv = clamp(o.level || 0, 0, 1);
      const ph = o.meterPhase || 0;
      for (let b = 0; b < 3; b++) {
        const wob = 0.6 + 0.4 * Math.abs(Math.sin(ph * 2.3 + b * 1.9));
        const hgt = lv > 0.02 ? Math.max(2, Math.round(lv * [4, 6, 5][b] * wob)) : [2, 3, 4][b];
        ctx.fillStyle = lv > 0.02 ? T.accent : T.dim;
        ctx.fillRect(tx + 3 + b * 2, y0 - M.tab + 11 - hgt, 1, hgt);
      }
    }
    drawWindow(ctx, x0, y0, W, H, T);
    if (o.portrait) {
      const ps = M.ps;
      const py = y0 + Math.round((H - ps) / 2);
      ctx.fillStyle = T.border;
      ctx.fillRect(x0 + 4, py - 1, ps + 2, ps + 2);
      if (o.portrait.face) drawFace(ctx, o.portrait.face, x0 + 5, py, o.portrait);
      else o.portrait.draw(ctx, x0 + 5, py);
    }
    const color = o.whisper ? T.dim : T.text;
    const vis = o.visible || (() => true);
    const from = o.rows ? o.from || 0 : 0;
    M.lines.forEach((ln, li) => {
      const r = li - from;
      if (r < 0 || r >= M.n) return;
      for (const it of ln.items) if (vis(it.i)) drawGlyph(ctx, it.g, x0 + 8 + M.pw + it.x, y0 + 7 + r * LINE_H, color);
    });
    if (o.cursor) {
      const cx = x0 + W - 13;
      const cy = y0 + H - 8;
      ctx.fillStyle = T.text;
      ctx.fillRect(cx, cy, 5, 1);
      ctx.fillRect(cx + 1, cy + 1, 3, 1);
      ctx.fillRect(cx + 2, cy + 2, 1, 1);
    }
    return M;
  }

  // When each character of the text should appear, from the voice's events:
  // letters type on across their syllable, punctuation lands with the letter
  // before it.
  function revealTimes(text, events) {
    const n = text.length;
    const times = new Float64Array(n).fill(NaN);
    for (const e of events) {
      const span = Math.max(1, e.c1 - e.c0);
      for (let k = e.c0; k < e.c1; k++) {
        const t = e.t + ((k - e.c0) / span) * e.d * 0.75;
        if (isNaN(times[k]) || t < times[k]) times[k] = t;
      }
    }
    let last = events.length ? events[0].t : 0;
    for (let k = 0; k < n; k++) {
      if (isNaN(times[k])) times[k] = last;
      else last = times[k];
    }
    return times;
  }

  // How loud the voice is at time t, 0..1, for meters and mouths.
  function talkLevel(events, t) {
    for (const e of events) {
      if (t >= e.t && t < e.t + e.d) return clamp(e.a * (1 - 0.45 * ((t - e.t) / e.d)), 0, 1);
    }
    return 0;
  }

  return {
    VERSION,
    SAMPLE_RATE,
    STYLES,
    STYLE_ORDER,
    PRESETS,
    PRESET_ORDER,
    MOODS,
    MOOD_ORDER,
    moodMix,
    DEFAULT_VOICE,
    normVoice,
    parseLine,
    analyze,
    plan,
    render,
    analyzeRecording,
    renderRecording,
    encodeWav,
    zip,
    slug,
    THEMES,
    THEME_ORDER,
    FACES,
    FACE_ORDER,
    drawFace,
    glyph,
    layoutText,
    measureDialog,
    drawDialog,
    revealTimes,
    talkLevel,
  };
});
