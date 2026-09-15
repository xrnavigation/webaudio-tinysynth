// Run with one or more source paths, e.g. baseline.js webaudio-tinysynth.js.
// Uses real web-audio-engine nodes; measures playNote construction only, without
// rendering, initialization, stop, or explicit pre-round GC time. Allocation-
// triggered GC may occur inside playNote. Never changes process-global RNG.
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { loadSynth } = require('../test/harness.cjs');
const sources = process.argv.slice(2).map(source => path.resolve(source));
if (!sources.length) sources.push(path.resolve(__dirname, '..', 'webaudio-tinysynth.js'));

(async () => {
  for (const count of [0, 100, 500, 1000]) {
    const candidates = sources.map(source => {
      const { Synth, context } = loadSynth(source);
      const synth = new Synth({ audioContext: context, useReverb: 0 });
      for (let i = 0; i < count; i++) synth.playNote({ program: 0, note: 60 });
      for (let i = 0; i < 200; i++) synth.playNote({ program: 0, note: 60 }).stop();
      return { source, synth, samples: [] };
    });
    for (let round = 0; round < 7; round++) {
      const order = round % 2 ? [...candidates].reverse() : candidates;
      for (const candidate of order) {
        if (global.gc) global.gc();
        let elapsed = 0;
        for (let i = 0; i < 200; i++) {
          const start = performance.now();
          const voice = candidate.synth.playNote({ program: 0, note: 60 });
          elapsed += performance.now() - start;
          voice.stop();
        }
        candidate.samples.push(elapsed * 1000 / 200);
      }
    }
    for (const { source, synth, samples } of candidates) {
      const sorted = [...samples].sort((a, b) => a - b);
      console.log(JSON.stringify({ source, activeVoices: count, medianMicroseconds: sorted[3], samples }));
      await synth.dispose();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
