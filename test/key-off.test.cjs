const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSynth } = require('./harness.cjs');

function setup() {
  const { Synth, context } = loadSynth(require.resolve('../webaudio-tinysynth.js'), true, {}, 3);
  const synth = new Synth({ audioContext: context, useReverb: 0 });
  synth.allSoundOff(0);
  return { synth, context };
}

test('an earlier note-off replaces a scheduled later note-off', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100,0.01); const note=synth.notetab[0];
  synth.noteOff(0,60,2);
  assert.equal(note.releaseAt,2);
  synth.noteOff(0,60,0.5);
  assert.equal(note.releaseAt,0.5);
  assert.equal(note.e,0.5+Math.max(...note.r)*synth.releaseRatio);
  await synth.dispose();
});

test('a later note-off does not extend an earlier one', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100,0.01); const note=synth.notetab[0];
  synth.noteOff(0,60,0.5); const end=note.e;
  synth.noteOff(0,60,2);
  assert.equal(note.releaseAt,0.5);
  assert.equal(note.e,end);
  await synth.dispose();
});

test('All Notes Off replaces a scheduled later note-off', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100,0.01); const note=synth.notetab[0];
  synth.noteOff(0,60,2);
  synth._allNotesOff(0,0.5);
  assert.equal(note.releaseAt,0.5);
  await synth.dispose();
});

test('an earlier note-off leaves a pedal-held note held until pedal-up', async () => {
  const { synth } = setup();
  synth.noteOn(0,60,100,0.01); const note=synth.notetab[0];
  synth.setSustain(0,127);
  synth.noteOff(0,60,2);
  synth.noteOff(0,60,0.5);
  assert.equal(note.releaseAt,undefined);
  assert.equal(note.keyOffAt,0.5);
  synth.setSustain(0,0,1);
  assert.equal(note.releaseAt,1);
  await synth.dispose();
});
