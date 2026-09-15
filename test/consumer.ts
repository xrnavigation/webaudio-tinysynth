import TinySynth = require('@xrnavigation/webaudio-tinysynth');
const context = new OfflineAudioContext(2, 48000, 48000);
const synth = new TinySynth({ audioContext: context, destination: context.destination });
const partial: TinySynth.TimbrePartial = { w: 'sine', v: 0.4, d: 0.7, r: 0.1 };
synth.setTimbre(0, 0, [partial, { w: 'triangle', g: 1, t: 2, a: 0.01, s: 0.1 }]);
synth.setTimbre(1, 35, [{ w: 'n0', f: 110, t: 0, h: 0.02, p: 0.1, q: 0.1, k: -1 }]);
synth.setTimbre(0, 1, [{ w: 'w9999' }]);
// @ts-expect-error waveform must be supported by the runtime
synth.setTimbre(0, 1, [{ w: 'custom' }]);
// @ts-expect-error envelope times are numeric
synth.setTimbre(0, 1, [{ a: 'slow' }]);
const voice: TinySynth.Voice = synth.playNote({ program: 73, note: 60, gain: 0, duration: 1 });
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
