const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSynth } = require('./harness.cjs');

test('partial construction does not enumerate the existing node registry', async () => {
  const { Synth, context } = loadSynth(require.resolve('../webaudio-tinysynth.js'));
  const synth = new Synth({ audioContext: context, useReverb: 0 });
  let visits = 0;
  const iterator = synth._nodes[Symbol.iterator];
  synth._nodes[Symbol.iterator] = function* () {
    for (const node of iterator.call(this)) { visits++; yield node; }
  };
  const voice = synth.playNote({ program: 0, note: 60 });
  voice.stop();
  synth._nodes[Symbol.iterator] = iterator;
  assert.equal(visits, 0);
  await synth.dispose();
});

for (const failure of ['first gain', 'second oscillator']) {
  test(`MIDI ${failure} failure rolls back modulation and only new nodes`, async () => {
    const { Synth, context } = loadSynth(require.resolve('../webaudio-tinysynth.js'));
    const synth = new Synth({ audioContext: context, useReverb: 0 });
    synth.allSoundOff(0);
    synth.noteOn(0, 60, 100);
    const survivor = synth.notetab[0], baseline = synth._nodes.size;
    const modulation = synth.chmod[0], connected = new Set();
    const connect = modulation.connect.bind(modulation), disconnect = modulation.disconnect.bind(modulation);
    modulation.connect = target => { connected.add(target); return connect(target); };
    modulation.disconnect = target => { connected.delete(target); return disconnect(target); };
    const method = failure === 'first gain' ? 'createGain' : 'createOscillator';
    const create = context[method].bind(context);
    let calls = 0;
    context[method] = () => {
      if (++calls === (failure === 'first gain' ? 1 : 2)) throw new Error('injected allocation failure');
      return create();
    };
    assert.throws(() => synth.noteOn(0, 64, 100), /injected allocation failure/);
    context[method] = create;
    assert.equal(connected.size, 0, 'no retained modulation inputs');
    assert.equal(synth._nodes.size, baseline);
    assert.equal(synth.notetab.length, 1);
    assert.equal(synth.notetab[0], survivor);
    const audio = await context.startRendering();
    assert.ok(audio.getChannelData(0).some(sample => Math.abs(sample) > 0.001));
    await synth.dispose();
  });
}
