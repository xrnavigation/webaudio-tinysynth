const assert = require('node:assert/strict');

module.exports = async function checkControllers(page) {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(2,48000,48000);
    const synth = new WebAudioTinySynth({audioContext:context,useReverb:0});
    synth.allSoundOff(0);
    synth.setTimbre(0,0,[{w:'sine',v:0.2,s:1,d:1,r:0.05}]);
    synth.setPan(0,0);
    synth.noteOn(0,69,100);
    synth.setBend(0,16383,0.05);
    synth.setBend(0,16383,0.4); // reset must cancel this future event too
    const right=context.createStereoPanner(); right.pan.value=1; right.connect(context.destination);
    const voice=synth.playNote({program:0,note:69,destination:right});
    const reset=context.suspend(0.2).then(()=>{ synth.resetAllControllers(0); return context.resume(); });
    const release=context.suspend(0.6).then(()=>{
      synth.setSustain(0,127); synth.noteOff(0,69); synth.send([0xb0,121,0]);
      return context.resume();
    });
    const audio=await context.startRendering(); await Promise.all([reset,release]);
    const left=audio.getChannelData(0), other=audio.getChannelData(1);
    let crossings=0;
    for(let i=24001;i<26400;i++) if(left[i-1]<=0 && left[i]>0) crossings++;
    // 440 Hz gives about 22 periods in this 50 ms interval, after the canceled bend.
    const peak=(data,start,end)=>Math.max(...data.slice(start,end).map(Math.abs));
    const result={crossings,tail:peak(left,44000,47000),independent:peak(other,44000,47000),state:voice.state};
    await synth.dispose(); return result;
  });
  assert.ok(Math.abs(result.crossings-22)<=1, 'controller reset restores pitch and cancels future bends');
  assert.ok(result.tail<0.001, 'controller reset releases pedal-held audio');
  assert.ok(result.independent>0.01, 'independent voice survives MIDI reset');
  assert.equal(result.state,'playing');
};
