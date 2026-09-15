const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

// A stalled scheduler must fail this test instead of hanging the test runner.
function probe(events, endDelta, checks) {
  const script = `
    const assert = require('node:assert/strict');
    const { loadSynth } = require('./test/harness.cjs');
    const { Synth, tick } = loadSynth('./webaudio-tinysynth.js');
    const synth = new Synth({ useReverb: 0 });
    const track = [...${JSON.stringify(events)}, ...${JSON.stringify(endDelta)}, 255, 47, 0];
    const bytes = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,
      77,84,114,107,0,0,0,track.length,...track]);
    synth.loadMIDI(bytes.buffer);
    synth.loop = 1;
    synth.preroll = 1.2;
    const sent = [];
    synth.send = (message, time) => sent.push({message, time});
    synth.playMIDI();
    tick();
    ${checks}
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'), timeout: 5000, encoding: 'utf8',
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
}

test('real SMF with one tick-zero event loops through trailing silence', () => {
  probe([0, 192, 0], [131, 96], `
    assert.equal(sent.length, 3);
    sent.forEach((event, i) => assert.ok(Math.abs(event.time - (0.1 + i * 0.5)) < 1e-9));
  `);
});

test('zero-duration SMF plays once and stops even when looping', () => {
  probe([0, 192, 0], [0], 'assert.equal(sent.length, 1); assert.equal(synth.playing, 0);');
});

test('loop includes the leading rest before simultaneous first events', () => {
  probe([129, 112, 192, 0, 0, 193, 0], [129, 112], `
    assert.equal(sent.length, 4);
    sent.forEach((event, i) => assert.ok(Math.abs(event.time - (0.35 + Math.floor(i / 2) * 0.5)) < 1e-9));
  `);
});

test('empty SMF remains stopped', () => {
  probe([], [131, 96], 'assert.equal(sent.length, 0); assert.equal(synth.playing, 0);');
});

test('loop restores starting tempo after a later tempo change', () => {
  probe([0, 192, 0, 129, 112, 255, 81, 3, 15, 66, 64], [129, 112], `
    assert.equal(sent.length, 2);
    assert.ok(Math.abs(sent[1].time - 0.85) < 1e-9);
    assert.ok(Math.abs(synth.playTime - 1.6) < 1e-9);
  `);
});
