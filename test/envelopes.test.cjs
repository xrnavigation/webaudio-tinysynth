const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

test('MIDI retains the longest partial release, independent of partial order', async () => {
  for (const releases of [[0.01, 0.3], [0.3, 0.01]]) {
    const { Synth, context } = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
    const synth = new Synth({ audioContext: context, useReverb: 0 });
    synth.allSoundOff(0);
    synth.setTimbre(0, 0, releases.map(r => ({ w: 'sine', a: 0.2, h: 0.1, d: 0.2, s: 0.5, r })));
    synth.noteOn(0, 69, 100, 0.01);
    synth.noteOff(0, 69, 0.11);
    assert.equal(synth.notetab[0].e, 0.11 + 0.3 * synth.releaseRatio);
    await synth.dispose();
  }
});
