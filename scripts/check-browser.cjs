const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const filename of ['webaudio-tinysynth.js', 'webaudio-tinysynth.min.js']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addScriptTag({ path: path.join(__dirname, '..', filename) });
      const result = await page.evaluate(async () => {
        const context = new OfflineAudioContext(2, 48000, 48000);
        const synth = new WebAudioTinySynth({ audioContext: context, useReverb: 0 });
        synth.allSoundOff(0);
        const left = context.createStereoPanner(), right = context.createStereoPanner();
        left.pan.value = -1; right.pan.value = 1;
        left.connect(context.destination); right.connect(context.destination);
        const baseline = synth._nodes.size;
        const rescheduled = synth.playNote({program:73,note:60,destination:left,duration:10});
        rescheduled.release(0.05);
        const cancelled = synth.playNote({program:46,note:60,destination:left,startTime:0.5,duration:10});
        cancelled.stop();
        const survivor = synth.playNote({program:73,note:60,destination:right,duration:0.8});
        const sustaining = synth.playNote({program:11,note:60,destination:left,duration:10});
        const tail = synth.playNote({program:46,note:60,destination:left,duration:0.05});
        const suspended = context.suspend(0.125).then(()=>{
          if(sustaining.state!=="playing" || tail.state!=="releasing") throw new Error("incorrect mid-render voice state");
          sustaining.stop(); tail.stop();
          return context.resume();
        });
        const audio = await context.startRendering();
        await suspended;
        const states = [rescheduled.state, cancelled.state, survivor.state];
        await Promise.race([Promise.all([rescheduled.ended, cancelled.ended, survivor.ended]),
          new Promise((_, reject) => setTimeout(()=>reject(new Error('voices did not complete')),2000))]);
        const leftTail = audio.getChannelData(0).slice(24000);
        const rightTail = audio.getChannelData(1).slice(24000, 35000);
        const result = { states, leftSilent: leftTail.every(v=>Math.abs(v)<1e-6), rightAudible: rightTail.some(v=>Math.abs(v)>0.001), nodes: synth._nodes.size, baseline, voices:synth._voices.size };
        await synth.dispose();
        return result;
      });
      assert.deepEqual(result.states, ['ended', 'ended', 'ended']);
      assert.equal(result.leftSilent, true);
      assert.equal(result.rightAudible, true);
      assert.equal(result.nodes, result.baseline);
      assert.equal(result.voices, 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${filename}: native Chromium replacement, cancellation, stereo and completion passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
