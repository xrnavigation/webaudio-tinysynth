const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadSynth } = require('./harness.cjs');
const source = path.join(__dirname, '..', 'webaudio-tinysynth.js');
function setup(duration = 1) {
  const { Synth, context } = loadSynth(source, true, {}, duration);
  const synth = new Synth({ audioContext: context, useReverb: 0 });
  synth.allSoundOff(0);
  return { synth, context };
}
test('identical voices have independent lifetime and gain', async () => {
  const { synth } = setup();
  const a = synth.playNote({ program: 73, note: 60, velocity: 100, gain: 0.5 });
  const b = synth.playNote({ program: 73, note: 60, velocity: 100, gain: 0.7 });
  a.gain = 0;
  assert.equal(b.gain, 0.7);
  a.stop();
  await a.ended;
  assert.equal(a.state, 'ended');
  assert.equal(b.state, 'playing');
  a.stop(); a.release(); a.gain = 1;
  assert.equal(b.gain, 0.7);
  await synth.dispose();
  await b.ended;
});
test('future release never prevents immediate stop and retained handles are inert', async () => {
  const { synth } = setup();
  const baseline = synth._nodes.size;
  for (const program of [46, 11, 122]) {
    const voice = synth.playNote({ program, note: 60, startTime: 0.5, duration: 10 });
    assert.equal(voice.state, 'scheduled');
    voice.stop();
    await voice.ended;
    voice.release(100);
    assert.equal(synth._nodes.size, baseline);
  }
  await synth.dispose();
});
test('validation happens before allocation', async () => {
  const { synth, context } = setup();
  const baseline = synth._nodes.size;
  for (const options of [{program:128}, {note:NaN}, {gain:-1}, {velocity:128}, {duration:-1}, {startTime:Infinity}]) {
    assert.throws(() => synth.playNote({program:0,note:60,...options}), /invalid/i);
    assert.equal(synth._nodes.size, baseline);
  }
  const other = setup();
  assert.throws(() => synth.playNote({program:0,note:60,destination:other.context.destination}), /destination/i);
  assert.equal(synth._nodes.size, baseline);
  await synth.dispose(); await other.synth.dispose();
});

async function stereoRender(changeA, mutateMidi = false) {
  const { synth, context } = setup();
  synth.setMasterVol(0); // custom destinations are dry and bypass this MIDI bus
  const left = context.createStereoPanner(), right = context.createStereoPanner();
  left.pan.value = -1; right.pan.value = 1;
  left.connect(context.destination); right.connect(context.destination);
  const a = synth.playNote({ program: 73, note: 60, destination: left, startTime: 0.01, duration: 0.3 });
  const b = synth.playNote({ program: 11, note: 60, destination: right, startTime: 0.01, duration: 0.3 });
  if (mutateMidi) {
    synth.setVoices(1);
    for (let ch = 0; ch < 16; ch++) {
      synth.send([0xc0 + ch, 122]);
      synth.send([0xb0 + ch, 7, 0]);
      synth.send([0xb0 + ch, 1, 127]);
      synth.send([0xe0 + ch, 0, 127]);
      synth.send([0xb0 + ch, 64, 127]);
      synth.send([0xb0 + ch, 10, 0]);
      synth.send([0x90 + ch, 60, 100]);
      synth.allSoundOff(ch);
    }
    synth.reset();
  }
  if (changeA) changeA(a);
  const rendered = await context.startRendering();
  await synth.dispose();
  await Promise.all([a.ended, b.ended]);
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}

test('stereo render proves independent gain, stop and MIDI controller isolation', async () => {
  const baseline = await stereoRender();
  const muted = await stereoRender(a => { a.gain = 0; });
  const stopped = await stereoRender(a => a.stop());
  const midi = await stereoRender(null, true);
  assert.ok(baseline[0].some(sample => Math.abs(sample) > 0.001));
  assert.ok(baseline[1].some(sample => Math.abs(sample) > 0.001));
  assert.ok(muted[0].every(sample => Math.abs(sample) < 1e-7));
  assert.ok(stopped[0].every(sample => Math.abs(sample) < 1e-7));
  const hash = samples => createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex');
  assert.equal(hash(muted[1]), hash(baseline[1]));
  assert.equal(hash(stopped[1]), hash(baseline[1]));
  assert.deepEqual(midi.map(hash), baseline.map(hash));
});

test('natural completion releases every layer and keeps bookkeeping bounded', async () => {
  for (const program of [0, 73, 122]) {
    const { synth, context } = setup(5);
    const baseline = synth._nodes.size;
    const voices = Array.from({ length: 5 }, (_, i) => synth.playNote({ program, note: 60 + i, duration: 0.02 }));
    await context.startRendering();
    await Promise.all(voices.map(voice => voice.ended));
    assert.equal(synth._voices.size, 0);
    assert.equal(synth._nodes.size, baseline);
    const replacement = synth.playNote({ program, note: 60 });
    voices.forEach(voice => { voice.stop(); voice.release(); voice.gain = 0; });
    assert.equal(replacement.state, 'playing');
    await synth.dispose();
    await replacement.ended;
    assert.equal(synth._nodes.size, 0);
  }
});

test('stop during sustain or a long release silences all layers immediately', async () => {
  for (const program of [46, 11, 122]) {
    const { synth, context } = setup();
    const destination = context.createGain();
    destination.connect(context.destination);
    let disconnected = 0;
    const disconnect = destination.disconnect.bind(destination);
    destination.disconnect = (...args) => { disconnected++; return disconnect(...args); };
    const voice = synth.playNote({program, note:60, destination});
    voice.release(0);
    assert.equal(voice.state, 'releasing');
    voice.stop();
    await voice.ended;
    const audio = await context.startRendering();
    assert.ok(audio.getChannelData(0).every(value => value === 0));
    assert.equal(disconnected, 0);
    await synth.dispose();
  }
});

test('builder failure releases allocated nodes without harming another voice', async () => {
  const { synth, context } = setup();
  const other = synth.playNote({ program: 73, note: 60 });
  const baseline = synth._nodes.size;
  const create = context.createOscillator.bind(context);
  let calls = 0;
  context.createOscillator = () => {
    if (++calls === 2) throw new Error('allocation failed');
    return create();
  };
  assert.throws(() => synth.playNote({ program: 0, note: 60 }), /allocation failed/);
  assert.equal(synth._nodes.size, baseline);
  assert.equal(other.state, 'playing');
  assert.equal(synth._voices.size, 1);
  await synth.dispose();
});

test('default output obeys master volume and context replacement completes additive voices', async () => {
  const { synth, context } = setup();
  synth.setMasterVol(0);
  const voice = synth.playNote({program:73,note:60,duration:0.1});
  const audio = await context.startRendering();
  await voice.ended;
  assert.ok(audio.getChannelData(0).every(value => value === 0));
  const pending = synth.playNote({program:0,note:60,startTime:10});
  const other = setup();
  await synth.setAudioContext(other.context);
  await pending.ended;
  assert.equal(pending.state, 'ended');
  assert.equal(synth._voices.size, 0);
  await synth.dispose(); await other.synth.dispose();
});

test('all 128 generated melodic programs support independent start and cleanup', async () => {
  const { synth } = setup();
  const baseline = synth._nodes.size;
  for (let program = 0; program < 128; program++) {
    const voice = synth.playNote({ program, note: 60 });
    assert.equal(voice.state, 'playing', `program ${program}`);
    voice.stop();
    await voice.ended;
    assert.equal(synth._nodes.size, baseline, `program ${program} leaked nodes`);
    assert.equal(synth._voices.size, 0);
  }
  await synth.dispose();
});
