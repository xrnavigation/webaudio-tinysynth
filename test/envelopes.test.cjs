const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

// A partial without attack used to keep a fresh GainNode's default gain of 1
// until its first automation event. If the audio thread renders a block before
// that schedule applies, the block plays at full gain and the release ramps
// down from 1 (audible as the near-silent warm-up note sounding at full volume).
test('partials without attack start silent before their scheduled level', async () => {
  const newGains = (synth, before) =>
    [...synth._nodes].filter((node) => !before.has(node) && node.gain);
  for (const attack of [0, 0.05]) {
    const { Synth, context } = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
    const synth = new Synth({ audioContext: context, useReverb: 0 });
    synth.setTimbre(0, 0, [{ w: 'sine', a: attack, d: 0.2, s: 0.5, r: 0.1 }]);

    let before = new Set(synth._nodes);
    synth.noteOn(0, 60, 1, 0.5);
    const midiGains = newGains(synth, before);
    assert.equal(midiGains.length, 1);
    assert.equal(midiGains[0].gain.value, 0, `MIDI partial, attack ${attack}`);

    before = new Set(synth._nodes);
    synth.playNote({ program: 0, note: 60, startTime: 0.5, duration: 0.2 });
    const voiceGains = newGains(synth, before);
    // The voice root keeps its requested gain; the partial must start silent.
    assert.deepEqual(
      voiceGains.map((node) => node.gain.value),
      [1, 0],
      `voice partial, attack ${attack}`,
    );
    await synth.dispose();
  }
});

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
