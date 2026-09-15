const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function editor() {
  const sent = [];
  const sandbox = { window: {}, console, synth: { send: m => sent.push([...m]) }, kb: { setNote() {} } };
  const html = fs.readFileSync(path.join(__dirname, '..', 'soundedit.html'), 'utf8');
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(script[1], sandbox);
  return { sandbox, sent, send(bytes) { const data = Uint8Array.from(bytes); sandbox.MidiIn({ data }); assert.deepEqual([...data], bytes); } };
}

test('editor transposes notes without mutating MIDI input or other messages', () => {
  const e = editor(); e.sandbox.curOct = 1;
  for (const m of [[0xb0,7,100],[0xc0,73],[0xe0,0,64],[0xf8],[0xf0,0x7f,0,4,3,0,64,0xf7]]) e.send(m);
  assert.deepEqual(e.sent, [[0xb0,7,100],[0xc0,73],[0xe0,0,64],[0xf8],[0xf0,0x7f,0,4,3,0,64,0xf7]]);
  e.send([0x91,60,100]); e.send([0xa1,60,42]); e.send([0x81,60,0]);
  assert.deepEqual(e.sent.slice(-3), [[0x91,72,100],[0xa1,72,42],[0x81,72,0]]);
});

test('editor matches note-offs across octave changes and drops out-of-range notes', () => {
  const e = editor(); e.sandbox.curOct = 1;
  e.send([0x90,60,100]); e.sandbox.curOct = -1; e.send([0x80,60,0]);
  assert.deepEqual(e.sent, [[0x90,72,100],[0x80,72,0]]);
  e.send([0x90,0,100]); e.sandbox.curOct = 1; e.send([0x90,0,0]);
  e.send([0x90,127,100]); e.send([0x80,127,0]);
  assert.equal(e.sent.length, 2);
});

test('editor keeps overlapping input notes and channels distinct', () => {
  const e = editor(); e.sandbox.curOct = 1;
  e.send([0x90,60,100]); e.sandbox.curOct = 0;
  e.send([0x90,60,100]); e.send([0x91,60,100]); e.sandbox.curOct = -1;
  e.send([0x90,60,0]); e.send([0x81,60,0]); e.send([0x80,60,0]);
  assert.deepEqual(e.sent.slice(-3), [[0x90,72,0],[0x81,60,0],[0x80,60,0]]);
});
