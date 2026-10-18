const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSynth } = require('./harness.cjs');

// Hand-authored SMF1: conductor in 3/4, 120 BPM; a named channel-zero part,
// program zero, volume/pan/expression/sustain/bend, a running-status note-off,
// and an EOT later than the last note. No dependency writer builds this fixture.
const conductor = [0,255,3,4,66,97,110,100,0,255,81,3,7,161,32,
  0,255,88,4,3,2,24,8,0x83,0x60,255,47,0];
const part = [0,255,3,5,80,105,97,110,111,0,192,0,
  0,176,7,100,0,176,10,64,0,176,11,110,0,176,64,127,
  0,224,0,64,0,144,60,100,0x81,0x70,60,0,
  0,176,64,0,0x81,0x70,255,47,0];
const chunk = track => [77,84,114,107,track.length>>>24,(track.length>>>16)&255,(track.length>>>8)&255,track.length&255,...track];
const smf = (tracks, format=tracks.length>1?1:0) => Uint8Array.from([
  77,84,104,100,0,0,0,6,0,format,0,tracks.length,1,224,...tracks.flatMap(chunk),
]).buffer;
const fixture = smf([conductor,part]);
const eot = [0,255,47,0];

for (const file of ['webaudio-tinysynth.js','webaudio-tinysynth.min.js']) {
  const { Synth } = loadSynth(path.join(__dirname,'..',file));
  test(`${file}: structured import retains track identity, exact metadata and EOT`, () => {
    const song = Synth.parseMIDI(fixture);
    assert.equal(song.format,1);
    assert.equal(song.timebase,1920);
    assert.equal(song.maxTick,480);
    assert.deepEqual(Array.from(song.tracks, t=>[t.id,t.name,t.endTick]),[[0,'Band',480],[1,'Piano',480]]);
    const meter = song.tracks[0].events.find(e=>e.kind==='meta'&&e.type===88);
    assert.deepEqual(Array.from(meter.data),[3,2,24,8]);
    assert.deepEqual(Array.from(song.ev,e=>[e.t,...e.m]),[
      [0,0xff51,120],[0,192,0],[0,176,7,100],[0,176,10,64],
      [0,176,11,110],[0,176,64,127],[0,224,0,64],
      [0,144,60,100],[240,144,60,0],[240,176,64,0],
    ]);
    assert.equal(song.hasSysEx,false);
    song.ev.find(e=>e.m[0]===192).m[1]=99;
    assert.equal(song.tracks[1].events.find(e=>e.kind==='midi').message[1],0);
  });
  test(`${file}: every physical record consumes a budget before retention`, () => {
    for (const limits of [{maxBytes:fixture.byteLength-1},{maxTracks:1},{maxEvents:14},
      {maxMetadataBytes:15},{maxRecordBytes:4}]) {
      assert.throws(()=>Synth.parseMIDI(fixture,limits),/Invalid MIDI:.*limit/i);
    }
    for (const limits of [{maxBytes:1048577},{maxTracks:17},{maxEvents:20001},
      {maxMetadataBytes:65537},{maxRecordBytes:4097},{maxEvents:NaN},{maxEvents:-1}]) {
      assert.throws(()=>Synth.parseMIDI(fixture,limits),/limit/i);
    }
    assert.throws(()=>Synth.parseMIDI(smf([[0,255,1,0xa0,0x01,...new Array(4097).fill(65),...eot]])),/record.*limit/i);
    assert.throws(()=>Synth.parseMIDI(smf(new Array(17).fill(eot))),/track.*limit/i);
    assert.throws(()=>Synth.parseMIDI(new ArrayBuffer(1048577)),/byte.*limit/i);
    assert.throws(()=>Synth.parseMIDI({byteLength:1,length:1000000000}),/expected ArrayBuffer/i);
    const metadata=[];
    for(let i=0;i<17;i++) metadata.push(0,255,1,0xa0,0,...new Array(4096).fill(65));
    assert.throws(()=>Synth.parseMIDI(smf([[...metadata,...eot]])),/metadata.*limit/i);
    const records=[];
    for(let i=0;i<20000;i++) records.push(0,192,0);
    assert.throws(()=>Synth.parseMIDI(smf([[...records,...eot]])),/event.*limit/i);
    records.splice(-3);
    assert.equal(Synth.parseMIDI(smf([[...records,...eot]])).ev.length,19999);
  });
  test(`${file}: bounded SysEx is retained as inert metadata and export requires a policy`, () => {
    const song=Synth.parseMIDI(smf([[0,240,3,126,0,247,...eot]]));
    assert.equal(song.hasSysEx,true);
    assert.equal(song.ev.length,0);
    assert.equal(song.tracks[0].events[0].kind,'sysex');
    assert.throws(()=>Synth.parseMIDI(smf([[0,240,3,126,0,247,...eot]]),{maxSysExBytes:2}),/SysEx.*limit/i);
    assert.throws(()=>Synth.writeMIDI(song),/SysEx/i);
    assert.throws(()=>Synth.writeMIDI(song,{sysex:'omit',maxSysExBytes:2}),/SysEx.*limit/i);
    assert.deepEqual(Array.from(new Uint8Array(Synth.writeMIDI(song,{sysex:'omit'}))),Array.from(new Uint8Array(smf([eot]))));
    song.tracks[0].events.reverse();
    assert.throws(()=>Synth.writeMIDI(song,{sysex:'omit'}),/after End-of-Track/i);
  });
  test(`${file}: writer matches independently authored bytes and budgets`, () => {
    // Explicit channel statuses are intentional; running status compression is optional.
    const expectedPart=[...part.slice(0,38),144,...part.slice(38)];
    const song=Synth.parseMIDI(fixture);
    const written=Synth.writeMIDI(song);
    assert.deepEqual(Array.from(new Uint8Array(written)),Array.from(new Uint8Array(smf([conductor,expectedPart]))));
    for(const limits of [{maxBytes:20},{maxEvents:1},{maxTracks:1},{maxMetadataBytes:1},{maxRecordBytes:1}])
      assert.throws(()=>Synth.writeMIDI(song,limits),/limit/i);
    song.tracks[1].events[0].t=Number.MAX_SAFE_INTEGER+1;
    assert.throws(()=>Synth.writeMIDI(song),/tick/i);
  });
  test(`${file}: writer rejects invalid declared records before copying or sorting`, () => {
    const song=Synth.parseMIDI(fixture);
    const events=song.tracks[1].events;
    for(const bad of [
      {t:0,kind:'midi',message:[144,60,128]},
      {t:0,kind:'meta',type:81,data:[0,0,0]},
      {t:0,kind:'meta',type:88,data:[4,2]},
      {t:0,kind:'meta',type:1,data:new Array(4097).fill(65)},
      {t:481,kind:'midi',message:[192,0]},
    ]) {
      song.tracks[1].events=[bad];
      assert.throws(()=>Synth.writeMIDI(song),/Invalid MIDI/i);
    }
    song.tracks[1].events=new Array(20001);
    assert.throws(()=>Synth.writeMIDI(song),/event.*limit/i);
    song.tracks[1].events=events;
    assert.throws(()=>Synth.writeMIDI({timebase:1920,tempo:100,maxTick:0,ev:new Array(1)}),/Invalid MIDI: invalid message/i);
  });
  test(`${file}: normalized legacy song writes notes and trailing silence without audio`, () => {
    const song={copyright:'',text:'',tempo:120,timebase:1920,maxTick:480,
      ev:[{t:0,m:[192,0]},{t:0,m:[144,60,100]},{t:240,m:[128,60,0]}]};
    assert.deepEqual(Array.from(new Uint8Array(Synth.writeMIDI(song))),Array.from(new Uint8Array(smf([
      [0,192,0,0,144,60,100,0x81,0x70,128,60,0,0x81,0x70,255,47,0],
    ]))));
  });
  test(`${file}: raw text and fractional tempo survive exact-byte export`,()=>{
    const bytes=smf([[0,255,2,3,169,0,255,0,255,81,3,7,161,33,...eot]]);
    const song=Synth.parseMIDI(bytes);
    assert.equal(song.copyright,String.fromCharCode(169,0,255));
    assert.equal(song.ev[0].m[1],60000000/500001);
    assert.deepEqual(Array.from(new Uint8Array(Synth.writeMIDI(song))),Array.from(new Uint8Array(bytes)));
  });
}

