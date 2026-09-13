export as namespace WebAudioTinySynth;
export = WebAudioTinySynth;

declare class WebAudioTinySynth {
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
  loadMIDIUrl(url: string): void;
  playMIDI(): void;
  stopMIDI(): void;
  locateMIDI(tick: number): void;
  getPlayStatus(): { play: number; maxTick: number; curTick: number };
  getTimbreName(mode: number, program: number): string;
}

declare namespace WebAudioTinySynth {
  interface Options {
    audioContext?: BaseAudioContext;
    destination?: AudioNode;
    useReverb?: number;
    quality?: number;
    voices?: number;
  }
  interface NoteOptions {
    program: number;
    note: number;
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
