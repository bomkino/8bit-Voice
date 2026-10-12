// Types for chipvoice.js, so TypeScript projects (a Remotion video, say) can
// import it: `import CV from './chipvoice'`.

declare namespace ChipVoice {
  type StyleId = 'square' | 'pocket' | 'babble' | 'typewriter' | 'boss' | 'chip' | 'mouth';
  type PresetId =
    | 'hero'
    | 'narrator'
    | 'henchling'
    | 'wizard'
    | 'villain'
    | 'sidekick'
    | 'agent'
    | 'computer'
    | 'robot'
    | 'fairy'
    | 'ghost'
    | 'golem'
    | 'guard'
    | 'critter';
  type FaceId = PresetId;
  type ThemeId = 'ink' | 'paper' | 'royal' | 'pocket' | 'amber' | 'candy';
  type MoodId =
    | 'whisper'
    | 'quiet'
    | 'shout'
    | 'awed'
    | 'faster'
    | 'fast'
    | 'slow'
    | 'high'
    | 'low'
    | 'flat'
    | 'excited'
    | 'sad'
    | 'offended'
    | 'panic';

  interface Voice {
    style: StyleId;
    /** Semitones, -24 to 24. */
    pitch: number;
    /** 0.4 to 2.5, 1 is normal. */
    speed: number;
    /** 0 is monotone, 1 is sing-song. */
    melody: number;
    /** The machine's own knob (Bite, Nasal, Squeak, Click, Menace, Buzz, Clarity), 0 to 1. */
    character: number;
    /** Bit-crush, 0 to 1. */
    grit: number;
    /** Through a phone speaker. */
    phone: boolean;
    /** Each take is a slightly different performance of the same settings. */
    take: number;
  }
  type VoiceInput = Partial<Voice> | StyleId | PresetId;

  interface Style {
    name: string;
    era: string;
    blurb: string;
    character: string;
    characterHint: string;
    unit: 'syl' | 'letter' | 'char';
    baseHz: number;
    rate: number;
    [key: string]: unknown;
  }
  interface Preset {
    name: string;
    /** A short genre label, such as "Fantasy". */
    tag: string;
    /** Which portrait in FACES is theirs. */
    face: FaceId;
    note: string;
    voice: Partial<Voice> & { style: StyleId };
  }
  interface Mood {
    label: string;
    re: RegExp;
    [key: string]: unknown;
  }
  interface ParsedLine {
    text: string;
    mood: { keys: MoodId[]; very: Partial<Record<MoodId, boolean>> };
    direction: string;
    speaker: string | null;
    phone: boolean;
  }
  /** One syllable, letter or blip: when it sounds, which characters of the text it voices, how loud, and its pitch in semitones. */
  interface VoiceEvent {
    t: number;
    d: number;
    c0: number;
    c1: number;
    a: number;
    p0: number;
    p1: number;
    cut: boolean;
  }
  interface Rendered {
    samples: Float32Array;
    sampleRate: number;
    /** Seconds. */
    duration: number;
    /** The words that were voiced, without speaker or stage directions. */
    text: string;
    mood: MoodId[];
    moodLabel: string;
    voice: Voice;
    events: VoiceEvent[];
  }
  interface RenderOptions {
    sampleRate?: number;
    /** Overrides the stage direction in the line. */
    mood?: MoodId | MoodId[] | { keys: MoodId[]; very?: Partial<Record<MoodId, boolean>> };
  }
  interface Glyph {
    w: number;
    rows: string[];
  }
  interface Theme {
    name?: string;
    key: string;
    border: string;
    fill: string;
    text: string;
    dim: string;
    accent: string;
  }
  interface DialogOptions {
    text?: string;
    speaker?: string | null;
    script?: 'alien' | 'latin';
    /** Box width in box pixels. */
    width?: number;
    /** Minimum number of text lines. */
    lines?: number;
    /** Exactly this many text lines, paging through longer text from line `from`. */
    rows?: number;
    /** With `rows`, the first line showing. */
    from?: number;
    theme?: ThemeId | Theme;
    /** A framed picture of the speaker at the left of the box: one of the cast, or your own drawing. */
    portrait?: FaceOptions & { face: FaceId | Face } | { size: number; draw(ctx: CanvasRenderingContext2D, x: number, y: number): void };
    x?: number;
    y?: number;
    /** Whether character i of the text is showing. */
    visible?: (i: number) => boolean;
    /** 0 to 1, the box unfolding. */
    open?: number;
    /** Shows the ▼ at the bottom right. */
    cursor?: boolean;
    /** 0 to 1, the talk meter by the name. */
    level?: number;
    meterPhase?: number;
    /** Dims the text. */
    whisper?: boolean;
  }
  interface FaceOptions {
    /** 0 to 1, how far the mouth is open. */
    open?: number;
    /** Closes the eyes. */
    blink?: boolean;
    /** false leaves the background out. */
    bg?: boolean;
  }
  interface Face {
    bg: string;
    /** Space-separated palette entries: a letter, then a hex colour. */
    pal: string;
    /** x, y, width and palette letter of the mouth. */
    mouth: [number, number, number, string];
    /** Sixteen rows of sixteen palette letters, separated by "/". "." is the background, "e" an eye and "E" its glint, which close on a blink. */
    rows: string;
  }
  type LookKey =
    | 'skin'
    | 'head'
    | 'hair'
    | 'hairColor'
    | 'cover'
    | 'coverColor'
    | 'eyes'
    | 'brows'
    | 'mouth'
    | 'lips'
    | 'cheeks'
    | 'age'
    | 'facial'
    | 'glasses'
    | 'earrings'
    | 'outfit'
    | 'outfitColor'
    | 'pin'
    | 'bg';
  /** A made-up character: which option of each part, by index. */
  type Look = Record<LookKey, number>;
  /** Parts by name ("Umber", "Locs") or index; anything left out is the first option. */
  type LookInput = Partial<Record<LookKey, number | string>> | string;
  interface DialogMetrics {
    width: number;
    height: number;
    boxHeight: number;
    tab: number;
    lines: { items: { i: number; x: number; g: Glyph }[]; w: number }[];
    n: number;
    /** Room taken by the portrait, in box pixels. */
    pw: number;
    ps: number;
  }
}

