const fs = require('node:fs');
const vm = require('node:vm');
const { OfflineAudioContext } = require('web-audio-engine');

// Run the browser distribution unchanged. Timers are deterministic and explicitly
// driven, so the legacy housekeeping interval cannot leak into the test process.
function loadSynth(filename, commonjs = true, overrides = {}, duration = 1) {
  let seed = 1;
  const math = Object.create(Math);
  math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const timers = new Map();
  let nextTimer = 0;
  const context = new OfflineAudioContext(2, 22050 * duration, 22050);
  const sandbox = {
    Math: math, performance: { now: () => 0 }, console,
    AudioContext: function () { return context; },
    setInterval(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearInterval(id) { timers.delete(id); },
  };
  Object.assign(sandbox, overrides);
  if (commonjs) { sandbox.exports = {}; sandbox.module = { exports: sandbox.exports }; }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const Synth = commonjs ? sandbox.module.exports : sandbox.WebAudioTinySynth;
  return { Synth, context, timers, tick() { for (const fn of [...timers.values()]) fn(); } };
}
module.exports = { loadSynth };
