const assert = require('node:assert/strict');

module.exports = async page => {
  const result = await page.evaluate(async () => {
    async function render(stopLeft, mutate) {
      const context=new OfflineAudioContext(2,48000,48000);
      const synth=new WebAudioTinySynth({audioContext:context,useReverb:0});
      synth.allSoundOff(0);
      synth.setTimbre(1,38,[{w:'sine',v:0.4,a:0.01,d:0.05,s:0.5,r:0.01},
        {w:'sine',g:1,t:2,v:0.2,a:0,d:0.02,s:0.2,r:0.01}]);
      const left=context.createStereoPanner(),right=context.createStereoPanner();
      left.pan.value=-1; right.pan.value=1;
      left.connect(context.destination);right.connect(context.destination);
      const baseline=synth._nodes.size;
      const a=synth.playNote({percussion:true,note:38,startTime:0.25,duration:0.1,destination:left});
      const b=synth.playNote({percussion:true,note:38,startTime:0.25,duration:0.1,destination:right});
      const cancelled=synth.playNote({percussion:true,note:38,startTime:0.1,duration:0.1,destination:left});
      cancelled.stop(); await cancelled.ended;
      if(mutate) {
        synth.setTimbre(1,38,[{w:'sine',v:0}]);
        synth.setChVol(9,0);synth.setBend(9,0);synth.setSustain(9,127);
        synth.setVoices(1);synth.allSoundOff(9);synth.reset();
      }
      const interruption=context.suspend(0.3).then(()=>{
        if(stopLeft) a.stop();
        return context.resume();
      });
      const audio=await context.startRendering();await interruption;
      await Promise.race([Promise.all([a.ended,b.ended]),new Promise((_,reject)=>setTimeout(()=>reject(new Error('drums did not complete')),2000))]);
      const output=[...Array(2)].map((_,ch)=>Array.from(audio.getChannelData(ch)));
      const clean=synth._nodes.size===baseline && synth._voices.size===0;
      await synth.dispose();
      return {output,clean};
    }
    const base=await render(false,false),changed=await render(true,true);
    return {
      silentBefore:base.output.every(channel=>channel.slice(0,12000).every(v=>Math.abs(v)<1e-7)),
      audible:base.output.every(channel=>channel.slice(12500,14000).some(v=>Math.abs(v)>0.001)),
      stopped:changed.output[0].slice(16000).every(v=>Math.abs(v)<1e-7),
      isolated:base.output[1].every((v,i)=>v===changed.output[1][i]),
      clean:base.clean && changed.clean,
    };
  });
  assert.deepEqual(result,{silentBefore:true,audible:true,stopped:true,isolated:true,clean:true});
  const completion=await page.evaluate(async()=>{
    // Stock bell 53 has an 11-second release constant; render its whole tail.
    const context=new OfflineAudioContext(2,48000*40,48000);
    const synth=new WebAudioTinySynth({audioContext:context,useReverb:0});
    synth.allSoundOff(0);
    const baseline=synth._nodes.size;
    const voices=Array.from({length:47},(_,i)=>synth.playNote({percussion:true,note:i+35,startTime:0.1,duration:0.02}));
    await context.startRendering();
    await Promise.race([Promise.all(voices.map(v=>v.ended)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('stock drum completion: '+voices.map((v,i)=>v.state==='ended'?'':i+35).filter(Boolean))),2000))]);
    const clean=synth._nodes.size===baseline && synth._voices.size===0;
    await synth.dispose();
    return clean;
  });
  assert.equal(completion,true);
};
