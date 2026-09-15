const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSynth } = require('./harness.cjs');

function setup() {
  const h = loadSynth(require.resolve('../webaudio-tinysynth.js'));
  const synth = new h.Synth({ audioContext: h.context, useReverb: 0 });
  const track = [
    0,144,60,100, 10,128,60,0, 110,192,40,
    120,176,101,0, 0,176,100,1, 0,176,6,65,
    120,224,127,127,
    120,240,7,127,127,4,4,0,69,247,
    120,240,10,65,16,66,18,64,17,64,76,0,247,
    120,255,47,0,
  ];
  synth.loadMIDI(Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,
    77,84,114,107,0,0,0,track.length,...track]).buffer);
  return { ...h, synth };
}

test('forward and backward seek reconstruct program, RPN, bend and SysEx state', async () => {
  const { synth } = setup();
  const independent = synth.playNote({ program: 0, note: 64, velocity: 100 });
  synth.locateMIDI(650);
  assert.equal(synth.pg[0], 40);
  assert.equal(synth.tuningF[0], 128);
  assert.ok(synth.bend[0]>100);
  assert.equal(synth.masterTuningC, 5);
  assert.equal(synth.scaleTuning[0][0], 0.12);
  assert.equal(synth.notetab.length, 0, 'seeking does not sound prior notes');
  synth.locateMIDI(0);
  assert.equal(synth.pg[0], 0);
  assert.equal(synth.tuningF[0], 0);
  assert.equal(synth.bend[0], 0);
  assert.equal(synth.masterTuningC, 0);
  assert.equal(synth.scaleTuning[0][0], 0);
  assert.equal(independent.state, 'playing');
  await synth.dispose();
});

test('events at the requested tick remain pending and seeking to end stops', async () => {
  const { synth, tick } = setup();
  synth.locateMIDI(650);
  synth.locateMIDI(120);
  assert.equal(synth.pg[0], 0, 'event at the seek tick has not run');
  synth.playMIDI(); tick();
  assert.equal(synth.pg[0], 40);
  synth.locateMIDI(720);
  assert.equal(synth.playing, 0);
  assert.equal(synth.playTick, 720);
  synth.locateMIDI(1000);
  assert.equal(synth.playTick, 720);
  await synth.dispose();
});

test('seek cancels future channel automation before restoring initial state', async () => {
  const { synth } = setup();
  synth.setPan(0,127,1);
  synth.setModulation(0,127,1);
  synth.setChVol(0,0,1);
  synth.locateMIDI(0);
  assert.ok(synth.chpan[0].pan._impl._timeline.every(e => e.args[0]===0));
  assert.ok(synth.chmod[0].gain._impl._timeline.every(e => e.args[0]===0));
  assert.ok(synth.chvol[0].gain._impl._timeline.every(e => e.args[0]===synth.vol[0]));
  await synth.dispose();
});
