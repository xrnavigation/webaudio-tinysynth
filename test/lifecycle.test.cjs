const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { OfflineAudioContext } = require('web-audio-engine');
const { loadSynth } = require('./harness.cjs');
const source = path.join(__dirname, '..', 'webaudio-tinysynth.js');

function context() {
  const ctx = new OfflineAudioContext(2, 22050, 22050);
  ctx.resume = () => Promise.resolve();
  ctx.closed = 0;
  ctx.close = async () => { ctx.closed++; };
  const nodes = [];
  for (const name of ['Gain', 'Oscillator', 'BufferSource', 'DynamicsCompressor', 'StereoPanner', 'Convolver']) {
    const create = ctx['create' + name].bind(ctx);
    ctx['create' + name] = (...args) => {
      const node = create(...args);
      node.disconnections = 0;
      const disconnect = node.disconnect.bind(node);
      node.disconnect = (...args) => { node.disconnections++; return disconnect(...args); };
      nodes.push(node);
      return node;
    };
  }
  return { ctx, nodes };
}

test('injected context avoids internal creation and owns only its graph', async () => {
  let created = 0;
  const { Synth, timers, tick } = loadSynth(source, true, { AudioContext: function () { created++; return context().ctx; } });
  const { ctx, nodes } = context();
  const destination = ctx.createGain();
  const synth = new Synth({ audioContext: ctx, destination, useReverb: 0 });
  assert.equal(created, 0);
  assert.equal(synth.dest, destination);
  synth.send([0x90, 60, 100]);
  synth.send([0x99, 40, 100]);
  await synth.ready();
  await synth.dispose();
  await synth.dispose();
  tick();
  assert.equal(timers.size, 0);
  assert.equal(ctx.closed, 0);
  assert.equal(destination.disconnections, 0);
  assert.ok(nodes.filter(n => n !== destination).every(n => n.disconnections > 0));
  assert.throws(() => synth.send([0x90, 60, 100]), /disposed/i);
});

test('owned context close is observable and replacement releases previous graph', async () => {
  const first = context();
  let created = 0;
  let finishClose;
  first.ctx.close = () => new Promise(resolve => { finishClose = resolve; });
  const { Synth, timers } = loadSynth(source, true, { AudioContext: function () { created++; return first.ctx; } });
  const synth = new Synth({ useReverb: 0 });
  assert.equal(created, 1);
  const second = context();
  const replacing = synth.setAudioContext(second.ctx);
  assert.ok(first.nodes.every(n => n.disconnections > 0));
  assert.equal(timers.size, 1);
  let done = false;
  Promise.resolve(replacing).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  finishClose();
  await replacing;
  await synth.dispose();
  assert.equal(second.ctx.closed, 0);
  assert.equal(timers.size, 0);
});

test('same-context graph replacement preserves ownership and invalid destinations preserve live graph', async () => {
  const { ctx, nodes } = context();
  const { Synth, timers } = loadSynth(source, true, { AudioContext: function () { return ctx; } });
  const synth = new Synth({ useReverb: 0 });
  const firstNodes = [...nodes];
  await synth.setAudioContext(ctx);
  assert.equal(ctx.closed, 0);
  assert.equal(timers.size, 1);
  assert.ok(firstNodes.every(node => node.disconnections > 0));
  const out = synth.out;
  assert.throws(() => synth.setAudioContext(ctx, context().ctx.createGain()), /destination/i);
  assert.equal(synth.out, out);
  assert.equal(out.disconnections, 0);
  await synth.dispose();
  assert.equal(ctx.closed, 1);
});

test('percussion ended callbacks release their nodes during normal offline rendering', async () => {
  const { ctx } = context();
  const { Synth } = loadSynth(source);
  const synth = new Synth({ audioContext: ctx, useReverb: 0 });
  synth.allSoundOff(0);
  const baseline = synth._nodes.size;
  synth.send([0x99, 38, 100], 0.01);
  assert.ok(synth._nodes.size > baseline);
  await ctx.startRendering();
  assert.equal(synth._nodes.size, baseline);
  await synth.dispose();
});

test('late MIDI download cannot resurrect a disposed synth', async () => {
  let xhr;
  class XHR { constructor() { xhr = this; } open() {} send() {} abort() { this.aborted = true; } }
  const { Synth } = loadSynth(source, true, { XMLHttpRequest: XHR });
  const synth = new Synth({ audioContext: context().ctx, useReverb: 0 });
  synth.loadMIDIUrl('example.mid');
  const late = xhr.onload;
  await synth.dispose();
  assert.equal(xhr.aborted, true);
  xhr.status = 200;
  late.call(xhr);
  assert.equal(synth.song, null);
});

