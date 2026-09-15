const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

function player(mode, now, clock, off = [128,60,0]) {
  const h = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'), true,
    { performance: { now: () => clock } });
  Object.defineProperty(h.context, 'currentTime', { get: () => now });
  const synth = new h.Synth({ useReverb: 0 });
  const track = [0,144,60,100,129,112,176,1,40,129,112,...off,129,112,255,47,0];
  synth.loadMIDI(Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,
    77,84,114,107,0,0,0,track.length,...track]).buffer);
  synth.setTsMode(mode);
  synth.preroll = 2;
  const scheduled = [];
  synth._note = (t, ch, n) => {
    scheduled.push(['on',t]);
    synth.notetab.push({ t, ch, n, f: 0, e: 99999 });
  };
  synth._releaseNote = (nt,t) => { scheduled.push(['off',t]); nt.f=1; };
  synth.chmod[0].gain.setValueAtTime = (v,t) => scheduled.push(['mod',t]);
  return { ...h, synth, scheduled };
}

for (const [now, clock] of [[0,0], [10,100000]]) {
  test(`sequencer uses audio time in both timestamp modes (${now}, ${clock})`, () => {
    for (const mode of [0,1]) {
      const h = player(mode, now, clock);
      h.synth.playMIDI(); h.tick();
      assert.deepEqual(h.scheduled.map(e => e[0]), ['on','mod','off']);
      h.scheduled.forEach((event,i) => assert.ok(Math.abs(event[1]-(now+0.1+i*0.25))<1e-9,
        `mode ${mode}: ${JSON.stringify(h.scheduled)}`));
      assert.equal(h.synth.tsmode, mode);
    }
  });
}

test('external send and direct note methods retain high-resolution timestamps', () => {
  const h = player(1, 10, 100000);
  h.synth.send([144,60,100], 100100);
  h.synth.noteOn(1,60,100,100200);
  h.scheduled.forEach((event,i) => assert.ok(Math.abs(event[1]-(10.1+i*0.1))<1e-9));
});

test('zero-velocity note-on and channel-mode release use internal audio time', () => {
  for (const off of [[144,60,0], ...[123,124,125,126,127].map(cc => [176,cc,0])]) {
    const h = player(1, 10, 100000, off);
    h.synth.playMIDI(); h.tick();
    assert.equal(h.scheduled[2][0], 'off');
    assert.ok(Math.abs(h.scheduled[2][1]-10.6)<1e-9);
  }
});
