// Types for chipvoice.js, so TypeScript projects (like the Remotion one in
// ./remotion) can import it: `import CV from '../../chipvoice'`.

declare namespace ChipVoice {
  type StyleId = 'square' | 'pocket' | 'babble' | 'typewriter' | 'boss' | 'chip';
  type PresetId =
    | 'horror-director'
    | 'romcom-director'
    | 'heist-producer'
    | 'space-director'
    | 'period-director'
    | 'studio-exec';
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
    /** The machine's own knob (Bite, Nasal, Squeak, Click, Menace, Buzz), 0 to 1. */
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
    episode: string;
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
    theme?: 'ink' | 'paper' | Theme;
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
  interface DialogMetrics {
    width: number;
    height: number;
    boxHeight: number;
    tab: number;
    lines: { items: { i: number; x: number; g: Glyph }[]; w: number }[];
    n: number;
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
  THEMES: Record<'ink' | 'paper', ChipVoice.Theme>;
  glyph(ch: string, script?: 'alien' | 'latin'): ChipVoice.Glyph | null;
  layoutText(text: string, width: number, script?: 'alien' | 'latin'): ChipVoice.DialogMetrics['lines'];
  measureDialog(o: ChipVoice.DialogOptions): ChipVoice.DialogMetrics;
  drawDialog(ctx: CanvasRenderingContext2D, o: ChipVoice.DialogOptions): ChipVoice.DialogMetrics;
  revealTimes(text: string, events: ChipVoice.VoiceEvent[]): Float64Array;
  talkLevel(events: ChipVoice.VoiceEvent[], t: number): number;
};

export = ChipVoice;
