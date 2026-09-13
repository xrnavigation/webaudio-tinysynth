const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');
// Captured from lifecycle-only commit 414d3a38 before factoring the partial builder.
const expected = {
  73: '1358cf1f001157d17d7bfe68de4cb9d221a1dcd69275f06694846ee0a5d9f209',
  0: '8ea2cb921c3c34459a0fcf456cbffdd3c74f476dd7acbcf2fe1f632afdd84744',
  24: 'a653f47962beba363c181b8a4b83588cc9e847197f0b038e015930567441c02c',
  12: '16955cfc64d32c5a417a16ba13fbf25951033d7af110a3b4d420a088ddd79bfc',
  8: '4f2176c85d5f287004f4627483f97813923a25a0503f8b07a8ea41fb2e07c351',
  68: '8e72c8298755022432e71b10f5e456037014b620f3fc25d2dbc400b8616ab698',
  46: '96b6ee47b009c9449dcdf6791b314b8dba845b7e3517ca87b1313d31af84630d',
  11: '5331176ce2ea8ee61d1340845d009bb61e864ecfca0b14e35071af18d05eaeb4',
  122: 'ba663b06ac9d68ca7de4ff7911b3cb29814a0de0e8a9580f0c40c9b808169c00',
};
for (const [program, hash] of Object.entries(expected)) {
  test(`MIDI program ${program} renders unchanged`, async () => {
    const { Synth, context } = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
    const synth = new Synth({ audioContext: context, useReverb: 0 });
    synth.send([0xc0, +program]);
    synth.send([0x90, 60, 100], 0.01);
    synth.send([0x80, 60, 0], 0.25);
    const audio = await context.startRendering();
    assert.equal(createHash('sha256').update(Buffer.from(audio.getChannelData(0).buffer)).digest('hex'), hash);
    await synth.dispose();
  });
}
