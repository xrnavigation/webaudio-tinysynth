const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadSynth } = require('./harness.cjs');

for (const file of ['webaudio-tinysynth.js', 'webaudio-tinysynth.min.js']) {
  for (const commonjs of [true, false]) {
    test(`${file}: ${commonjs ? 'CommonJS' : 'browser'} GM instruments and MIDI rendering`, async () => {
      const { Synth, context } = loadSynth(path.join(__dirname, '..', file), commonjs);
      const synth = new Synth({ useReverb: 0 });
      assert.equal(synth.program.length, 128);
      assert.equal(createHash('sha256').update(JSON.stringify({
        program: synth.program, drummap: synth.drummap,
      })).digest('hex'), 'd278c199863881186f45a7e29cd546fa1a6b96a38fc02bf02f003ecf5bd189ec',
      'all generated GM and percussion timbres retain the upstream definitions');
      assert.equal(synth.rhythm[9], 1);
      synth.send([0xc0, 10]);
      assert.equal(synth.pg[0], 10);
      synth.send([0x90, 69, 100], 0.01);
      synth.send([0x80, 69, 0], 0.2);
      const audio = await context.startRendering();
      const samples = audio.getChannelData(0);
      assert.ok(samples.every(Number.isFinite));
      assert.ok(samples.some(value => Math.abs(value) > 0.001), 'MIDI note produces actual audio');
    });
  }
}
