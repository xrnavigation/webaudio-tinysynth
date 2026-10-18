import TinySynth = require('@xrnavigation/webaudio-tinysynth');
const song: TinySynth.MIDISong = TinySynth.parseMIDI(Uint8Array.from([
  77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,4,0,255,47,0,
]).buffer);
const lastTick: number = song.maxTick;
const parsed: TinySynth.ParsedMIDISong = TinySynth.parseMIDI(new Uint8Array(), { maxTracks: 8 });
const file: ArrayBuffer = TinySynth.writeMIDI(parsed, { sysex: 'omit', maxBytes: 1024 });
const meter: TinySynth.MIDITrackEvent = { t: 0, kind: 'meta', type: 88, data: [4, 2, 24, 8] };
// @ts-expect-error only explicit omission or rejection is supported
TinySynth.writeMIDI(parsed, { sysex: 'execute' });
const context = new OfflineAudioContext(2, 48000, 48000);
const synth = new TinySynth({ audioContext: context, destination: context.destination });
const download: Promise<void> = synth.loadMIDIUrl('');
const partial: TinySynth.TimbrePartial = { w: 'sine', v: 0.4, d: 0.7, r: 0.1 };
synth.setTimbre(0, 0, [partial, { w: 'triangle', g: 1, t: 2, a: 0.01, s: 0.1 }]);
synth.setTimbre(1, 35, [{ w: 'n0', f: 110, t: 0, h: 0.02, p: 0.1, q: 0.1, k: -1 }]);
synth.setTimbre(0, 1, [{ w: 'w9999' }]);
// @ts-expect-error waveform must be supported by the runtime
synth.setTimbre(0, 1, [{ w: 'custom' }]);
// @ts-expect-error envelope times are numeric
synth.setTimbre(0, 1, [{ a: 'slow' }]);
const voice: TinySynth.Voice = synth.playNote({ program: 73, note: 60, gain: 0, duration: 1 });
const drum: TinySynth.Voice = synth.playNote({ percussion: true, note: 38, startTime: 1, duration: 0.1 });
// @ts-expect-error percussion uses the drum note, not a melodic program
synth.playNote({ percussion: true, program: 0, note: 38 });
voice.gain = 0.5;
voice.release();
voice.stop();
const done: Promise<void> = voice.ended;
const closed: Promise<void> = synth.dispose();
synth.send(new Uint8Array([0x90, 60, 100]));
// @ts-expect-error note is required
synth.playNote({ program: 73 });
// @ts-expect-error state cannot be mutated
voice.state = 'ended';
void done; void closed;
