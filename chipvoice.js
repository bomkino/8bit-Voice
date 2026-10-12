/*!
 * chipvoice.js · the engine behind 8-bit Voice (pitch.dog), made for Typecast
 * https://github.com/bomkino/8bit-Voice · MIT License
 *
 * Type a line and get it back as a video-game voice. The words stay unreadable;
 * the rhythm, the melody and the punctuation stay human, so whoever answers can
 * tell the audience what was said.
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

  const VERSION = '1.0.0';
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
  };
  const STYLE_ORDER = ['square', 'pocket', 'babble', 'typewriter', 'boss', 'chip'];

  const SCALES = {
    pentatonic: [0, 2, 4, 7, 9],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };

  // ──────────────────────────────── presets ────────────────────────────────
  // One per client in season 1. Each picks a machine and dials it in; every
  // knob stays adjustable.

  const PRESETS = {
    'horror-director': {
      name: 'Horror director',
      episode: 'Ep 1',
      note: 'Calm, deep and a little too pleased about the haunted house.',
      voice: { style: 'boss', pitch: 3, speed: 1.1, melody: 0.4, character: 0.45, grit: 0 },
    },
    'romcom-director': {
      name: 'Rom-com director',
      episode: 'Ep 2',
      note: 'Bubbly, impatient, types faster than they think.',
      voice: { style: 'babble', pitch: 0, speed: 1.05, melody: 0.65, character: 0.55, grit: 0 },
    },
    'heist-producer': {
      name: 'Heist producer',
      episode: 'Ep 3',
      note: 'Clipped and quick. Says everything like a code word.',
      voice: { style: 'square', pitch: -3, speed: 1.12, melody: 0.4, character: 0.75, grit: 0 },
    },
    'space-director': {
      name: 'Space director',
      episode: 'Ep 4',
      note: 'Grand plans, computer voice. The same take every loop.',
      voice: { style: 'chip', pitch: 0, speed: 1, melody: 0.55, character: 0.45, grit: 0 },
    },
    'period-director': {
      name: 'Period director',
      episode: 'Ep 5',
      note: 'Theatrical, loves a long vowel, hears violins.',
      voice: { style: 'pocket', pitch: -7, speed: 0.85, melody: 0.85, character: 0.3, grit: 0 },
    },
    'studio-exec': {
      name: 'Studio exec',
      episode: 'Any',
      note: 'No time, no patience, no inflection.',
      voice: { style: 'typewriter', pitch: -4, speed: 1.15, melody: 0.15, character: 0.65, grit: 0 },
    },
  };
  const PRESET_ORDER = ['horror-director', 'romcom-director', 'heist-producer', 'space-director', 'period-director', 'studio-exec'];

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
            items.push(Object.assign({}, base, { kind: 'syl', key: s.text, c0: s.c0, c1: s.c1, onset: s.onsetT, coda: s.codaT, vowels: s.vowels, n: s.letters.length }));
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
          onset: it.onset, coda: it.coda, vowels: it.vowels, stressed: it.stressed, caps: it.caps, key: it.key, isVowel: it.isVowel,
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
    const sr = opts.sampleRate || SAMPLE_RATE;
    const pl = plan(input, voice, opts);
    let x;
    if (!pl.units.length) x = new Float32Array(Math.round(sr * 0.25));
    else if (pl.style === 'typewriter') x = synthTypewriter(pl, sr);
    else if (pl.style === 'babble') x = synthBabble(pl, sr);
    else if (pl.style === 'chip') x = synthSpeechChip(pl, sr);
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

  const THEMES = {
    ink: { key: '#07070b', border: '#f1eadb', fill: '#13141c', text: '#f1eadb', dim: '#8d8a94', accent: '#e9b44c' },
    paper: { key: '#f4efe5', border: '#16161d', fill: '#f4efe5', text: '#16161d', dim: '#8c8790', accent: '#c2412d' },
  };
  const LINE_H = 11;
  const TAB_H = 15;

  function measureDialog(o) {
    const width = o.width || 180;
    const lines = layoutText(o.text || '', width - 16, o.script || 'alien');
    const n = Math.max(o.lines || 1, lines.length);
    const tab = o.speaker ? TAB_H - 3 : 0;
    return { width, height: tab + n * LINE_H + 11, boxHeight: n * LINE_H + 11, tab, lines, n };
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
      drawWindow(ctx, x0 + 5, y0 - M.tab, tabW, TAB_H, T);
      let tx = x0 + 5 + 6;
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
        const hgt = lv > 0.02 ? Math.max(1, Math.round(lv * [4, 6, 5][b] * wob)) : 1;
        ctx.fillStyle = lv > 0.02 ? T.accent : T.dim;
        ctx.fillRect(tx + 3 + b * 2, y0 - M.tab + 11 - hgt, 1, hgt);
      }
    }
    drawWindow(ctx, x0, y0, W, H, T);
    const color = o.whisper ? T.dim : T.text;
    const vis = o.visible || (() => true);
    M.lines.forEach((ln, li) => {
      for (const it of ln.items) if (vis(it.i)) drawGlyph(ctx, it.g, x0 + 8 + it.x, y0 + 7 + li * LINE_H, color);
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
    encodeWav,
    zip,
    slug,
    THEMES,
    glyph,
    layoutText,
    measureDialog,
    drawDialog,
    revealTimes,
    talkLevel,
  };
});