test('independent percussion uses public lifecycle and stops scheduled noise and oscillators', async () => {
  const { Synth,context }=loadSynth(path.join(__dirname,'..','webaudio-tinysynth.js'),true,{},2);
  const synth=new Synth({audioContext:context,useReverb:0});
  synth.allSoundOff(0);
  const baseline=synth._nodes.size;
  for(let note=35;note<=81;note++) {
    const voice=synth.playNote({percussion:true,note,startTime:0.5,duration:0.1});
    assert.equal(voice.state,'scheduled');
    voice.stop(); await voice.ended;
    assert.equal(synth._nodes.size,baseline);
  }
  for(const options of [{percussion:true,note:34},{percussion:true,note:82},{percussion:'yes',program:0,note:60}])
    assert.throws(()=>synth.playNote(options),/invalid/i);
  const audio=await context.startRendering();
  assert.ok(audio.getChannelData(0).every(v=>v===0));
  await synth.dispose();
});

test('all independent drums stay silent before onset, cancel tails, and survive context replacement safely', async () => {
  const { Synth,context }=loadSynth(path.join(__dirname,'..','webaudio-tinysynth.js'),true,{},5);
  const synth=new Synth({audioContext:context,useReverb:0});
  synth.allSoundOff(0);
  const baseline=synth._nodes.size;
  const voices=Array.from({length:47},(_,i)=>synth.playNote({percussion:true,note:i+35,startTime:0.5,duration:0.02}));
  const audio=await context.startRendering();
  assert.ok(audio.getChannelData(0).slice(0,11025).every(v=>v===0));
  assert.ok(audio.getChannelData(0).slice(11025,15000).some(v=>Math.abs(v)>0.001));
  // web-audio-engine stops pulling a modulator when its carrier ends; unlike
  // native WebAudio, it then omits that modulator's scheduled ended callback.
  // Native Chromium checks release completion of every stock drum separately.
  voices.forEach(v=>v.stop());
  await Promise.all(voices.map(v=>v.ended));
  assert.equal(synth._nodes.size,baseline);
  const pending=synth.playNote({percussion:true,note:38,startTime:10});
  const other=loadSynth(path.join(__dirname,'..','webaudio-tinysynth.js'));
  await synth.setAudioContext(other.context);
  await pending.ended;
  assert.equal(pending.state,'ended');
  const disposal=synth.playNote({percussion:true,note:35,startTime:10});
  await synth.dispose(); await disposal.ended;
  assert.equal(synth._nodes.size,0);
});
