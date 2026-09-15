const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

function midi(track) {
  return [77,84,104,100,0,0,0,6,0,0,0,1,1,224,
    77,84,114,107,0,0,0,track.length,...track];
}
const valid = midi([0,0x90,60,100,1,0x80,60,0,0,0xff,0x2f,0]);
const malformed = [
  midi([0,0x90,60,100]), [], valid.slice(0, 12), valid.slice(0, -1),
  midi([0x80]),
  midi([0x81,0x80,0x80,0x80,0,0xff,0x2f,0]),
  midi([0,0x90,60]), midi([0,60,100,0,0xff,0x2f,0]),
  midi([0,0x90,60,0xff,0,0xff,0x2f,0]),
  midi([0,0xff,1,5,65]), midi([0,0xf0,5,1]),
  midi([0,0xff,0x51,2,1,2,0,0xff,0x2f,0]),
  midi([0,0xff,0x2f,1,0]), midi([0,0xf1,0,0xff,0x2f,0]),
  [...valid.slice(0,10),0,2,...valid.slice(12),
    ...midi([0,60,100,0,0xff,0x2f,0]).slice(14)],
];

for (const file of ['webaudio-tinysynth.js', 'webaudio-tinysynth.min.js']) {
  test(`${file}: malformed MIDI is bounded and leaves playback intact`, () => {
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const { loadSynth } = require('./test/harness.cjs');
      const { Synth } = loadSynth(${JSON.stringify(path.join(__dirname, '..', file))});
      const synth = new Synth({ useReverb: 0 });
      synth.loadMIDI(Uint8Array.from(${JSON.stringify(valid)}).buffer);
      const song = synth.song;
      const maxTick = synth.maxTick;
      synth.playing = 1;
      for (const bytes of ${JSON.stringify(malformed)}) {
        assert.throws(() => synth.loadMIDI(Uint8Array.from(bytes).buffer), /Invalid MIDI/);
        assert.equal(synth.song, song);
        assert.equal(synth.maxTick, maxTick);
        assert.equal(synth.playing, 1);
      }
    `], { cwd: path.join(__dirname, '..'), timeout: 5000, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });

  test(`${file}: valid running status and text payloads still load`, () => {
    const { Synth } = loadSynth(path.join(__dirname, '..', file));
    const synth = new Synth({ useReverb: 0 });
    synth.loadMIDI(Uint8Array.from(midi([
      0,0xff,3,2,65,66,0,0x90,60,100,1,61,100,0,0xff,0x2f,0,
    ])).buffer);
    assert.equal(synth.song.text, 'AB');
    assert.equal(synth.song.ev.length, 2);
    assert.equal(synth.song.ev[1].m[0], 0x90);
  });
}
