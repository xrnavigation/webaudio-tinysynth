const assert = require('node:assert/strict');

module.exports = async function checkPercussion(page) {
  const results = await page.evaluate(async () => {
    const results = [];
    for (const operation of ['allSoundOff', 'stopMIDI', 'reset']) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const synth = new WebAudioTinySynth({ audioContext: context, useReverb: 0 });
      synth.allSoundOff(0);
      const right = context.createStereoPanner();
      right.pan.value = 1; right.connect(context.destination);
      const voice = synth.playNote({ program: 73, note: 60, destination: right, duration: 0.8 });
      const baseline = synth._nodes.size;
      synth.setPan(9, 0);
      synth.noteOn(9, 49, 100, 0.01);
      synth.noteOn(9, 49, 100, 0.5);
      let nodes, voiceState;
      const stopped = context.suspend(0.1).then(() => {
        synth[operation](9);
        nodes = synth._nodes.size; voiceState = voice.state;
        return context.resume();
      });
      const audio = await context.startRendering();
      await stopped;
      const left = audio.getChannelData(0), rightAudio = audio.getChannelData(1);
      results.push({ operation, nodes, baseline, voiceState,
        drumAudible: left.slice(1000, 4000).some(v => Math.abs(v) > 0.001),
        drumStopped: left.slice(12000).every(v => Math.abs(v) < 1e-6),
        voiceAudible: rightAudio.slice(24000, 32000).some(v => Math.abs(v) > 0.001) });
      await synth.dispose();
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.nodes, result.baseline, `${result.operation}: leaked drum nodes`);
    assert.equal(result.voiceState, 'playing');
    assert.equal(result.drumAudible, true);
    assert.equal(result.drumStopped, true, `${result.operation}: active/future drums survived`);
    assert.equal(result.voiceAudible, true);
  }
};
