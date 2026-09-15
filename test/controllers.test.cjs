const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSynth } = require('./harness.cjs');

function setup() {
  const { Synth, context } = loadSynth(require.resolve('../webaudio-tinysynth.js'));
  const synth = new Synth({ audioContext: context, useReverb: 0 });
  synth.allSoundOff(0);
  return { synth, context };
}

test('full reset and new MIDI load clear GS scale tuning', async () => {
  const { synth } = setup();
  const tune = () => synth.send([0xf0,0x41,0x10,0x42,0x12,0x40,0x11,0x40,114,0,0xf7]);
  tune(); assert.equal(synth.scaleTuning[0][0], 0.5);
  synth.reset(); assert.equal(synth.scaleTuning[0][0], 0);
  tune(); synth.loadMIDI(Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,4,0,255,47,0]).buffer);
  assert.ok(synth.scaleTuning.every(scale => scale.every(value => value === 0)));
  await synth.dispose();
});

test('controller reset releases pedal-held notes and cancels stale bend automation', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100); const note = synth.notetab[0];
  synth.setBend(0,16383,0.1); synth.setSustain(0,127); synth.noteOff(0,60);
  synth.send([0xb0,121,0]);
  assert.ok(note.e < 1, 'pedal-held note has a finite release tail');
  const events = note.o[0].detune._impl._timeline;
  assert.ok(events.every(event => event.args[0] === 0), 'future bend is canceled');
  await synth.dispose();
});

test('All Notes Off preserves sustain and release tails while All Sound Off silences', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100); synth.setSustain(0,127); synth.send([0xb0,123,0]);
  assert.equal(synth.notetab.length, 1);
  assert.equal(synth.notetab[0].f, 1);
  synth.setSustain(0,0); const end=synth.notetab[0].e;
  assert.ok(end < 1);
  synth.setSustain(0,0,0.5);
  assert.equal(synth.notetab[0].e, end, 'repeated pedal-up must not restart release');
  synth.send([0xb0,120,0]); assert.equal(synth.notetab.length, 0);
  await synth.dispose();
});

test('melodic channel ten releases and noise partials receive live bend', async () => {
  const { synth } = setup();
  synth.send([0xf0,0x41,0x10,0x42,0x12,0x40,0x10,0x15,0,0,0xf7]);
  synth.setTimbre(0,0,[{w:'n0',s:1,d:1,r:0.1}]);
  synth.noteOn(9,60,100); const note=synth.notetab[0];
  synth.setBend(9,16383,0.1);
  assert.ok(note.o[0].detune._impl._timeline.some(event => event.args[0] > 100));
  synth.noteOff(9,60,0.2);
  assert.ok(note.g[0].gain._impl._timeline.some(event => event.type === 'setTargetAtTime' && event.time === 0.2 && event.args[0] === 0));
  await synth.dispose();
});

test('pedal-up and reset do not advance an already scheduled note release', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100); synth.noteOff(0,60,2);
  const note=synth.notetab[0], end=note.e;
  synth.setSustain(0,0,1);
  assert.equal(note.e,end);
  synth.resetAllControllers(0);
  assert.equal(note.e,end);
  await synth.dispose();
});
