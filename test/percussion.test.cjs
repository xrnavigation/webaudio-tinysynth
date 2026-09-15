const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

for (const operation of ['allSoundOff', 'stopMIDI', 'reset']) {
  test(`${operation} cancels scheduled percussion and preserves independent voices`, async () => {
    const { Synth, context } = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
    const synth = new Synth({ audioContext: context, useReverb: 0 });
    synth.allSoundOff(0);
    const voice = synth.playNote({ program: 73, note: 60 });
    const baseline = synth._nodes.size;
    synth.noteOn(9, 49, 100, 0.5);
    synth[operation](9);
    assert.equal(synth._nodes.size, baseline);
    assert.equal(synth.notetab.length, 0);
    assert.equal(voice.state, 'playing');
    voice.stop();
    const rendered = await context.startRendering();
    assert.ok(rendered.getChannelData(0).every(sample => sample === 0));
    await synth.dispose();
  });
}

test('percussion participates in the MIDI limit and naturally leaves the registry', async () => {
  const { Synth, context } = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
  const synth = new Synth({ audioContext: context, useReverb: 0 });
  synth.allSoundOff(0);
  const voice = synth.playNote({ program: 73, note: 60 });
  const baseline = synth._nodes.size;
  synth.setVoices(3);
  for (let i = 0; i < 12; i++) {
    synth.noteOn(9, 38, 100, 0.01 + i * 0.001);
    assert.equal(synth.notetab.length, Math.min(i + 1, 3));
    assert.ok(synth.notetab.every(note => note.rhythm && note.ch === 9));
  }
  assert.equal(voice.state, 'playing');
  await context.startRendering();
  assert.equal(synth.notetab.length, 0);
  assert.equal(synth._nodes.size, baseline);
  await synth.dispose();
});

test('melodic notes and percussion share one MIDI voice budget', async () => {
  const { Synth, context } = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
  const synth = new Synth({ audioContext: context, useReverb: 0 });
  synth.allSoundOff(0);
  synth.setVoices(3);
  synth.noteOn(0, 60, 100, 0.01);
  synth.noteOn(9, 38, 100, 0.02);
  synth.noteOn(0, 64, 100, 0.03);
  synth.noteOn(9, 40, 100, 0.04);
  assert.equal(synth.notetab.length, 3);
  assert.equal(synth.notetab.filter(note => note.rhythm).length, 1);
  assert.equal(synth.notetab.filter(note => !note.rhythm).length, 2);
  await synth.dispose();
});
