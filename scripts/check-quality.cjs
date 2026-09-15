const assert = require('node:assert/strict');

module.exports = async function checkQuality(page) {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<webaudio-tinysynth quality="0"></webaudio-tinysynth><webaudio-tinysynth quality="1"></webaudio-tinysynth><webaudio-tinysynth></webaudio-tinysynth>';
    const players = Array.from(document.querySelectorAll('webaudio-tinysynth'));
    const result = players.map(synth => ({
      quality: synth.quality,
      timbre: JSON.stringify(synth.program[0].p) === JSON.stringify(synth.quality ? synth.program1[0] : synth.program0[0]),
    }));
    await Promise.all(players.map(synth => synth.dispose()));
    players.forEach(synth => synth.remove());
    return result;
  });
  assert.deepEqual(result, [{quality:0,timbre:true},{quality:1,timbre:true},{quality:1,timbre:true}]);
};
