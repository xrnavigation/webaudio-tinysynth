export as namespace WebAudioTinySynth;
export = WebAudioTinySynth;

declare class WebAudioTinySynth {
  /** Parse SMF format 0 or 1 with metrical timing; throws for malformed or unsupported data. */
  static parseMIDI(data: ArrayBuffer | ArrayBufferView, limits?: WebAudioTinySynth.MIDILimits): WebAudioTinySynth.ParsedMIDISong;
  /** Encode supported SMF data without an AudioContext. Structured tracks take precedence over ev. */
  static writeMIDI(song: WebAudioTinySynth.MIDISong, options?: WebAudioTinySynth.MIDIWriteOptions): ArrayBuffer;
  constructor(options?: WebAudioTinySynth.Options);
  playNote(options: WebAudioTinySynth.NoteOptions): WebAudioTinySynth.Voice;
  ready(): Promise<void>;
  dispose(): Promise<void>;
  getAudioContext(): BaseAudioContext | null;
  setAudioContext(context: BaseAudioContext, destination?: AudioNode): Promise<void>;
  send(message: ArrayLike<number>, time?: number): void;
  noteOn(channel: number, note: number, velocity: number, time?: number): void;
  noteOff(channel: number, note: number, time?: number): void;
  allSoundOff(channel: number): void;
  setProgram(channel: number, program: number): void;
  /** mode 0 selects a melodic program (0–127); mode 1 selects a drum note (35–81). */
  setTimbre(mode: 0 | 1, program: number, partials: WebAudioTinySynth.TimbrePartial[]): void;
  setMasterVol(volume: number): void;
  setReverbLev(level: number): void;
  setQuality(quality: number): void;
  setVoices(voices: number): void;
  setLoop(loop: number): void;
  setTsMode(mode: number): void;
  setModulation(channel: number, value: number, time?: number): void;
  setChVol(channel: number, value: number, time?: number): void;
  setPan(channel: number, value: number, time?: number): void;
  setExpression(channel: number, value: number, time?: number): void;
  setSustain(channel: number, value: number, time?: number): void;
  setBend(channel: number, value: number, time?: number): void;
  setBendRange(channel: number, value: number): void;
  resetAllControllers(channel: number): void;
  reset(): void;
  loadMIDI(data: ArrayBuffer): void;
  loadMIDIUrl(url: string): Promise<void>;
  playMIDI(): void;
  stopMIDI(): void;
  locateMIDI(tick: number): void;
  getPlayStatus(): { play: number; maxTick: number; curTick: number };
  getTimbreName(mode: number, program: number): string;
}

declare namespace WebAudioTinySynth {
  interface MIDISong {
    copyright: string;
    text: string;
    /** Initial tempo in BPM; tempo events retain fractional BPM. */
    tempo: number;
    /** Ticks per whole note (four times the SMF division). */
    timebase: number;
    /** Last End-of-Track tick, including trailing silence. */
    maxTick: number;
    /** Sorted by tick, then source track and event order. Tempo messages are [0xff51, BPM]. */
    ev: { t: number; m: number[] }[];
    /** Optional structured source representation; authoritative for writeMIDI. */
    tracks?: MIDITrack[];
    format?: 0 | 1;
    hasSysEx?: boolean;
  }
  interface ParsedMIDISong extends MIDISong {
    tracks: MIDITrack[];
    format: 0 | 1;
    /** SysEx is retained in tracks, never in the playable ev array. */
    hasSysEx: boolean;
  }
  interface MIDITrack {
    /** Original zero-based track index. Descriptive; array order controls export. */
    id?: number;
    /** Last track-name metadata, decoded byte-for-code-unit. Export uses metadata events. */
    name?: string;
    /** Includes trailing silence; EOT is emitted here if absent from events. */
    endTick: number;
    events: MIDITrackEvent[];
  }
  type MIDITrackEvent =
    | { t: number; kind: 'midi'; message: number[] }
    | { t: number; kind: 'meta'; type: number; data: number[] }
    | { t: number; kind: 'sysex'; status: 0xf0 | 0xf7; data: number[] };
  /** Optional lower limits. Raising a hard ceiling, negative or noninteger values throw. */
  interface MIDILimits {
    /** 1 MiB by default. */
    maxBytes?: number;
    /** 16 by default. */
    maxTracks?: number;
    /** 20,000 physical records, including metadata, SysEx and EOT. */
    maxEvents?: number;
    /** 64 KiB total raw metadata payload. */
    maxMetadataBytes?: number;
    /** 4 KiB per metadata or SysEx payload. */
    maxRecordBytes?: number;
    /** 64 KiB total raw SysEx payload, retained inert. */
    maxSysExBytes?: number;
  }
  interface MIDIWriteOptions extends MIDILimits {
    /** Default reject. Omit explicitly discards SysEx and retains its elapsed ticks. */
    sysex?: 'reject' | 'omit';
  }
  interface TimbrePartial {
    /** 0: output; 1–10: frequency modulation of partial g-1; 11+: gain modulation of partial g-11. Targets must precede this partial. */
    g?: number;
    w?: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'n0' | 'n1' | 'w9999';
    /** Frequency multiplier and fixed frequency offset in Hz. */
    t?: number;
    f?: number;
    v?: number;
    /** Attack and hold durations in seconds. */
    a?: number;
    h?: number;
    /** Decay time constant in seconds and sustain level relative to peak. */
    d?: number;
    s?: number;
    /** Release time constant in seconds. */
    r?: number;
    /** Pitch target multiplier and transition time constant in seconds. */
    p?: number;
    q?: number;
    /** Volume key tracking exponent. */
    k?: number;
  }
  interface Options {
    audioContext?: BaseAudioContext;
    destination?: AudioNode;
    useReverb?: number;
    quality?: number;
    voices?: number;
  }
  type NoteOptions = NoteTiming & (
    | { program: number; note: number; percussion?: false }
    | { percussion: true; note: number; program?: never }
  );
  interface NoteTiming {
    velocity?: number;
    gain?: number;
    destination?: AudioNode;
    /** Absolute AudioContext seconds, independent of MIDI timestamp mode. */
    startTime?: number;
    /** Seconds from accepted start until natural release begins. */
    duration?: number;
  }
  interface Voice {
    readonly state: 'scheduled' | 'playing' | 'releasing' | 'ended';
    gain: number;
    readonly ended: Promise<void>;
    /** Immediately silence and dispose every partial, including scheduled sources. */
    stop(): void;
    /** Start the instrument release envelope at absolute AudioContext seconds. */
    release(time?: number): void;
  }
}