declare const ChipVoice: {
  VERSION: string;
  SAMPLE_RATE: number;
  STYLES: Record<ChipVoice.StyleId, ChipVoice.Style>;
  STYLE_ORDER: ChipVoice.StyleId[];
  PRESETS: Record<ChipVoice.PresetId, ChipVoice.Preset>;
  PRESET_ORDER: ChipVoice.PresetId[];
  MOODS: Record<ChipVoice.MoodId, ChipVoice.Mood>;
  MOOD_ORDER: ChipVoice.MoodId[];
  DEFAULT_VOICE: ChipVoice.Voice;
  moodMix(mood: unknown): Record<string, unknown> & { keys: ChipVoice.MoodId[]; label: string };
  normVoice(v?: ChipVoice.VoiceInput): ChipVoice.Voice;
  parseLine(raw: string): ChipVoice.ParsedLine;
  analyze(text: string): unknown;
  plan(input: string | ChipVoice.ParsedLine, voice?: ChipVoice.VoiceInput, opts?: ChipVoice.RenderOptions): unknown;
  render(input: string | ChipVoice.ParsedLine, voice?: ChipVoice.VoiceInput, opts?: ChipVoice.RenderOptions): ChipVoice.Rendered;
  encodeWav(samples: Float32Array, sampleRate?: number): Uint8Array;
  zip(files: { name: string; data: Uint8Array }[], date?: Date): Uint8Array;
  slug(text: string, max?: number): string;
  THEMES: Record<ChipVoice.ThemeId, ChipVoice.Theme>;
  THEME_ORDER: ChipVoice.ThemeId[];
  FACES: Record<ChipVoice.FaceId, ChipVoice.Face>;
  FACE_ORDER: ChipVoice.FaceId[];
  /** Draws a 16×16 face, one of the cast or your own, with its top-left corner at x, y. Returns false for an unknown face. */
  drawFace(ctx: CanvasRenderingContext2D, id: ChipVoice.FaceId | ChipVoice.Face, x: number, y: number, o?: ChipVoice.FaceOptions): boolean;
  /** Every part of the character creator and its options, as [name, data] pairs. Lists only grow at the end, so codes stay valid. */
  LOOK_PARTS: Record<ChipVoice.LookKey, [string, ...unknown[]][]>;
  LOOK_KEYS: ChipVoice.LookKey[];
  /** The human cast as looks, to start from. */
  STARTER_LOOKS: Partial<Record<ChipVoice.PresetId, ChipVoice.LookInput>>;
  normLook(look?: ChipVoice.LookInput): ChipVoice.Look;
  /** A short code for links, such as "1a060900210000010200". */
  encodeLook(look: ChipVoice.LookInput): string;
  decodeLook(code: string): Partial<ChipVoice.Look>;
  /** A random look from the whole range; `keep` holds parts to leave as they are. */
  randomLook(seed: number | string, keep?: Partial<ChipVoice.Look>): ChipVoice.Look;
  /** Paints a look into a face drawFace() and portraits can use. */
  buildFace(look: ChipVoice.LookInput): ChipVoice.Face;
  glyph(ch: string, script?: 'alien' | 'latin'): ChipVoice.Glyph | null;
  layoutText(text: string, width: number, script?: 'alien' | 'latin'): ChipVoice.DialogMetrics['lines'];
  measureDialog(o: ChipVoice.DialogOptions): ChipVoice.DialogMetrics;
  drawDialog(ctx: CanvasRenderingContext2D, o: ChipVoice.DialogOptions): ChipVoice.DialogMetrics;
  revealTimes(text: string, events: ChipVoice.VoiceEvent[]): Float64Array;
  talkLevel(events: ChipVoice.VoiceEvent[], t: number): number;
};

export = ChipVoice;
