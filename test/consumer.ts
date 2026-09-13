import TinySynth = require('@xrnavigation/webaudio-tinysynth');
const context = new OfflineAudioContext(2, 48000, 48000);
const synth = new TinySynth({ audioContext: context, destination: context.destination });
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
