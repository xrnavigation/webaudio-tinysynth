const assert = require('node:assert/strict');

// Check the actual native AudioParam timeline against the instrument envelope,
// including the samples preceding release (a final-value check misses lost ramps).
module.exports = async function checkEnvelopes(page) {
  const results = await page.evaluate(async () => {
    const results = [];
    for (const api of ['voice', 'midi']) {
      for (const mode of ['duration', 'future', 'earlier', 'hold', 'decay', 'partials']) {
        const context = new OfflineAudioContext(1, 48000, 48000);
        const synth = new WebAudioTinySynth({ audioContext: context, useReverb: 0 });
        synth.allSoundOff(0);
        const start = 0.01;
        const partials = mode === 'partials'
          ? [{ w: 'sine', a: 0.02, h: 0.2, d: 0.1, s: 0.5, r: 0.01, v: 0.4 },
             { w: 'sine', a: 0.2, h: 0.1, d: 0.3, s: 0.25, r: 0.2, v: 0.6 }]
          : [{ w: 'sine', a: 0.2, h: 0.1, d: 0.15, s: 0.25, r: 0.05, v: 1 }];
        const release = start + (mode === 'hold' ? 0.25 : mode === 'decay' ? 0.4 : 0.1);
        synth.setTimbre(0, 0, partials);
        let voice;
        if (api === 'voice') {
          voice = synth.playNote({ program: 0, note: 69, destination: context.destination,
            startTime: start, duration: mode === 'duration' ? release - start : mode === 'earlier' ? 0.8 : undefined });
          if (mode !== 'duration') voice.release(release);
        } else {
          synth.noteOn(0, 69, 100, start);
          const note = synth.notetab[0];
          // Bypass channel/master compression so the expected samples depend only
          // on the partial envelopes, exactly as with the independent voice API.
          for (const gain of note.g) { gain.disconnect(); gain.connect(context.destination); }
          if (mode === 'earlier') synth._releaseNote(note, start + 0.8);
          synth._releaseNote(note, release);
        }
        // Exercise MIDI housekeeping after the short partial's tail has ended.
        const housekeeping = mode === 'partials' && api === 'midi'
          ? context.suspend(0.2).then(() => { synth._limitVoices(0, 69); return context.resume(); })
          : Promise.resolve();
        const audio = await context.startRendering();
        await housekeeping;
        const samples = audio.getChannelData(0);
        const envelope = (p, elapsed) => elapsed < p.a ? elapsed / p.a
          : elapsed < p.a + p.h ? 1
          : p.s + (1 - p.s) * Math.exp(-(elapsed - p.a - p.h) / p.d);
        let maxError = 0, beforePeak = 0;
        for (let i = Math.ceil((start + 0.002) * 48000); i < Math.floor((release + 0.03) * 48000); i++) {
          const time = i / 48000;
          const amplitude = partials.reduce((sum, p) => sum + 10000 / 16384 * p.v *
            (time < release ? envelope(p, time - start)
              : envelope(p, release - start) * Math.exp(-(time - release) / p.r)), 0);
          const expected = amplitude * Math.sin(2 * Math.PI * 440 * (time - start));
          maxError = Math.max(maxError, Math.abs(samples[i] - expected));
          if (time < release) beforePeak = Math.max(beforePeak, Math.abs(samples[i]));
        }
        const tailPeak = mode === 'partials'
          ? Math.max(...samples.slice(14400, 14880).map(Math.abs)) : null;
        results.push({ api, mode, maxError, beforePeak, tailPeak });
        await synth.dispose();
      }
    }
    // Every changed PCM fixture now has an independent native envelope check.
    // Feed constant one through each existing gain to observe its AudioParam
    // directly, without oscillator/FM waveforms hiding release discontinuities.
    for (const program of [0, 8, 11, 12, 24, 46, 68, 73, 122]) {
      const context = new OfflineAudioContext(8, 24000, 48000);
      const synth = new WebAudioTinySynth({ audioContext: context, useReverb: 0 });
      synth.allSoundOff(0);
      synth.setProgram(0, program);
      synth.noteOn(0, 60, 100, 0.01);
      const note = synth.notetab[0], partials = synth.program[program].p;
      const constant = context.createConstantSource();
      const merger = context.createChannelMerger(8);
      merger.connect(context.destination);
      for (let i = 0; i < note.g.length; i++) {
        note.o[i].disconnect(); note.g[i].disconnect();
        constant.connect(note.g[i]); note.g[i].connect(merger, 0, i);
      }
      constant.start(0.01);
      synth.noteOff(0, 60, 0.25);
      const audio = await context.startRendering();
      let maxError = 0;
      for (let i = 0; i < note.g.length; i++) {
        const p = partials[i], samples = audio.getChannelData(i);
        const elapsed = 0.25 - 0.01;
        const level = elapsed < p.a ? elapsed / p.a : elapsed < p.a + p.h ? 1
          : p.d === 0 ? p.s : p.s + (1 - p.s) * Math.exp(-(elapsed - p.a - p.h) / p.d);
        for (let sample = 12000; sample < 14400; sample++) {
          const expected = p.r === 0 ? 0 : level * Math.exp(-(sample / 48000 - 0.25) / p.r);
          maxError = Math.max(maxError, Math.abs(samples[sample] / note.v[i] - expected));
        }
      }
      results.push({ api: 'midi', mode: `program ${program}`, maxError, beforePeak: 1, tailPeak: null });
      await synth.dispose();
    }
    return results;
  });
  for (const result of results) {
    assert.ok(result.beforePeak > 0.1, `${result.api}/${result.mode}: silent attack`);
    assert.ok(result.maxError < 0.002, `${result.api}/${result.mode}: envelope error ${result.maxError}`);
    if (result.tailPeak !== null) assert.ok(result.tailPeak > 0.05, `${result.api}: longer partial tail cut off`);
  }
};
