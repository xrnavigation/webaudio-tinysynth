const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function midi(tracks, format = tracks.length > 1 ? 1 : 0, division = 480) {
  return Uint8Array.from([
    77,84,104,100,0,0,0,6,0,format,0,tracks.length,division >> 8,division & 255,
    ...tracks.flatMap(track => [77,84,114,107,0,0,0,track.length,...track]),
  ]).buffer;
}
const end = [0,255,47,0];

for (const file of ['webaudio-tinysynth.js', 'webaudio-tinysynth.min.js']) {
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox);
  const Synth = sandbox.module.exports;
  test(`${file}: parse SMF without AudioContext, preserving tempo and trailing silence`, () => {
    const song = Synth.parseMIDI(midi([[0,255,81,3,7,161,33,0,144,60,100,0x83,0x60,255,47,0]]));
    assert.equal(song.timebase, 1920);
    assert.equal(song.maxTick, 480);
    assert.equal(song.ev[0].m[1], 60000000 / 500001);
    assert.equal(song.ev[1].t, 0);
  });
  test(`${file}: format 1 merges simultaneous events deterministically`, () => {
    const song = Synth.parseMIDI(midi([
      [0,192,3,0,192,4,...end], [0,193,5,...end],
    ]));
    assert.deepEqual(Array.from(song.ev, event => Array.from(event.m)), [[192,3],[192,4],[193,5]]);
  });
  test(`${file}: unsupported formats and time divisions fail explicitly`, () => {
    for (const bytes of [midi([end],2), midi([end],3), midi([end,end],0), midi([],1)]) {
      assert.throws(() => Synth.parseMIDI(bytes), /Invalid MIDI:.*(format|track)/i);
    }
    assert.throws(() => Synth.parseMIDI(midi([end],0,0)), /Invalid MIDI:.*division/i);
    assert.throws(() => Synth.parseMIDI(midi([end],0,0xe728)), /Invalid MIDI:.*SMPTE/i);
  });
}
