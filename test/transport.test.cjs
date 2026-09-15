const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

function sequence(track) {
  const harness = loadSynth(path.join(__dirname, '..', 'webaudio-tinysynth.js'));
  let now = 0;
  Object.defineProperty(harness.context, 'currentTime', { get: () => now });
  const synth = new harness.Synth({ useReverb: 0 });
  synth.loadMIDI(Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,
    77,84,114,107,0,0,0,track.length,...track]).buffer);
  const sent = [];
  const dispatch = synth._sendAtAudioTime;
  synth._sendAtAudioTime = (message, time) => {
    if(time > now) sent.push({ message: [...message], time });
    dispatch(message, time);
  };
  return { synth, sent, advance(time) { now = time; harness.tick(); } };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

test('first-event offset and trailing rest survive scheduling ahead', () => {
  const h = sequence([131,96,192,0,131,96,255,47,0]);
  h.synth.playMIDI();
  near(h.synth.playTime, 0.6);
  h.advance(0.5);
  near(h.sent[0].time, 0.6);
  assert.equal(h.synth.playing, 1);
  h.advance(1.09);
  assert.equal(h.synth.playing, 1);
  h.advance(1.1);
  assert.equal(h.synth.playing, 0);
  assert.equal(h.synth.playTick, 960);
});

test('seek inside leading or trailing rests preserves remaining time', () => {
  const h = sequence([131,96,192,0,131,96,255,47,0]);
  h.synth.locateMIDI(240);
  h.synth.playMIDI();
  near(h.synth.playTime, 0.35);
  h.synth.stopMIDI();
  h.synth.locateMIDI(720);
  h.synth.playMIDI();
  h.advance(0.2);
  assert.equal(h.sent.length, 0);
  assert.equal(h.synth.playing, 1);
  h.advance(0.35);
  assert.equal(h.synth.playing, 0);
});

test('restart and looping use initial tempo after a tempo-changing run', () => {
  const h = sequence([129,112,192,0,129,112,255,81,3,15,66,64,131,96,255,47,0]);
  h.synth.preroll = 2;
  h.synth.playMIDI();
  h.advance(0);
  near(h.sent[0].time, 0.35);
  h.advance(1.6);
  assert.equal(h.synth.playing, 0);
  h.synth.playMIDI();
  near(h.synth.playTime, 1.95);
  h.advance(1.6);
  near(h.sent[1].time, 1.95);
  h.synth.stopMIDI();
  h.synth.locateMIDI(0);
  h.synth.loop = 1;
  h.synth.playMIDI();
  h.advance(1.6);
  near(h.sent[2].time, 1.95);
  near(h.sent[3].time, 3.45);
});

test('seeking exactly onto an event dispatches it at the new origin', () => {
  const h = sequence([131,96,192,0,131,96,255,47,0]);
  h.synth.locateMIDI(480);
  h.synth.playMIDI();
  near(h.synth.playTime, 0.1);
});
