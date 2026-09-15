const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');
// Updated for per-partial release levels. Native Chromium independently checks
// these envelope equations in scripts/check-envelopes.cjs; hashes guard drift.
const expected = {
  73: '419de5787a7b507ae1278206a11bd93bafb3ef7bc36490a652436b8efd3ebb0a',
  0: '591773cd6e1c8d54acdafd5694007c60eef626f970111c4079061450493b50d5',
  24: '5913f9088151bc56be5dbdcdd7828b86e57fb44a0fcf0269b69ec9a0d6d6b097',
  12: '22d7807de287494e7b6dc27384a10a11c24dd5c26316407e9b139f843663d6a7',
  8: 'fa86e0e9215e2675c1def027dea3a01898d63fa8a6dc2784f026c32c58bccc0d',
  68: '7673f083051161c6df9f974bd535cd72a711fc234af01b04a255664ccc793e1a',
  46: '1d545db3173c325290b28f41a93f3eb783dffcaef467ec70cfc5974623451f0b',
  11: '0263e4216cb149230be0e223ecf57149f03f104125b0c759957986d00c9ef1e8',
  122: '73f62034969052b4f4f46b9b1071ba660d8a6ddd6cc0c092469d0da7a017060a',
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
