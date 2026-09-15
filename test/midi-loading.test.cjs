const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');
const midi = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,4,0,255,47,0]).buffer;

function fixture(file, options = {}) {
  const requests = [];
  class XHR {
    constructor() { requests.push(this); }
    open() {}
    send() { if(options.sendError) throw new Error('send failed'); }
    abort() { this.aborted = true; this.onabort?.(); }
    finish(status = 200, response = midi) { this.status = status; this.response = response; this.onload(); }
  }
  const { Synth, context } = loadSynth(path.join(__dirname, '..', file), true, {
    XMLHttpRequest: XHR,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  return { synth: new Synth({ audioContext: context, useReverb: 0 }), requests };
}

for (const file of ['webaudio-tinysynth.js', 'webaudio-tinysynth.min.js']) {
  test(`${file}: latest MIDI request wins and releases request handlers`, async () => {
    const { synth, requests } = fixture(file);
    const first = synth.loadMIDIUrl('first.mid');
    assert.equal(typeof first?.then, 'function');
    const rejected = assert.rejects(first, { name: 'AbortError' });
    const late = requests[0].onload;
    const second = synth.loadMIDIUrl('second.mid');
    await rejected;
    requests[1].finish();
    await second;
    const song = synth.song;
    late();
    assert.equal(synth.song, song);
    assert.equal(requests[0].aborted, true);
    assert.equal(synth._requests.size, 0);
    assert.equal(requests[1].onload, null);
    await synth.dispose();
  });
  test(`${file}: MIDI HTTP, network, parser and disposal failures reject`, async () => {
    const { synth, requests } = fixture(file);
    synth.loadMIDI(midi);
    const original = synth.song;
    await synth.loadMIDIUrl('');
    assert.equal(requests.length, 0);
    for (const [finish, pattern] of [
      [xhr => xhr.finish(404), /HTTP 404/],
      [xhr => xhr.onerror(), /network/i],
      [xhr => xhr.ontimeout(), /timeout/i],
      [xhr => xhr.finish(200, new ArrayBuffer(0)), /Invalid MIDI/],
    ]) {
      const promise = synth.loadMIDIUrl('bad.mid');
      assert.equal(typeof promise?.then, 'function');
      const rejected = assert.rejects(promise, pattern);
      finish(requests.at(-1));
      await rejected;
      assert.equal(synth._requests.size, 0);
      assert.equal(synth.song, original);
    }
    const pending = synth.loadMIDIUrl('pending.mid');
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await synth.dispose();
    await rejected;
    assert.equal(requests.at(-1).aborted, true);
    await assert.rejects(synth.loadMIDIUrl('disposed.mid'), /disposed/);
    await assert.rejects(synth.loadMIDIUrl(''), /disposed/);
  });
  test(`${file}: direct MIDI load supersedes pending URL load`, async () => {
    const { synth, requests } = fixture(file);
    const promise = synth.loadMIDIUrl('pending.mid');
    assert.equal(typeof promise?.then, 'function');
    const rejected = assert.rejects(promise, { name: 'AbortError' });
    synth.loadMIDI(midi);
    await rejected;
    assert.equal(requests[0].aborted, true);
    await synth.dispose();
  });
  test(`${file}: synchronous request failure releases bookkeeping`, async () => {
    const { synth, requests } = fixture(file, { sendError: true });
    await assert.rejects(synth.loadMIDIUrl('failed.mid'), /send failed/);
    assert.equal(synth._requests.size, 0);
    assert.equal(requests[0].onload, null);
    await synth.dispose();
  });
  test(`${file}: src observer consumes rejection and reports an error event`, async () => {
    const { synth, requests } = fixture(file);
    const events = [];
    synth.dispatchEvent = event => events.push(event);
    synth.src = 'missing.mid';
    const handled = synth.loadMIDIfromSrc();
    requests[0].finish(404);
    await handled;
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.match(events[0].detail.message, /HTTP 404/);
    const cancelled = synth.loadMIDIfromSrc();
    await synth.dispose();
    await cancelled;
    assert.equal(events.length, 1);
  });
}