test('native CommonJS accepts a shared context without browser globals', async () => {
  const Synth = require(source);
  const { ctx } = context();
  const synth = new Synth({ audioContext: ctx, useReverb: 0 });
  synth.send([0x90, 60, 100]);
  await synth.dispose();
  assert.equal(ctx.closed, 0);
});

test('repeated teardown cancels active sequencing and leaves a shared renderer audible', async () => {
  const { ctx, nodes } = context();
  const destination = ctx.createGain();
  destination.connect(ctx.destination);
  const { Synth, timers } = loadSynth(source);
  for (let i = 0; i < 3; i++) {
    const synth = new Synth({ audioContext: ctx, destination, useReverb: 0 });
    synth.send([0x99, 38, 100]);
    synth.song = { ev: [{ t: 0, m: [0x90, 72, 100] }], tempo: 120, timebase: 480 };
    synth.maxTick = 480;
    synth.playMIDI();
    const pendingCallbacks = [...timers.values()];
    await synth.dispose();
    const count = nodes.length;
    pendingCallbacks.forEach(fn => fn());
    assert.equal(nodes.length, count, 'even an already queued callback cannot start a note');
    assert.equal(timers.size, 0);
  }
  const survivor = new Synth({ audioContext: ctx, destination, useReverb: 0 });
  survivor.send([0x90, 69, 100], 0.01);
  survivor.send([0x80, 69, 0], 0.2);
  const rendered = await ctx.startRendering();
  assert.ok(rendered.getChannelData(0).some(sample => Math.abs(sample) > 0.001));
  await survivor.dispose();
  assert.equal(destination.disconnections, 0);
  assert.equal(ctx.closed, 0);
});

test('dispose rejects observably when closing its owned context fails', async () => {
  const { ctx } = context();
  ctx.close = () => Promise.reject(new Error('close failed'));
  const { Synth, timers } = loadSynth(source, true, { AudioContext: function () { return ctx; } });
  const synth = new Synth({ useReverb: 0 });
  const completion = synth.dispose();
  assert.equal(synth.dispose(), completion);
  await assert.rejects(completion, /close failed/);
  assert.equal(timers.size, 0);
});

test('dispose aborts file reads and invalidates captured completion callbacks', async () => {
  let reader;
  class Reader { constructor() { reader = this; } readAsArrayBuffer() {} abort() { this.aborted = true; } }
  const { Synth } = loadSynth(source, true, { FileReader: Reader });
  const synth = new Synth({ audioContext: context().ctx, useReverb: 0 });
  synth.execDrop({ dataTransfer: { files: [{}] }, stopPropagation() {}, preventDefault() {} });
  const late = reader.onload;
  await synth.dispose();
  assert.equal(reader.aborted, true);
  late();
  assert.equal(synth.song, null);
});

test('custom element disconnect clears GUI listeners, timers and owned context', async () => {
  let Element;
  const listeners = new Set();
  const canvas = {
    style: {},
    getContext: () => ({ fillRect() {} }),
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  const { ctx } = context();
  const { timers } = loadSynth(source, true, {
    AudioContext: function () { return ctx; },
    HTMLElement: class { getAttribute() { return null; } appendChild() {} },
    customElements: { define(_, value) { Element = value; } },
    document: { createElement: () => ({ children: [canvas] }), body: { removeEventListener() {} } },
  });
  const element = new Element();
  element.connectedCallback();
  assert.equal(timers.size, 2);
  assert.equal(listeners.size, 10);
  element.disconnectedCallback();
  await element.dispose();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(ctx.closed, 1);
  element.connectedCallback();
  assert.equal(timers.size, 0, 'disposed elements do not resurrect on reconnection');
});

test('head-script disposal works before document.body exists', async () => {
  const { ctx, nodes } = context();
  const { Synth, timers } = loadSynth(source, true, {
    AudioContext: function () { return ctx; }, document: { body: null },
  });
  const synth = new Synth({ useReverb: 0 });
  synth.send([0x90, 60, 100]);
  await synth.dispose();
  assert.equal(timers.size, 0);
  assert.equal(ctx.closed, 1);
  assert.ok(nodes.every(node => node.disconnections > 0));
});
