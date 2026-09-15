/*! WebAudio TinySynth by Tatsuya Shinyagaito, Apache-2.0.
 * Modified by XR Navigation: explicit audio-context and playback lifecycle ownership.
 */
( function(window){
"use strict";

function WebAudioTinySynthCore(target) {
  this._nodes=new Set();
  this._voices=new Set();
  this._timers=new Set();
  this._requests=new Set();
  this._listeners=[];
  this._closing=[];
  this._disposed=false;
  this._ownedContext=null;
  Object.assign(target,{
    _createNode:(kind)=>{
      if(this._disposed) throw new Error("TinySynth is disposed");
      const node=this.actx["create"+kind]();
      this._nodes.add(node);
      return node;
    },
    _disconnectNode:(node)=>{
      node.onended=null;
      if(node.stop) { try { node.stop(); } catch(e) {} }
      node.disconnect();
      this._nodes.delete(node);
    },
    _tearDownGraph:()=>{
      this.playing=0;
      for(const voice of [...this._voices]) voice.stop();
      for(const node of [...this._nodes]) this._disconnectNode(node);
      this.notetab=[];
      if(this._ownedContext){
        const owned=this._ownedContext;
        this._ownedContext=null;
        const closing=Promise.resolve().then(()=>owned.close());
        // Retain errors for dispose/replacement callers without an unhandled rejection.
        closing.catch(()=>{});
        this._closing.push(closing);
      }
      for(const key of ["actx","audioContext","dest","out","comp","conv","rev","lfo","wave","noiseBuf","convBuf"])
        this[key]=null;
      this.chvol=[]; this.chmod=[]; this.chpan=[];
    },
    dispose:()=>{
      if(this._disposePromise) return this._disposePromise;
      this._disposed=true;
      this.isReady=0;
      for(const timer of this._timers) clearInterval(timer);
      this._timers.clear();
      for(const request of this._requests){
        request.onload=request.onerror=request.onabort=request.onloadend=null;
        request.abort();
      }
      this._requests.clear();
      for(const [element,event,handler] of this._listeners)
        element.removeEventListener(event,handler,false);
      this._listeners=[];
      if(typeof document!=="undefined" && document.body) document.body.removeEventListener("touchstart",this.preventScroll,false);
      this._tearDownGraph();
      this.song=null;
      this._initialContext=this._initialDestination=null;
      this.canvas=this.ctx=null;
      this._disposePromise=Promise.all(this._closing).then(()=>undefined);
      return this._disposePromise;
    },
    properties:{
      masterVol:  {type:Number, value:0.5, observer:"setMasterVol"},
      reverbLev:  {type:Number, value:0.3, observer:"setReverbLev"},
      quality:    {type:Number, value:1, observer:"setQuality"},
      debug:      {type:Number, value:0},
      src:        {type:String, value:null, observer:"loadMIDIfromSrc"},
      loop:       {type:Number, value:0},
      internalcontext: {type:Number, value:1},
      tsmode:     {type:Number, value:0},
      voices:     {type:Number, value:64},
      useReverb:  {type:Number, value:1},
      /*@@gui*/
      width:      {type:String, value:"300px", observer:"layout"},
      height:     {type:String, value:"32px", observer:"layout"},
      graph:      {type:Number, value:1},
      disabledrop:{type:Number, value:0},
      perfmon:    {type:Number, value:0},
      /*@@guiEND*/
    },
    /*@@gui*/
    layout:(()=>{
      this.canvas.style.width=this.width;
      this.canvas.style.height=this.height; 
    }),
    /*@@guiEND*/
    program:[
// 1-8 : Piano
      {name:"Acoustic Grand Piano"},    {name:"Bright Acoustic Piano"},
      {name:"Electric Grand Piano"},    {name:"Honky-tonk Piano"},
      {name:"Electric Piano 1"},        {name:"Electric Piano 2"},
      {name:"Harpsichord"},             {name:"Clavi"},
/* 9-16 : Chromatic Perc*/
      {name:"Celesta"},                 {name:"Glockenspiel"},
      {name:"Music Box"},               {name:"Vibraphone"},
      {name:"Marimba"},                 {name:"Xylophone"},
      {name:"Tubular Bells"},           {name:"Dulcimer"},
/* 17-24 : Organ */
      {name:"Drawbar Organ"},           {name:"Percussive Organ"},
      {name:"Rock Organ"},              {name:"Church Organ"},
      {name:"Reed Organ"},              {name:"Accordion"},
      {name:"Harmonica"},               {name:"Tango Accordion"},
/* 25-32 : Guitar */
      {name:"Acoustic Guitar (nylon)"}, {name:"Acoustic Guitar (steel)"},
      {name:"Electric Guitar (jazz)"},  {name:"Electric Guitar (clean)"},
      {name:"Electric Guitar (muted)"}, {name:"Overdriven Guitar"},
      {name:"Distortion Guitar"},       {name:"Guitar harmonics"},
/* 33-40 : Bass */
      {name:"Acoustic Bass"},           {name:"Electric Bass (finger)"},
      {name:"Electric Bass (pick)"},    {name:"Fretless Bass"},
      {name:"Slap Bass 1"},             {name:"Slap Bass 2"},
      {name:"Synth Bass 1"},            {name:"Synth Bass 2"},
/* 41-48 : Strings */
      {name:"Violin"},                  {name:"Viola"},
      {name:"Cello"},                   {name:"Contrabass"},
      {name:"Tremolo Strings"},         {name:"Pizzicato Strings"},
      {name:"Orchestral Harp"},         {name:"Timpani"},
/* 49-56 : Ensamble */
      {name:"String Ensemble 1"},       {name:"String Ensemble 2"},
      {name:"SynthStrings 1"},          {name:"SynthStrings 2"},
      {name:"Choir Aahs"},              {name:"Voice Oohs"},
      {name:"Synth Voice"},             {name:"Orchestra Hit"},
/* 57-64 : Brass */
      {name:"Trumpet"},                 {name:"Trombone"},
      {name:"Tuba"},                    {name:"Muted Trumpet"},
      {name:"French Horn"},             {name:"Brass Section"},
      {name:"SynthBrass 1"},            {name:"SynthBrass 2"},
/* 65-72 : Reed */
      {name:"Soprano Sax"},             {name:"Alto Sax"},
      {name:"Tenor Sax"},               {name:"Baritone Sax"},
      {name:"Oboe"},                    {name:"English Horn"},
      {name:"Bassoon"},                 {name:"Clarinet"},
/* 73-80 : Pipe */
      {name:"Piccolo"},                 {name:"Flute"},
      {name:"Recorder"},                {name:"Pan Flute"},
      {name:"Blown Bottle"},            {name:"Shakuhachi"},
      {name:"Whistle"},                 {name:"Ocarina"},
/* 81-88 : SynthLead */
      {name:"Lead 1 (square)"},         {name:"Lead 2 (sawtooth)"},
      {name:"Lead 3 (calliope)"},       {name:"Lead 4 (chiff)"},
      {name:"Lead 5 (charang)"},        {name:"Lead 6 (voice)"},
      {name:"Lead 7 (fifths)"},         {name:"Lead 8 (bass + lead)"},
/* 89-96 : SynthPad */
      {name:"Pad 1 (new age)"},         {name:"Pad 2 (warm)"},
      {name:"Pad 3 (polysynth)"},       {name:"Pad 4 (choir)"},
      {name:"Pad 5 (bowed)"},           {name:"Pad 6 (metallic)"},
      {name:"Pad 7 (halo)"},            {name:"Pad 8 (sweep)"},
/* 97-104 : FX */
      {name:"FX 1 (rain)"},             {name:"FX 2 (soundtrack)"},
      {name:"FX 3 (crystal)"},          {name:"FX 4 (atmosphere)"},
      {name:"FX 5 (brightness)"},       {name:"FX 6 (goblins)"},
      {name:"FX 7 (echoes)"},           {name:"FX 8 (sci-fi)"},
/* 105-112 : Ethnic */
      {name:"Sitar"},                   {name:"Banjo"},
      {name:"Shamisen"},                {name:"Koto"},
      {name:"Kalimba"},                 {name:"Bag pipe"},
      {name:"Fiddle"},                  {name:"Shanai"},
/* 113-120 : Percussive */
      {name:"Tinkle Bell"},             {name:"Agogo"},
      {name:"Steel Drums"},             {name:"Woodblock"},
      {name:"Taiko Drum"},              {name:"Melodic Tom"},
      {name:"Synth Drum"},              {name:"Reverse Cymbal"},
/* 121-128 : SE */
      {name:"Guitar Fret Noise"},       {name:"Breath Noise"},
      {name:"Seashore"},                {name:"Bird Tweet"},
      {name:"Telephone Ring"},          {name:"Helicopter"},
      {name:"Applause"},                {name:"Gunshot"},
    ],
    drummap:[
// 35
      {name:"Acoustic Bass Drum"},  {name:"Bass Drum 1"},      {name:"Side Stick"},     {name:"Acoustic Snare"},
      {name:"Hand Clap"},           {name:"Electric Snare"},   {name:"Low Floor Tom"},  {name:"Closed Hi Hat"},
      {name:"High Floor Tom"},      {name:"Pedal Hi-Hat"},     {name:"Low Tom"},        {name:"Open Hi-Hat"},
      {name:"Low-Mid Tom"},         {name:"Hi-Mid Tom"},       {name:"Crash Cymbal 1"}, {name:"High Tom"},
      {name:"Ride Cymbal 1"},       {name:"Chinese Cymbal"},   {name:"Ride Bell"},      {name:"Tambourine"},
      {name:"Splash Cymbal"},       {name:"Cowbell"},          {name:"Crash Cymbal 2"}, {name:"Vibraslap"},
      {name:"Ride Cymbal 2"},       {name:"Hi Bongo"},         {name:"Low Bongo"},      {name:"Mute Hi Conga"},
      {name:"Open Hi Conga"},       {name:"Low Conga"},        {name:"High Timbale"},   {name:"Low Timbale"},
      {name:"High Agogo"},          {name:"Low Agogo"},        {name:"Cabasa"},         {name:"Maracas"},
      {name:"Short Whistle"},       {name:"Long Whistle"},     {name:"Short Guiro"},    {name:"Long Guiro"},
      {name:"Claves"},              {name:"Hi Wood Block"},    {name:"Low Wood Block"}, {name:"Mute Cuica"},
      {name:"Open Cuica"},          {name:"Mute Triangle"},    {name:"Open Triangle"},
    ],
    program1:[
      // 1-8 : Piano
      [{w:"sine",v:.4,d:0.7,r:0.1,},{w:"triangle",v:3,d:0.7,s:0.1,g:1,a:0.01,k:-1.2}],
      [{w:"triangle",v:0.4,d:0.7,r:0.1,},{w:"triangle",v:4,t:3,d:0.4,s:0.1,g:1,k:-1,a:0.01,}],
      [{w:"sine",d:0.7,r:0.1,},{w:"triangle",v:4,f:2,d:0.5,s:0.5,g:1,k:-1}],
      [{w:"sine",d:0.7,v:0.2,},{w:"triangle",v:4,t:3,f:2,d:0.3,g:1,k:-1,a:0.01,s:0.5,}],
      [{w:"sine",v:0.35,d:0.7,},{w:"sine",v:3,t:7,f:1,d:1,s:1,g:1,k:-.7}],
      [{w:"sine",v:0.35,d:0.7,},{w:"sine",v:8,t:7,f:1,d:0.5,s:1,g:1,k:-.7}],
      [{w:"sawtooth",v:0.34,d:2,},{w:"sine",v:8,f:0.1,d:2,s:1,r:2,g:1,}],
      [{w:"triangle",v:0.34,d:1.5,},{w:"square",v:6,f:0.1,d:1.5,s:0.5,r:2,g:1,}],
      /* 9-16 : Chromatic Perc*/
      [{w:"sine",d:0.3,r:0.3,},{w:"sine",v:7,t:11,d:0.03,g:1,}],
      [{w:"sine",d:0.3,r:0.3,},{w:"sine",v:11,t:6,d:0.2,s:0.4,g:1,}],
      [{w:"sine",v:0.2,d:0.3,r:0.3,},{w:"sine",v:11,t:5,d:0.1,s:0.4,g:1,}],
      [{w:"sine",v:0.2,d:0.6,r:0.6,},{w:"triangle",v:11,t:5,f:1,s:0.5,g:1,}],
      [{w:"sine",v:0.3,d:0.2,r:0.2,},{w:"sine",v:6,t:5,d:0.02,g:1,}],
      [{w:"sine",v:0.3,d:0.2,r:0.2,},{w:"sine",v:7,t:11,d:0.03,g:1,}],
      [{w:"sine",v:0.2,d:1,r:1,},{w:"sine",v:11,t:3.5,d:1,r:1,g:1,}],
      [{w:"triangle",v:0.2,d:0.5,r:0.2,},{w:"sine",v:6,t:2.5,d:0.2,s:0.1,r:0.2,g:1,}],
      /* 17-24 : Organ */
      [{w:"w9999",v:0.22,s:0.9,},{w:"w9999",v:0.22,t:2,f:2,s:0.9,}],
      [{w:"w9999",v:0.2,s:1,},{w:"sine",v:11,t:6,f:2,s:0.1,g:1,h:0.006,r:0.002,d:0.002,},{w:"w9999",v:0.2,t:2,f:1,h:0,s:1,}],
      [{w:"w9999",v:0.2,d:0.1,s:0.9,},{w:"w9999",v:0.25,t:4,f:2,s:0.5,}],
      [{w:"w9999",v:0.3,a:0.04,s:0.9,},{w:"w9999",v:0.2,t:8,f:2,a:0.04,s:0.9,}],
      [{w:"sine",v:0.2,a:0.02,d:0.05,s:1,},{w:"sine",v:6,t:3,f:1,a:0.02,d:0.05,s:1,g:1,}],
      [{w:"triangle",v:0.2,a:0.02,d:0.05,s:0.8,},{w:"square",v:7,t:3,f:1,d:0.05,s:1.5,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:0.2,s:0.5,},{w:"square",v:1,d:0.03,s:2,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:0.1,s:0.8,},{w:"square",v:1,a:0.3,d:0.1,s:2,g:1,}],
      /* 25-32 : Guitar */
      [{w:"sine",v:0.3,d:0.5,f:1,},{w:"triangle",v:5,t:3,f:-1,d:1,s:0.1,g:1,}],
      [{w:"sine",v:0.4,d:0.6,f:1,},{w:"triangle",v:12,t:3,d:0.6,s:0.1,g:1,f:-1,}],
      [{w:"triangle",v:0.3,d:1,f:1,},{w:"triangle",v:6,f:-1,d:0.4,s:0.5,g:1,t:3,}],
      [{w:"sine",v:0.3,d:1,f:-1,},{w:"triangle",v:11,f:1,d:0.4,s:0.5,g:1,t:3,}],
      [{w:"sine",v:0.4,d:0.1,r:0.01},{w:"sine",v:7,g:1,}],
      [{w:"triangle",v:0.4,d:1,f:1,},{w:"square",v:4,f:-1,d:1,s:0.7,g:1,}],//[{w:"triangle",v:0.35,d:1,f:1,},{w:"square",v:7,f:-1,d:0.3,s:0.5,g:1,}],
      [{w:"triangle",v:0.35,d:1,f:1,},{w:"square",v:7,f:-1,d:0.3,s:0.5,g:1,}],//[{w:"triangle",v:0.4,d:1,f:1,},{w:"square",v:4,f:-1,d:1,s:0.7,g:1,}],//[{w:"triangle",v:0.4,d:1,},{w:"square",v:4,f:2,d:1,s:0.7,g:1,}],
      [{w:"sine",v:0.2,t:1.5,a:0.005,h:0.2,d:0.6,},{w:"sine",v:11,t:5,f:2,d:1,s:0.5,g:1,}],
      /* 33-40 : Bass */
      [{w:"sine",d:0.3,},{w:"sine",v:4,t:3,d:1,s:1,g:1,}],
      [{w:"sine",d:0.3,},{w:"sine",v:4,t:3,d:1,s:1,g:1,}],
      [{w:"w9999",d:0.3,v:0.7,s:0.5,},{w:"sawtooth",v:1.2,d:0.02,s:0.5,g:1,h:0,r:0.02,}],
      [{w:"sine",d:0.3,},{w:"sine",v:4,t:3,d:1,s:1,g:1,}],
      [{w:"triangle",v:0.3,t:2,d:1,},{w:"triangle",v:15,t:2.5,d:0.04,s:0.1,g:1,}],
      [{w:"triangle",v:0.3,t:2,d:1,},{w:"triangle",v:15,t:2.5,d:0.04,s:0.1,g:1,}],
      [{w:"triangle",d:0.7,},{w:"square",v:0.4,t:0.5,f:1,d:0.2,s:10,g:1,}],
      [{w:"triangle",d:0.7,},{w:"square",v:0.4,t:0.5,f:1,d:0.2,s:10,g:1,}],
      /* 41-48 : Strings */
      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,d:11,s:0.2,g:1,}],
      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,d:11,s:0.2,g:1,}],
      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,t:0.5,d:11,s:0.2,g:1,}],
      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,t:0.5,d:11,s:0.2,g:1,}],
      [{w:"sine",v:0.4,a:0.1,d:11,},{w:"sine",v:6,f:2.5,d:0.05,s:1.1,g:1,}],
      [{w:"sine",v:0.3,d:0.1,r:0.1,},{w:"square",v:4,t:3,d:1,s:0.2,g:1,}],
      [{w:"sine",v:0.3,d:0.5,r:0.5,},{w:"sine",v:7,t:2,f:2,d:1,r:1,g:1,}],
      [{w:"triangle",v:0.6,h:0.03,d:0.3,r:0.3,t:0.5,},{w:"n0",v:8,t:1.5,d:0.08,r:0.08,g:1,}],
      /* 49-56 : Ensamble */
      [{w:"sawtooth",v:0.3,a:0.03,s:0.5,},{w:"sawtooth",v:0.2,t:2,f:2,d:1,s:2,}],
      [{w:"sawtooth",v:0.3,f:-2,a:0.03,s:0.5,},{w:"sawtooth",v:0.2,t:2,f:2,d:1,s:2,}],
      [{w:"sawtooth",v:0.2,a:0.02,s:1,},{w:"sawtooth",v:0.2,t:2,f:2,a:1,d:1,s:1,}],
      [{w:"sawtooth",v:0.2,a:0.02,s:1,},{w:"sawtooth",v:0.2,f:2,a:0.02,d:1,s:1,}],
      [{w:"triangle",v:0.3,a:0.03,s:1,},{w:"sine",v:3,t:5,f:1,d:1,s:1,g:1,}],
      [{w:"sine",v:0.4,a:0.03,s:0.9,},{w:"sine",v:1,t:2,f:3,d:0.03,s:0.2,g:1,}],
      [{w:"triangle",v:0.6,a:0.05,s:0.5,},{w:"sine",v:1,f:0.8,d:0.2,s:0.2,g:1,}],
      [{w:"square",v:0.15,a:0.01,d:0.2,r:0.2,t:0.5,h:0.03,},{w:"square",v:4,f:0.5,d:0.2,r:11,a:0.01,g:1,h:0.02,},{w:"square",v:0.15,t:4,f:1,a:0.02,d:0.15,r:0.15,h:0.03,},{g:3,w:"square",v:4,f:-0.5,a:0.01,h:0.02,d:0.15,r:11,}],
      /* 57-64 : Brass */
      [{w:"square",v:0.2,a:0.01,d:1,s:0.6,r:0.04,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:1,s:0.5,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
      [{w:"square",v:0.2,a:0.04,d:1,s:0.4,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
      [{w:"square",v:0.15,a:0.04,s:1,},{w:"sine",v:2,d:0.1,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:1,s:0.5,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:1,s:0.6,r:0.08,},{w:"sine",v:1,f:0.2,d:0.1,s:4,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:0.5,s:0.7,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:1,s:0.5,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
      /* 65-72 : Reed */
      [{w:"square",v:0.2,a:0.02,d:2,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:2,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:1,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
      [{w:"square",v:0.2,a:0.02,d:1,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
      [{w:"sine",v:0.4,a:0.02,d:0.7,s:0.5,},{w:"square",v:5,t:2,d:0.2,s:0.5,g:1,}],
      [{w:"sine",v:0.3,a:0.05,d:0.2,s:0.8,},{w:"sawtooth",v:6,f:0.1,d:0.1,s:0.3,g:1,}],
      [{w:"sine",v:0.3,a:0.03,d:0.2,s:0.4,},{w:"square",v:7,f:0.2,d:1,s:0.1,g:1,}],
      [{w:"square",v:0.2,a:0.05,d:0.1,s:0.8,},{w:"square",v:4,d:0.1,s:1.1,g:1,}],
      /* 73-80 : Pipe */
      [{w:"sine",a:0.02,d:2,},{w:"sine",v:6,t:2,d:0.04,g:1,}],
      [{w:"sine",v:0.7,a:0.03,d:0.4,s:0.4,},{w:"sine",v:4,t:2,f:0.2,d:0.4,g:1,}],
      [{w:"sine",v:0.7,a:0.02,d:0.4,s:0.6,},{w:"sine",v:3,t:2,d:0,s:1,g:1,}],
      [{w:"sine",v:0.4,a:0.06,d:0.3,s:0.3,},{w:"sine",v:7,t:2,d:0.2,s:0.2,g:1,}],
      [{w:"sine",a:0.02,d:0.3,s:0.3,},{w:"sawtooth",v:3,t:2,d:0.3,g:1,}],
      [{w:"sine",v:0.4,a:0.02,d:2,s:0.1,},{w:"sawtooth",v:8,t:2,f:1,d:0.5,g:1,}],
      [{w:"sine",v:0.7,a:0.03,d:0.5,s:0.3,},{w:"sine",v:0.003,t:0,f:4,d:0.1,s:0.002,g:1,}],
      [{w:"sine",v:0.7,a:0.02,d:2,},{w:"sine",v:1,t:2,f:1,d:0.02,g:1,}],
      /* 81-88 : SynthLead */
      [{w:"square",v:0.3,d:1,s:0.5,},{w:"square",v:1,f:0.2,d:1,s:0.5,g:1,}],
      [{w:"sawtooth",v:0.3,d:2,s:0.5,},{w:"square",v:2,f:0.1,s:0.5,g:1,}],
      [{w:"triangle",v:0.5,a:0.05,d:2,s:0.6,},{w:"sine",v:4,t:2,g:1,}],
      [{w:"triangle",v:0.3,a:0.01,d:2,s:0.3,},{w:"sine",v:22,t:2,f:1,d:0.03,s:0.2,g:1,}],
      [{w:"sawtooth",v:0.3,d:1,s:0.5,},{w:"sine",v:11,t:11,a:0.2,d:0.05,s:0.3,g:1,}],
      [{w:"sine",v:0.3,a:0.06,d:1,s:0.5,},{w:"sine",v:7,f:1,d:1,s:0.2,g:1,}],
      [{w:"sawtooth",v:0.3,a:0.03,d:0.7,s:0.3,r:0.2,},{w:"sawtooth",v:0.3,t:0.75,d:0.7,a:0.1,s:0.3,r:0.2,}],
      [{w:"triangle",v:0.3,a:0.01,d:0.7,s:0.5,},{w:"square",v:5,t:0.5,d:0.7,s:0.5,g:1,}],
      /* 89-96 : SynthPad */
      [{w:"triangle",v:0.3,a:0.02,d:0.3,s:0.3,r:0.3,},{w:"square",v:3,t:4,f:1,a:0.02,d:0.1,s:1,g:1,},{w:"triangle",v:0.08,t:0.5,a:0.1,h:0,d:0.1,s:0.5,r:0.1,b:0,c:0,}],
      [{w:"sine",v:0.3,a:0.05,d:1,s:0.7,r:0.3,},{w:"sine",v:2,f:1,d:0.3,s:1,g:1,}],
      [{w:"square",v:0.3,a:0.03,d:0.5,s:0.3,r:0.1,},{w:"square",v:4,f:1,a:0.03,d:0.1,g:1,}],
      [{w:"triangle",v:0.3,a:0.08,d:1,s:0.3,r:0.1,},{w:"square",v:2,f:1,d:0.3,s:0.3,g:1,t:4,a:0.08,}],
      [{w:"sine",v:0.3,a:0.05,d:1,s:0.3,r:0.1,},{w:"sine",v:0.1,t:2.001,f:1,d:1,s:50,g:1,}],
      [{w:"triangle",v:0.3,a:0.03,d:0.7,s:0.3,r:0.2,},{w:"sine",v:12,t:7,f:1,d:0.5,s:1.7,g:1,}],
      [{w:"sine",v:0.3,a:0.05,d:1,s:0.3,r:0.1,},{w:"sawtooth",v:22,t:6,d:0.06,s:0.3,g:1,}],
      [{w:"triangle",v:0.3,a:0.05,d:11,r:0.3,},{w:"triangle",v:1,d:1,s:8,g:1,}],
      /* 97-104 : FX */
      [{w:"sawtooth",v:0.3,d:4,s:0.8,r:0.1,},{w:"square",v:1,t:2,f:8,a:1,d:1,s:1,r:0.1,g:1,}],
      [{w:"triangle",v:0.3,d:1,s:0.5,t:0.8,a:0.2,p:1.25,q:0.2,},{w:"sawtooth",v:0.2,a:0.2,d:0.3,s:1,t:1.2,p:1.25,q:0.2,}],
      [{w:"sine",v:0.3,d:1,s:0.3,},{w:"square",v:22,t:11,d:0.5,s:0.1,g:1,}],
      [{w:"sawtooth",v:0.3,a:0.04,d:1,s:0.8,r:0.1,},{w:"square",v:1,t:0.5,d:1,s:2,g:1,}],
      [{w:"triangle",v:0.3,d:1,s:0.3,},{w:"sine",v:22,t:6,d:0.6,s:0.05,g:1,}],
      [{w:"sine",v:0.6,a:0.1,d:0.05,s:0.4,},{w:"sine",v:5,t:5,f:1,d:0.05,s:0.3,g:1,}],
      [{w:"sine",a:0.1,d:0.05,s:0.4,v:0.8,},{w:"sine",v:5,t:5,f:1,d:0.05,s:0.3,g:1,}],
      [{w:"square",v:0.3,a:0.1,d:0.1,s:0.4,},{w:"square",v:1,f:1,d:0.3,s:0.1,g:1,}],
      /* 105-112 : Ethnic */
      [{w:"sawtooth",v:0.3,d:0.5,r:0.5,},{w:"sawtooth",v:11,t:5,d:0.05,g:1,}],
      [{w:"square",v:0.3,d:0.2,r:0.2,},{w:"square",v:7,t:3,d:0.05,g:1,}],
      [{w:"triangle",d:0.2,r:0.2,},{w:"square",v:9,t:3,d:0.1,r:0.1,g:1,}],
      [{w:"triangle",d:0.3,r:0.3,},{w:"square",v:6,t:3,d:1,r:1,g:1,}],
      [{w:"triangle",v:0.4,d:0.2,r:0.2,},{w:"square",v:22,t:12,d:0.1,r:0.1,g:1,}],
      [{w:"sine",v:0.25,a:0.02,d:0.05,s:0.8,},{w:"square",v:1,t:2,d:0.03,s:11,g:1,}],
      [{w:"sine",v:0.3,a:0.05,d:11,},{w:"square",v:7,t:3,f:1,s:0.7,g:1,}],
      [{w:"square",v:0.3,a:0.05,d:0.1,s:0.8,},{w:"square",v:4,d:0.1,s:1.1,g:1,}],
      /* 113-120 : Percussive */
      [{w:"sine",v:0.4,d:0.3,r:0.3,},{w:"sine",v:7,t:9,d:0.1,r:0.1,g:1,}],
      [{w:"sine",v:0.7,d:0.1,r:0.1,},{w:"sine",v:22,t:7,d:0.05,g:1,}],
      [{w:"sine",v:0.6,d:0.15,r:0.15,},{w:"square",v:11,t:3.2,d:0.1,r:0.1,g:1,}],
      [{w:"sine",v:0.8,d:0.07,r:0.07,},{w:"square",v:11,t:7,r:0.01,g:1,}],
      [{w:"triangle",v:0.7,t:0.5,d:0.2,r:0.2,p:0.95,},{w:"n0",v:9,g:1,d:0.2,r:0.2,}],
      [{w:"sine",v:0.7,d:0.1,r:0.1,p:0.9,},{w:"square",v:14,t:2,d:0.005,r:0.005,g:1,}],
      [{w:"square",d:0.15,r:0.15,p:0.5,},{w:"square",v:4,t:5,d:0.001,r:0.001,g:1,}],
      [{w:"n1",v:0.3,a:1,s:1,d:0.15,r:0,t:0.5,}],
      /* 121-128 : SE */
      [{w:"sine",t:12.5,d:0,r:0,p:0.5,v:0.3,h:0.2,q:0.5,},{g:1,w:"sine",v:1,t:2,d:0,r:0,s:1,},{g:1,w:"n0",v:0.2,t:2,a:0.6,h:0,d:0.1,r:0.1,b:0,c:0,}],
      [{w:"n0",v:0.2,a:0.05,h:0.02,d:0.02,r:0.02,}],
      [{w:"n0",v:0.4,a:1,d:1,t:0.25,}],
      [{w:"sine",v:0.3,a:0.1,d:1,s:0.5,},{w:"sine",v:4,t:0,f:1.5,d:1,s:1,r:0.1,g:1,},{g:1,w:"sine",v:4,t:0,f:2,a:0.6,h:0,d:0.1,s:1,r:0.1,b:0,c:0,}],
      [{w:"square",v:0.3,t:0.25,d:11,s:1,},{w:"square",v:12,t:0,f:8,d:1,s:1,r:11,g:1,}],
      [{w:"n0",v:0.4,t:0.5,a:1,d:11,s:1,r:0.5,},{w:"square",v:1,t:0,f:14,d:1,s:1,r:11,g:1,}],
      [{w:"sine",t:0,f:1221,a:0.2,d:1,r:0.25,s:1,},{g:1,w:"n0",v:3,t:0.5,d:1,s:1,r:1,}],
      [{w:"sine",d:0.4,r:0.4,p:0.1,t:2.5,v:1,},{w:"n0",v:12,t:2,d:1,r:1,g:1,}],
    ],
    program0:[
// 1-8 : Piano
      [{w:"triangle",v:.5,d:.7}],                   [{w:"triangle",v:.5,d:.7}],
      [{w:"triangle",v:.5,d:.7}],                   [{w:"triangle",v:.5,d:.7}],
      [{w:"triangle",v:.5,d:.7}],                   [{w:"triangle",v:.5,d:.7}],
      [{w:"sawtooth",v:.3,d:.7}],                   [{w:"sawtooth",v:.3,d:.7}],
/* 9-16 : Chromatic Perc*/
      [{w:"sine",v:.5,d:.3,r:.3}],                  [{w:"triangle",v:.5,d:.3,r:.3}],
      [{w:"square",v:.2,d:.3,r:.3}],                [{w:"square",v:.2,d:.3,r:.3}],
      [{w:"sine",v:.5,d:.1,r:.1}],                  [{w:"sine",v:.5,d:.1,r:.1}],
      [{w:"square",v:.2,d:1,r:1}],                  [{w:"sawtooth",v:.3,d:.7,r:.7}],
/* 17-24 : Organ */
      [{w:"sine",v:0.5,a:0.01,s:1}],                [{w:"sine",v:0.7,d:0.02,s:0.7}],
      [{w:"square",v:.2,s:1}],                      [{w:"triangle",v:.5,a:.01,s:1}],
      [{w:"square",v:.2,a:.02,s:1}],                [{w:"square",v:0.2,a:0.02,s:1}],
      [{w:"square",v:0.2,a:0.02,s:1}],              [{w:"square",v:.2,a:.05,s:1}],
/* 25-32 : Guitar */
      [{w:"triangle",v:.5,d:.5}],                   [{w:"square",v:.2,d:.6}],
      [{w:"square",v:.2,d:.6}],                     [{w:"triangle",v:.8,d:.6}],
      [{w:"triangle",v:.4,d:.05}],                  [{w:"square",v:.2,d:1}],
      [{w:"square",v:.2,d:1}],                      [{w:"sine",v:.4,d:.6}],
/* 33-40 : Bass */
      [{w:"triangle",v:.7,d:.4}],                   [{w:"triangle",v:.7,d:.7}],
      [{w:"triangle",v:.7,d:.7}],                   [{w:"triangle",v:.7,d:.7}],
      [{w:"square",v:.3,d:.2}],                     [{w:"square",v:.3,d:.2}],
      [{w:"square",v:.3,d:.1,s:.2}],                [{w:"sawtooth",v:.4,d:.1,s:.2}],
/* 41-48 : Strings */
      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.3,d:.1}],
      [{w:"sawtooth",v:.3,d:.5,r:.5}],              [{w:"triangle",v:.6,d:.1,r:.1,h:0.03,p:0.8}],
/* 49-56 : Ensamble */
      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
      [{w:"triangle",v:.3,a:.03,s:1}],              [{w:"sine",v:.3,a:.03,s:1}],
      [{w:"triangle",v:.3,a:.05,s:1}],              [{w:"sawtooth",v:.5,a:.01,d:.1}],
/* 57-64 : Brass */
      [{w:"square",v:.3,a:.05,d:.2,s:.6}],          [{w:"square",v:.3,a:.05,d:.2,s:.6}],
      [{w:"square",v:.3,a:.05,d:.2,s:.6}],          [{w:"square",v:0.2,a:.05,d:0.01,s:1}],
      [{w:"square",v:.3,a:.05,s:1}],                [{w:"square",v:.3,s:.7}],
      [{w:"square",v:.3,s:.7}],                     [{w:"square",v:.3,s:.7}],
/* 65-72 : Reed */
      [{w:"square",v:.3,a:.02,d:2}],                [{w:"square",v:.3,a:.02,d:2}],
      [{w:"square",v:.3,a:.03,d:2}],                [{w:"square",v:.3,a:.04,d:2}],
      [{w:"square",v:.3,a:.02,d:2}],                [{w:"square",v:.3,a:.05,d:2}],
      [{w:"square",v:.3,a:.03,d:2}],                [{w:"square",v:.3,a:.03,d:2}],
/* 73-80 : Pipe */
      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
/* 81-88 : SynthLead */
      [{w:"square",v:.3,s:.7}],                     [{w:"sawtooth",v:.4,s:.7}],
      [{w:"triangle",v:.5,s:.7}],                   [{w:"sawtooth",v:.4,s:.7}],
      [{w:"sawtooth",v:.4,d:12}],                   [{w:"sine",v:.4,a:.06,d:12}],
      [{w:"sawtooth",v:.4,d:12}],                   [{w:"sawtooth",v:.4,d:12}],
/* 89-96 : SynthPad */
      [{w:"sawtooth",v:.3,d:12}],                   [{w:"triangle",v:.5,d:12}],
      [{w:"square",v:.3,d:12}],                     [{w:"triangle",v:.5,a:.08,d:11}],
      [{w:"sawtooth",v:.5,a:.05,d:11}],             [{w:"sawtooth",v:.5,d:11}],
      [{w:"triangle",v:.5,d:11}],                   [{w:"triangle",v:.5,d:11}],
/* 97-104 : FX */
      [{w:"triangle",v:.5,d:11}],                   [{w:"triangle",v:.5,d:11}],
      [{w:"square",v:.3,d:11}],                     [{w:"sawtooth",v:0.5,a:0.04,d:11}],
      [{w:"sawtooth",v:.5,d:11}],                   [{w:"triangle",v:.5,a:.8,d:11}],
      [{w:"triangle",v:.5,d:11}],                   [{w:"square",v:.3,d:11}],
/* 105-112 : Ethnic */
      [{w:"sawtooth",v:.3,d:1,r:1}],                [{w:"sawtooth",v:.5,d:.3}],
      [{w:"sawtooth",v:.5,d:.3,r:.3}],              [{w:"sawtooth",v:.5,d:.3,r:.3}],
      [{w:"square",v:.3,d:.2,r:.2}],                [{w:"square",v:.3,a:.02,d:2}],
      [{w:"sawtooth",v:.2,a:.02,d:.7}],             [{w:"triangle",v:.5,d:1}],
/* 113-120 : Percussive */
      [{w:"sawtooth",v:.3,d:.3,r:.3}],              [{w:"sine",v:.8,d:.1,r:.1}],
      [{w:"square",v:.2,d:.1,r:.1,p:1.05}],         [{w:"sine",v:.8,d:.05,r:.05}],
      [{w:"triangle",v:0.5,d:0.1,r:0.1,p:0.96}],    [{w:"triangle",v:0.5,d:0.1,r:0.1,p:0.97}],
      [{w:"square",v:.3,d:.1,r:.1,}],               [{w:"n1",v:0.3,a:1,s:1,d:0.15,r:0,t:0.5,}],
/* 121-128 : SE */
      [{w:"triangle",v:0.5,d:0.03,t:0,f:1332,r:0.001,p:1.1}],
      [{w:"n0",v:0.2,t:0.1,d:0.02,a:0.05,h:0.02,r:0.02}],
      [{w:"n0",v:0.4,a:1,d:1,t:0.25,}],
      [{w:"sine",v:0.3,a:0.8,d:1,t:0,f:1832}],
      [{w:"triangle",d:0.5,t:0,f:444,s:1,}],
      [{w:"n0",v:0.4,d:1,t:0,f:22,s:1,}],
      [{w:"n0",v:0.5,a:0.2,d:11,t:0,f:44}],
      [{w:"n0",v:0.5,t:0.25,d:0.4,r:0.4}],
    ],
    drummap1:[
/*35*/  [{w:"triangle",t:0,f:70,v:1,d:0.05,h:0.03,p:0.9,q:0.1,},{w:"n0",g:1,t:6,v:17,r:0.01,h:0,p:0,}],
        [{w:"triangle",t:0,f:88,v:1,d:0.05,h:0.03,p:0.5,q:0.1,},{w:"n0",g:1,t:5,v:42,r:0.01,h:0,p:0,}],
        [{w:"n0",f:222,p:0,t:0,r:0.01,h:0,}],
        [{w:"triangle",v:0.3,f:180,d:0.05,t:0,h:0.03,p:0.9,q:0.1,},{w:"n0",v:0.6,t:0,f:70,h:0.02,r:0.01,p:0,},{g:1,w:"square",v:2,t:0,f:360,r:0.01,b:0,c:0,}],
        [{w:"square",f:1150,v:0.34,t:0,r:0.03,h:0.025,d:0.03,},{g:1,w:"n0",t:0,f:13,h:0.025,d:0.1,s:1,r:0.1,v:1,}],
/*40*/  [{w:"triangle",f:200,v:1,d:0.06,t:0,r:0.06,},{w:"n0",g:1,t:0,f:400,v:12,r:0.02,d:0.02,}],
        [{w:"triangle",f:100,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.4,h:0.015,d:0.005,r:0.005,}],
        [{w:"n1",f:390,v:0.25,r:0.01,t:0,}],
        [{w:"triangle",f:120,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.5,h:0.015,d:0.005,r:0.005,}],
        [{w:"n1",v:0.25,f:390,r:0.03,t:0,h:0.005,d:0.03,}],
/*45*/  [{w:"triangle",f:140,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
        [{w:"n1",v:0.25,f:390,t:0,d:0.2,r:0.2,},{w:"n0",v:0.3,t:0,c:0,f:440,h:0.005,d:0.05,}],
        [{w:"triangle",f:155,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
        [{w:"triangle",f:180,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
        [{w:"n1",v:0.3,f:1200,d:0.2,r:0.2,h:0.05,t:0,},{w:"n1",t:0,v:1,d:0.1,r:0.1,p:1.2,f:440,}],
/*50*/  [{w:"triangle",f:220,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
        [{w:"n1",f:500,v:0.15,d:0.4,r:0.4,h:0,t:0,},{w:"n0",v:0.1,t:0,r:0.01,f:440,}],
        [{w:"n1",v:0.3,f:800,d:0.2,r:0.2,h:0.05,t:0,},{w:"square",t:0,v:1,d:0.1,r:0.1,p:0.1,f:220,g:1,}],
        [{w:"sine",f:1651,v:0.15,d:0.2,r:0.2,h:0,t:0,},{w:"sawtooth",g:1,t:1.21,v:7.2,d:0.1,r:11,h:1,},{g:1,w:"n0",v:3.1,t:0.152,d:0.002,r:0.002,}],
        null,
/*55*/  [{w:"n1",v:.3,f:1200,d:0.2,r:0.2,h:0.05,t:0,},{w:"n1",t:0,v:1,d:0.1,r:0.1,p:1.2,f:440,}],
        null,
        [{w:"n1",v:0.3,f:555,d:0.25,r:0.25,h:0.05,t:0,},{w:"n1",t:0,v:1,d:0.1,r:0.1,f:440,a:0.005,h:0.02,}],
        [{w:"sawtooth",f:776,v:0.2,d:0.3,t:0,r:0.3,},{g:1,w:"n0",v:2,t:0,f:776,a:0.005,h:0.02,d:0.1,s:1,r:0.1,c:0,},{g:11,w:"sine",v:0.1,t:0,f:22,d:0.3,r:0.3,b:0,c:0,}],
        [{w:"n1",f:440,v:0.15,d:0.4,r:0.4,h:0,t:0,},{w:"n0",v:0.4,t:0,r:0.01,f:440,}],
/*60*/  null,null,null,null,null,
/*65*/  null,null,null,null,null,
/*70*/  null,null,null,null,null,
/*75*/  null,null,null,null,null,
/*80*/  [{w:"sine",f:1720,v:0.3,d:0.02,t:0,r:0.02,},{w:"square",g:1,t:0,f:2876,v:6,d:0.2,s:1,r:0.2,}],
        [{w:"sine",f:1720,v:0.3,d:0.25,t:0,r:0.25,},{w:"square",g:1,t:0,f:2876,v:6,d:0.2,s:1,r:0.2,}],
    ],
    drummap0:[
/*35*/[{w:"triangle",t:0,f:110,v:1,d:0.05,h:0.02,p:0.1,}],
      [{w:"triangle",t:0,f:150,v:0.8,d:0.1,p:0.1,h:0.02,r:0.01,}],
      [{w:"n0",f:392,v:0.5,d:0.01,p:0,t:0,r:0.05}],
      [{w:"n0",f:33,d:0.05,t:0,}],
      [{w:"n0",f:100,v:0.7,d:0.03,t:0,r:0.03,h:0.02,}],
/*40*/[{w:"n0",f:44,v:0.7,d:0.02,p:0.1,t:0,h:0.02,}],
      [{w:"triangle",f:240,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
      [{w:"n0",f:440,v:0.2,r:0.01,t:0,}],
      [{w:"triangle",f:270,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
      [{w:"n0",f:440,v:0.2,d:0.04,r:0.04,t:0,}],
/*45*/[{w:"triangle",f:300,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
      [{w:"n0",f:440,v:0.2,d:0.1,r:0.1,h:0.02,t:0,}],
      [{w:"triangle",f:320,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
      [{w:"triangle",f:360,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
      [{w:"n0",f:150,v:0.2,d:0.1,r:0.1,h:0.05,t:0,p:0.1,}],
/*50*/[{w:"triangle",f:400,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
      [{w:"n0",f:150,v:0.2,d:0.1,r:0.01,h:0.05,t:0,p:0.1}],
      [{w:"n0",f:150,v:0.2,d:0.1,r:0.01,h:0.05,t:0,p:0.1}],
      [{w:"n0",f:440,v:0.3,d:0.1,p:0.9,t:0,r:0.1,}],
      [{w:"n0",f:200,v:0.2,d:0.05,p:0.9,t:0,}],
/*55*/[{w:"n0",f:440,v:0.3,d:0.12,p:0.9,t:0,}],
      [{w:"sine",f:800,v:0.4,d:0.06,t:0,}],
      [{w:"n0",f:150,v:0.2,d:0.1,r:0.01,h:0.05,t:0,p:0.1}],
      [{w:"n0",f:33,v:0.3,d:0.2,p:0.9,t:0,}],
      [{w:"n0",f:300,v:0.3,d:0.14,p:0.9,t:0,}],
/*60*/[{w:"sine",f:200,d:0.06,t:0,}],
      [{w:"sine",f:150,d:0.06,t:0,}],
      [{w:"sine",f:300,t:0,}],
      [{w:"sine",f:300,d:0.06,t:0,}],
      [{w:"sine",f:250,d:0.06,t:0,}],
/*65*/[{w:"square",f:300,v:.3,d:.06,p:.8,t:0,}],
      [{w:"square",f:260,v:.3,d:.06,p:.8,t:0,}],
      [{w:"sine",f:850,v:.5,d:.07,t:0,}],
      [{w:"sine",f:790,v:.5,d:.07,t:0,}],
      [{w:"n0",f:440,v:0.3,a:0.05,t:0,}],
/*70*/[{w:"n0",f:440,v:0.3,a:0.05,t:0,}],
      [{w:"triangle",f:1800,v:0.4,p:0.9,t:0,h:0.03,}],
      [{w:"triangle",f:1800,v:0.3,p:0.9,t:0,h:0.13,}],
      [{w:"n0",f:330,v:0.3,a:0.02,t:0,r:0.01,}],
      [{w:"n0",f:330,v:0.3,a:0.02,t:0,h:0.04,r:0.01,}],
/*75*/[{w:"n0",f:440,v:0.3,t:0,}],
      [{w:"sine",f:800,t:0,}],
      [{w:"sine",f:700,t:0,}],
      [{w:"n0",f:330,v:0.3,t:0,}],
      [{w:"n0",f:330,v:0.3,t:0,h:0.1,r:0.01,p:0.7,}],
/*80*/[{w:"sine",t:0,f:1200,v:0.3,r:0.01,}],
      [{w:"sine",t:0,f:1200,v:0.3,d:0.2,r:0.2,}],

    ],
    /*@@gui*/
    _guiInit:()=>{
      if(this.canvas){
        this.ctx=this.canvas.getContext("2d");
        this.ctx.fillStyle="#000";
        this.ctx.fillRect(0,0,300,32);
        for(const [event,method] of [["dragover","dragOver"],["dragleave","dragLeave"],
          ["drop","execDrop"],["click","click"],["mousedown","pointerdown"],
          ["mousemove","pointermove"],["touchstart","pointerdown"],["touchend","pointerup"],
          ["touchcancel","pointerup"],["touchmove","pointermove"]]){
          const handler=this[method].bind(this);
          this.canvas.addEventListener(event,handler,false);
          this._listeners.push([this.canvas,event,handler]);
        }
      }
    },
    _guiUpdate:()=>{
      if(this.canvas){
        this.ctx.fillStyle="#000";
        this.ctx.fillRect(0,0,300,32);
        var row1=8,row2=20;
        if(this.song)
          row1=4,row2=24;
        else {
          this.ctx.fillStyle="#fff";
          this.ctx.fillText("TinySynth",8,20);
        }
        if(this.graph){
          this.ctx.fillStyle="#800";
          this.ctx.fillRect(80,row1,132,4);
          this.ctx.fillRect(80,row2,132,4);
          this.ctx.fillStyle="#f00";
          for(let i=this.notetab.length-1;i>=0;--i){
            const nt=this.notetab[i];
            if(!nt.f || this.rhythm[nt.ch]){
              this.ctx.fillRect(80+nt.n,row1,4,4);
              this.ctx.fillRect(80+nt.ch*8,row2,6,4);
            }
          }
        }
        if(this.perfmon){
          this.ctx.fillStyle="#fff";
          this.ctx.fillRect(180,30,28,-12);
          this.ctx.fillStyle="#000";
          this.ctx.fillText(this.notetab.length,185,28);
        }
        this.ctx.fillStyle="#fff";
        this.ctx.fillRect(250,15,32,2);
        this.ctx.fillStyle="#fff";
        this.ctx.strokeStyle="#000";
        this.ctx.beginPath();
        this.ctx.arc(250+this.masterVol*32,16,6,0,6.28,0);
        this.ctx.moveTo(220,12); this.ctx.lineTo(224,12); this.ctx.lineTo(230,6);
        this.ctx.lineTo(230,26); this.ctx.lineTo(224,20); this.ctx.lineTo(220,20);
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.strokeStyle="#fff";
        this.ctx.lineWidth=2;
        this.ctx.beginPath();
        this.ctx.arc(230,16,4,-1,1,false);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(230,16,8,-1,1,false);
        this.ctx.stroke();
        if(this.masterVol==0){
          this.ctx.strokeStyle="#000";
          this.ctx.lineWidth=4;
          this.ctx.beginPath();
          this.ctx.moveTo(220,7);
          this.ctx.lineTo(238,25);
          this.ctx.stroke();
          this.ctx.strokeStyle="#fff";
          this.ctx.lineWidth=2;
          this.ctx.stroke();
        }
        if(this.song){
          this.ctx.fillStyle="#fff";
          this.ctx.fillRect(4,2,28,28);
          this.ctx.fillRect(80,15,128,2);
          this.ctx.fillStyle="#000";
          if(this.playing){
            this.ctx.fillRect(12,10,4,12);
            this.ctx.fillRect(22,10,4,12);
          }
          else{
            this.ctx.beginPath();
            this.ctx.moveTo(12,9);
            this.ctx.lineTo(25,16);
            this.ctx.lineTo(12,23);
            this.ctx.fill();
          }
          this.ctx.fillStyle="#fff"
          this.ctx.fillText(this.toTime(this.playTick),38,14);
          this.ctx.fillText(this.toTime(this.maxTick),38,28);
          this.ctx.strokeStyle="#000";
          this.ctx.beginPath();
          this.ctx.arc(80+this.playTick/this.maxTick*128,16,6,0,6.28,0);
          this.ctx.fill();
          this.ctx.stroke();
        }
        if(this.waitdrop){
          this.ctx.fillStyle="rgba(0,0,0,0.7)"
          this.ctx.fillRect(0,0,300,32);
          this.ctx.fillStyle="#fff";
          this.ctx.fillText("Drop MIDI File Here",100,20);
        }
      }
    },
    toTime:(ti)=>{
      ti=(ti*4*60/this.song.timebase/this.song.tempo)|0;
      const m=(ti/60)|0;
      const s=ti%60;
      return ("00"+m).substr(-2)+":"+("00"+s).substr(-2);
    },
    preventScroll:(e)=>{
      e.preventDefault();
    },
    pointerup:(ev)=>{
      document.body.removeEventListener('touchstart',this.preventScroll,false);
    },
    getPos:(e)=>{
      var p=e.target.getBoundingClientRect();
      if(p.right!=p.left)
        return {x:(e.clientX-p.left)*300/(p.right-p.left),y:e.clientY-p.top};
      return {x:0,y:0};
    },
    pointerdown:(ev)=>{
      let e=ev;
      if(ev.touches)
        e=ev.touches[0];
      this.downpos=this.getPos(e);
      if(ev.touches || (e.buttons&1)){
        if(this.song&&this.downpos.x>=80&&this.downpos.x<=208){
          const p=(this.downpos.x-80)/128*this.maxTick;
          this.locateMIDI(p);
          document.body.addEventListener('touchstart',this.preventScroll,false);
        }
        if(this.downpos.x>=250&&this.downpos.x<282){
          const p=(this.downpos.x-250)/32;
          this.setMasterVol(p);
          document.body.addEventListener('touchstart',this.preventScroll,false);
        }
      }
    },
    pointermove:(ev)=>{
      let e=ev;
      if(ev.touches)
        e=ev.touches[0];
      if(ev.touches || (e.buttons&1)){
        const pos=this.getPos(e);
        if(this.song&&pos.x>=70&&pos.x<=208){
          if(pos.x<80) pos.x=80;
          const p=(pos.x-80)/128*this.maxTick;
          this.locateMIDI(p);
        }
        if(pos.x>=250&&pos.x<282){
          const p=(pos.x-250)/32;
          this.setMasterVol(p);
        }
      }
    },
    click:(e)=>{
      const pos=this.getPos(e);
      if(pos.x<40 && this.song){
        if(this.playing)
          this.stopMIDI();
        else if(this.song)
          this.playMIDI();
      }
      if(pos.x>=215&&pos.x<243 && this.downpos.x>=215 && this.downpos.x<243){
        if(this.masterVol>0){
          this.lastMasterVol=this.masterVol;
          this.masterVol=0;
        }
        else
          this.masterVol=this.lastMasterVol;
      }
    },
    dragLeave:(e)=>{
      this.waitdrop=0;
    },
    dragOver:(e)=>{
      this.waitdrop=1;
      e.stopPropagation();
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    execDrop:(e)=>{
      this.waitdrop=0;
      const f = e.dataTransfer.files;
      if(this.disabledrop==0){
        var reader = new FileReader();
        this._requests.add(reader);
        reader.onloadend=()=>this._requests.delete(reader);
        reader.onload=function(e){
          this._requests.delete(reader);
          if(this._disposed) return;
          this.loadMIDI(reader.result);
        }.bind(this);
        reader.readAsArrayBuffer(f[0]);
      }
      e.stopPropagation();
      e.preventDefault();
    },
    /*@@guiEND*/
    ready:()=>{
      return this._disposed ? Promise.reject(new Error("TinySynth is disposed")) : Promise.resolve();
    },
    init:()=>{
      if(this._initialized) throw new Error("TinySynth is already initialized");
      this._initialized=true;
      this.pg=[]; this.vol=[]; this.ex=[]; this.bend=[]; this.rpnidx=[]; this.brange=[];
      this.sustain=[]; this.notetab=[]; this.rhythm=[];
      this.masterTuningC=0; this.masterTuningF=0; this.tuningC=[]; this.tuningF=[]; this.scaleTuning=[];
      this.maxTick=0, this.playTick=0, this.playing=0; this.releaseRatio=3.5;
      for(let i=0;i<16;++i){
        this.pg[i]=0; this.vol[i]=3*100*100/(127*127);
        this.bend[i]=0; this.brange[i]=0x100;
        this.tuningC[i]=0; this.tuningF[i]=0;
        this.scaleTuning[i]=[0,0,0,0,0,0,0,0,0,0,0,0];
        this.rhythm[i]=0;
      }
      this.rhythm[9]=1;
      this.preroll=0.2;
      this.relcnt=0;
      this._timers.add(setInterval(
        function(){
          if(this._disposed) return;
          if(++this.relcnt>=3){
            this.relcnt=0;
            for(let i=this.notetab.length-1;i>=0;--i){
              var nt=this.notetab[i];
              if(this.actx.currentTime>nt.e){
                this._disposePartials(nt);
                this.notetab.splice(i,1);
              }
            }
            /*@@gui*/
            /*@@guiEND*/
          }
          if(this.playing && this.song.ev.length>0){
            let e=this.song.ev[this.playIndex];
            while(this.actx.currentTime+this.preroll>this.playTime){
              if(!e){
                if(this.loop && this.maxTick>0){
                  this.song.tempo=120;
                  this.tick2Time=4*60/this.song.tempo/this.song.timebase;
                  e=this.song.ev[this.playIndex=0];
                  this.playTime+=e.t*this.tick2Time;
                  this.playTick=e.t;
                  continue;
                }
                // Scheduling ahead must not discard the final rest.
                if(this.maxTick>0 && this.actx.currentTime<this.playTime)
                  break;
                this.playTick=this.maxTick;
                this.playing=0;
                break;
              }
              if(e.m[0]==0xff51){
                this.song.tempo=e.m[1];
                this.tick2Time=4*60/this.song.tempo/this.song.timebase;
              }
              else
                this._sendAtAudioTime(e.m,this.playTime);
              ++this.playIndex;
              if(this.playIndex>=this.song.ev.length){
                this.playTime+=(this.maxTick-this.playTick)*this.tick2Time;
                e=undefined;
              }
              else{
                e=this.song.ev[this.playIndex];
                this.playTime+=(e.t-this.playTick)*this.tick2Time;
                this.playTick=e.t;
              }
            }
          }
        }.bind(this),60
      ));
      if(this.debug)
        console.log("internalcontext:"+this.internalcontext)
      if(this._initialContext){
        this.setAudioContext(this._initialContext,this._initialDestination);
        this._initialContext=this._initialDestination=null;
      }
      else if(this.internalcontext){
        const Context=window.AudioContext || window.webkitAudioContext || globalThis.AudioContext;
        const context=new Context();
        this._ownedContext=context;
        this.setAudioContext(context);
      }
      this.isReady=1;
    },
    setMasterVol:(v)=>{
      if(v!=undefined)
        this.masterVol=v;
      if(this.out)
        this.out.gain.value=this.masterVol;
    },
    setReverbLev:(v)=>{
      if(v!=undefined)
        this.reverbLev=v;
      var r=parseFloat(this.reverbLev);
      if(this.rev&&!isNaN(r))
        this.rev.gain.value=r*8;
    },
    setLoop:(f)=>{
      this.loop=f;
    },
    setVoices:(v)=>{
      this.voices=v;
    },
    getPlayStatus:()=>{
      return {play:this.playing, maxTick:this.maxTick, curTick:this.playTick};
    },
    locateMIDI:(tick)=>{
      let i,p=this.playing;
      this.stopMIDI();
      tick=Math.max(0,Math.min(tick,this.maxTick));
      this.song.tempo=120;
      for(i=0;i<this.song.ev.length && tick>this.song.ev[i].t;++i){
        var m=this.song.ev[i];
        var ch=m.m[0]&0xf;
        switch(m.m[0]&0xf0){
        case 0xb0:
          switch(m.m[1]){
          case 1:  this.setModulation(ch,m.m[2]); break;
          case 7:  this.setChVol(ch,m.m[2]); break;
          case 10: this.setPan(ch,m.m[2]); break;
          case 11: this.setExpression(ch,m.m[2]); break;
          case 64: this.setSustain(ch,m.m[2]); break;
          }
          break;
        case 0xc0: this.pg[m.m[0]&0x0f]=m.m[1]; break;
        }
        if(m.m[0]==0xff51)
          this.song.tempo=m.m[1];
      }
      this.playIndex=i;
      this.playTick=tick;
      if(p)
        this.playMIDI();
    },
    getTimbreName:(m,n)=>{
      if(m==0)
        return this.program[n].name;
      else
        return this.drummap[n-35].name;
    },
    loadMIDIfromSrc:()=>{
      this.loadMIDIUrl(this.src);
    },
    loadMIDIUrl:(url)=>{
      if(!url)
        return;
      var xhr=new XMLHttpRequest();
      xhr.open("GET",url,true);
      xhr.responseType="arraybuffer";
      this._requests.add(xhr);
      xhr.onload=()=>{
        this._requests.delete(xhr);
        if(!this._disposed && xhr.status==200){
          this.loadMIDI(xhr.response);
        }
      };
      xhr.onloadend=()=>this._requests.delete(xhr);
      xhr.send();
    },
    reset:()=>{
      for(let i=0;i<16;++i){
        this.setProgram(i,0);
        this.setBendRange(i,0x100);
        this.setModulation(i,0);
        this.setChVol(i,100);
        this.setPan(i,64);
        this.resetAllControllers(i);
        this.allSoundOff(i);
        this.rhythm[i]=0;
        this.tuningC[i]=0;
        this.tuningF[i]=0;
        this.scaleTuning[i].fill(0);
      }
      this.masterTuningC=0;
      this.masterTuningF=0;
      this.rhythm[9]=1;
    },
    stopMIDI:()=>{
      this.playing=0;
      for(var i=0;i<16;++i)
        this.allSoundOff(i);
    },
    playMIDI:()=>{
      if(this.playing)
        return;
      if(!this.song || !this.song.ev.length){
        this.playing=0;
        return;
      }
      const dummy=this._createNode("Oscillator");
      dummy.connect(this.dest);
      dummy.onended=()=>this._disconnectNode(dummy);
      dummy.frequency.value=0;
      dummy.start(0);
      dummy.stop(this.actx.currentTime+0.001);
      if(this.playTick>=this.maxTick)
        this.locateMIDI(0);
      this.tick2Time=4*60/this.song.tempo/this.song.timebase;
      const next=this.song.ev[this.playIndex];
      const nextTick=next ? next.t : this.maxTick;
      this.playTime=this.actx.currentTime+.1+(nextTick-this.playTick)*this.tick2Time;
      this.playTick=nextTick;
      this.playing=1;
    },
    loadMIDI:(data)=>{
      var song=WebAudioTinySynth.parseMIDI(data);
      // Commit only after every track has been validated.
      this.stopMIDI();
      this.song=song;
      this.maxTick=song.maxTick;
      this.reset();
      this.locateMIDI(0);
    },
    setQuality:(q)=>{
      if(q!=undefined)
        this.quality=q;
      for(let i=0;i<128;++i)
        this.setTimbre(0,i,this.program0[i]);
      for(let i=0;i<this.drummap0.length;++i)
        this.setTimbre(1,i+35,this.drummap0[i]);
      if(this.quality){
        for(let i=0;i<this.program1.length;++i)
          this.setTimbre(0,i,this.program1[i]);
        for(let i=0;i<this.drummap.length;++i){
          if(this.drummap1[i])
            this.setTimbre(1,i+35,this.drummap1[i]);
        }
      }
    },
    setTimbre:(m,n,p)=>{
      const defp={g:0,w:"sine",t:1,f:0,v:0.5,a:0,h:0.01,d:0.01,s:0,r:0.05,p:1,q:1,k:0};
      function filldef(p){
        for(n=0;n<p.length;++n){
          for(let k in defp){
            if(!p[n].hasOwnProperty(k) || typeof(p[n][k])=="undefined")
              p[n][k]=defp[k];
          }
        }
        return p;
      }
      if(m && n>=35 && n<=81)
        this.drummap[n-35].p=filldef(p);
      if(m==0 && n>=0 && n<=127)
        this.program[n].p=filldef(p);
    },
    _disposePartials:(parts)=>{
      for(let k=parts.o.length-1;k>=0;--k){
        if(parts.o[k].detune && parts.modulation) {
          try {
            parts.modulation.disconnect(parts.o[k].detune);
          } catch (e) {}
        }
        this._disconnectNode(parts.o[k]);
        this._disconnectNode(parts.g[k]);
      }
    },
    _limitVoices:(ch,n)=>{
      this.notetab.sort(function(n1,n2){
        if(n1.f!=n2.f) return n1.f-n2.f;
        if(n1.e!=n2.e) return n2.e-n1.e;
        return n2.t-n1.t;
      });
      for(let i=this.notetab.length-1;i>=0;--i){
        var nt=this.notetab[i];
        if(this.actx.currentTime>nt.e || i>=(this.voices-1)){
          this._disposePartials(nt);
          this.notetab.splice(i,1);
        }
      }
    },
    _note:(t,ch,n,v,p)=>{
      const f=440*Math.pow(2,(n-69 + this.masterTuningC + this.tuningC[ch] + (this.masterTuningF + this.tuningF[ch]/8192 + this.scaleTuning[ch][n%12]))/12);
      this._limitVoices(ch,n);
      const rhythm=!!this.rhythm[ch];
      const parts=this._buildPartials(t,n,v,p,f,this.chvol[ch],this.chmod[ch],this.bend[ch]);
      const nt={...parts,t:t,e:rhythm ? t+p[0].d*this.releaseRatio : 99999,ch:ch,n:n,rhythm:rhythm,f:rhythm ? 1 : 0};
      this.notetab.push(nt);
      if(rhythm){
        let remaining=parts.o.length;
        for(const source of parts.o){
          source.onended=()=>{
            if(--remaining!==0) return;
            this._disposePartials(parts);
            const index=this.notetab.indexOf(nt);
            if(index!==-1) this.notetab.splice(index,1);
          };
          source.stop(nt.e);
        }
      }
    },
    _buildPartials:(t,n,v,p,f,destination,modulation,bend)=>{
      let out,sc,pn;
      const o=[],g=[],vp=[],fp=[],r=[];
      const before=new Set(this._nodes);
      try {
      for(let i=0;i<p.length;++i){
        pn=p[i];
        const dt=t+pn.a+pn.h;
        if(pn.g==0)
          out=destination, sc=v*v/16384, fp[i]=f*pn.t+pn.f;
        else if(pn.g>10)
          out=g[pn.g-11].gain, sc=1, fp[i]=fp[pn.g-11]*pn.t+pn.f;
        else if(o[pn.g-1].frequency)
          out=o[pn.g-1].frequency, sc=fp[pn.g-1], fp[i]=fp[pn.g-1]*pn.t+pn.f;
        else
          out=o[pn.g-1].playbackRate, sc=fp[pn.g-1]/440, fp[i]=fp[pn.g-1]*pn.t+pn.f;
        switch(pn.w[0]){
        case "n":
          o[i]=this._createNode("BufferSource");
          o[i].buffer=this.noiseBuf[pn.w];
          o[i].loop=true;
          o[i].playbackRate.value=fp[i]/440;
          if(pn.p!=1)
            this._setParamTarget(o[i].playbackRate,fp[i]/440*pn.p,t,pn.q);
          if (o[i].detune && modulation) {
            modulation.connect(o[i].detune);
            o[i].detune.value=bend;
          }
          break;
        default:
          o[i]=this._createNode("Oscillator");
          o[i].frequency.value=fp[i];
          if(pn.p!=1)
            this._setParamTarget(o[i].frequency,fp[i]*pn.p,t,pn.q);
          if(pn.w[0]=="w")
            o[i].setPeriodicWave(this.wave[pn.w]);
          else
            o[i].type=pn.w;
          if (o[i].detune && modulation) {
            modulation.connect(o[i].detune);
            o[i].detune.value=bend;
          }
          break;
        }
        g[i]=this._createNode("Gain");
        r[i]=pn.r;
        o[i].connect(g[i]); g[i].connect(out);
        vp[i]=sc*pn.v;
        if(pn.k)
          vp[i]*=Math.pow(2,(n-60)/12*pn.k);
        if(pn.a){
          g[i].gain.value=0;
          g[i].gain.setValueAtTime(0,t);
          g[i].gain.linearRampToValueAtTime(vp[i],t+pn.a);
        }
        else
          g[i].gain.setValueAtTime(vp[i],t);
        this._setParamTarget(g[i].gain,pn.s*vp[i],dt,pn.d);
        o[i].start(t);
      }
      return {o:o,g:g,v:vp,r:r,envelopes:p.map(part=>({...part})),modulation:modulation};
      } catch(error) {
        for(const node of [...this._nodes]) if(!before.has(node)) this._disconnectNode(node);
        throw error;
      }
    },
    playNote:(options)=>{
      const {program,note,velocity=100,gain=1,destination=this.out,startTime=this.actx.currentTime,duration}=options||{};
      const valid=(value,min,max)=>Number.isFinite(value) && value>=min && value<=max;
      if(!Number.isInteger(program) || !valid(program,0,127) || !Number.isInteger(note) || !valid(note,0,127) ||
        !Number.isInteger(velocity) || !valid(velocity,0,127) || !valid(gain,0,Number.MAX_VALUE) ||
        !valid(startTime,0,Number.MAX_VALUE) || (duration!==undefined && !valid(duration,0,Number.MAX_VALUE)))
        throw new RangeError("Invalid voice options");
      if(!destination || destination.context!==this.actx || typeof destination.connect!=="function")
        throw new TypeError("Voice destination must be an AudioNode in the synth AudioContext");
      let owner=this, context=this.actx, level=gain, root=null, parts=null;
      const start=Math.max(startTime,context.currentTime);
      if(duration!==undefined && !Number.isFinite(start+duration)) throw new RangeError("Invalid duration");
      let finished=false, releaseAt=Infinity, resolveEnded;
      const ended=new Promise(resolve=>{resolveEnded=resolve;});
      const finish=()=>{
        if(finished) return;
        finished=true;
        if(parts) owner._disposePartials(parts);
        if(root) owner._disconnectNode(root);
        owner._voices.delete(voice);
        parts=root=owner=context=null;
        resolveEnded(); resolveEnded=null;
      };
      const voice={
        get state(){ return finished ? "ended" : context.currentTime<start ? "scheduled" : context.currentTime>=releaseAt ? "releasing" : "playing"; },
        get gain(){ return level; },
        set gain(value){
          if(finished) return;
          if(!valid(value,0,Number.MAX_VALUE)) throw new RangeError("Invalid gain");
          root.gain.setValueAtTime(value,context.currentTime); level=value;
        },
        ended,
        stop:()=>finish(),
        release:(time)=>{
          if(finished) return;
          if(time===undefined) time=context.currentTime;
          if(!valid(time,0,Number.MAX_VALUE)) throw new RangeError("Invalid release time");
          time=Math.max(time,context.currentTime);
          if(time<start) { finish(); return; }
          if(time>=releaseAt) return;
          releaseAt=time;
          for(let i=0;i<parts.o.length;i++){
            const p=parts.envelopes[i];
            owner._releasePartial(parts.g[i].gain,p,parts.v[i],start,time);
            parts.o[i].stop(time+p.r*owner.releaseRatio);
          }
        },
      };
      try {
        root=this._createNode("Gain");
        root.gain.value=gain;
        root.connect(destination);
        parts=this._buildPartials(start,note,velocity,this.program[program].p,440*Math.pow(2,(note-69)/12),root,null,0);
        let remaining=parts.o.length;
        for(const oscillator of parts.o) oscillator.onended=()=>{ if(--remaining===0) finish(); };
        this._voices.add(voice);
        if(duration!==undefined) voice.release(start+duration);
        return voice;
      } catch(error) { finish(); throw error; }
    },
    _setParamTarget:(p,v,t,d)=>{
      if(d!=0)
        p.setTargetAtTime(v,t,d);
      else
        p.setValueAtTime(v,t);
    },
    _releasePartial:(parameter,p,peak,start,time)=>{
      const elapsed=time-start;
      let value=peak;
      if(elapsed<p.a) value=peak*elapsed/p.a;
      else if(elapsed>=p.a+p.h) value=p.d===0 ? p.s*peak : p.s*peak+(peak-p.s*peak)*Math.exp(-(elapsed-p.a-p.h)/p.d);
      parameter.cancelScheduledValues(time);
      // Removing the attack endpoint also removes the ramp before release.
      // Replace it with a shorter ramp, including when rescheduling earlier.
      if(p.a && elapsed<=p.a)
        parameter.linearRampToValueAtTime(value,time);
      else
        parameter.setValueAtTime(value,time);
      this._setParamTarget(parameter,0,time,p.r);
    },
    _releaseNote:(nt,t)=>{
      if(nt.rhythm || t>=nt.releaseAt) return;
      nt.releaseAt=t;
      for(let k=nt.g.length-1;k>=0;--k){
        this._releasePartial(nt.g[k].gain,nt.envelopes[k],nt.v[k],nt.t,t);
      }
      nt.e=t+Math.max(...nt.r)*this.releaseRatio;
      nt.f=1;
    },
    setModulation:(ch,v,t,audioTime)=>{
      this.chmod[ch].gain.setValueAtTime(v*100/127,this._tsConv(t,audioTime));
    },
    setChVol:(ch,v,t,audioTime)=>{
      this.vol[ch]=3*v*v/(127*127);
      this.chvol[ch].gain.setValueAtTime(this.vol[ch]*this.ex[ch],this._tsConv(t,audioTime));
    },
    setPan:(ch,v,t,audioTime)=>{
      if(this.chpan[ch])
        this.chpan[ch].pan.setValueAtTime((v-64)/64,this._tsConv(t,audioTime));
    },
    setExpression:(ch,v,t,audioTime)=>{
      this.ex[ch]=v*v/(127*127);
      this.chvol[ch].gain.setValueAtTime(this.vol[ch]*this.ex[ch],this._tsConv(t,audioTime));
    },
    setSustain:(ch,v,t,audioTime)=>{
      this.sustain[ch]=v;
      t=this._tsConv(t,audioTime);
      if(v<64){
        for(let i=this.notetab.length-1;i>=0;--i){
          const nt=this.notetab[i];
          if(t>=nt.t && nt.ch==ch && nt.f==1 && nt.releaseAt===undefined)
            this._releaseNote(nt,t);
        }
      }
    },
    allSoundOff:(ch)=>{
      for(let i=this.notetab.length-1;i>=0;--i){
        const nt=this.notetab[i];
        if(nt.ch==ch){
          this._disposePartials(nt);
          this.notetab.splice(i,1);
        }
      }
    },
    _allNotesOff:(ch,t,audioTime)=>{
      t=this._tsConv(t,audioTime);
      for(const nt of this.notetab){
        if(nt.ch===ch && !nt.rhythm && !nt.f && t>=nt.t){
          nt.f=1;
          if(this.sustain[ch]<64) this._releaseNote(nt,t);
        }
      }
    },
    resetAllControllers:(ch)=>{
      const time=this.actx ? this.actx.currentTime : 0;
      this.bend[ch]=0; this.ex[ch]=1.0;
      this.rpnidx[ch]=0x3fff; this.sustain[ch]=0;
      if(this.chvol[ch]){
        this.chvol[ch].gain.cancelScheduledValues(time);
        this.chvol[ch].gain.setValueAtTime(this.vol[ch],time);
        this.chmod[ch].gain.cancelScheduledValues(time);
        this.chmod[ch].gain.setValueAtTime(0,time);
      }
      for(const nt of this.notetab){
        if(nt.ch!==ch) continue;
        for(const source of nt.o){
          if(source.detune){
            source.detune.cancelScheduledValues(time);
            source.detune.setValueAtTime(0,time);
          }
        }
        if(nt.f && time>=nt.t && nt.releaseAt===undefined) this._releaseNote(nt,time);
      }
    },
    setBendRange:(ch,v)=>{
      this.brange[ch]=v;
    },
    setProgram:(ch,v)=>{
      if(this.debug)
        console.log("Pg("+ch+")="+v);
      this.pg[ch]=v;
    },
    _tsConv:(t,audioTime)=>{
      if(audioTime) return t;
      if(t==undefined||t<=0){
        t=0;
        if(this.actx)
          t=this.actx.currentTime;
      }
      else{
        if(this.tsmode)
          t=t*.001-this.tsdiff;
      }
      return t;
    },
    setBend:(ch,v,t,audioTime)=>{
      t=this._tsConv(t,audioTime);
      const br=this.brange[ch]*100/127;
      this.bend[ch]=(v-8192)*br/8192;
      for(let i=this.notetab.length-1;i>=0;--i){
        const nt=this.notetab[i];
        if(nt.ch==ch){
          for(let k=nt.o.length-1;k>=0;--k){
            if(nt.o[k].detune) nt.o[k].detune.setValueAtTime(this.bend[ch],t);
          }
        }
      }
    },
    noteOff:(ch,n,t,audioTime)=>{
      t=this._tsConv(t,audioTime);
      for(let i=this.notetab.length-1;i>=0;--i){
        const nt=this.notetab[i];
        if(t>=nt.t && nt.ch==ch && nt.n==n && nt.f==0 && !nt.rhythm){
          nt.f=1;
          if(this.sustain[ch]<64)
            this._releaseNote(nt,t);
        }
      }
    },
    noteOn:(ch,n,v,t,audioTime)=>{
      if(v==0){
        this.noteOff(ch,n,t,audioTime);
        return;
      }
      t=this._tsConv(t,audioTime);
      if(this.rhythm[ch]){
        if(n>=35&&n<=81)
          this._note(t,ch,n,v,this.drummap[n-35].p);
        return;
      }
      this._note(t,ch,n,v,this.program[this.pg[ch]].p);
    },
    setTsMode:(tsmode)=>{
      this.tsmode=tsmode;
    },
    send:(msg,t)=>{
      this._dispatchMIDI(msg,t,false);
    },
    _sendAtAudioTime:(msg,t)=>{
      this._dispatchMIDI(msg,t,true);
    },
    _dispatchMIDI:(msg,t,audioTime)=>{
      const ch=msg[0]&0xf;
      const cmd=msg[0]&~0xf;
      if(cmd<0x80||cmd>=0x100)
        return;
      if(this.audioContext.state=="suspended" && typeof this.audioContext.startRendering!=="function"){
        this.audioContext.resume();
      }
      switch(cmd){
      case 0xb0:  /* ctl change */
        switch(msg[1]){
        case 1:  this.setModulation(ch,msg[2],t,audioTime); break;
        case 7:  this.setChVol(ch,msg[2],t,audioTime); break;
        case 10: this.setPan(ch,msg[2],t,audioTime); break;
        case 11: this.setExpression(ch,msg[2],t,audioTime); break;
        case 64: this.setSustain(ch,msg[2],t,audioTime); break;
        case 98:  case 99: this.rpnidx[ch]=0x3fff; break; /* nrpn lsb/msb */
        case 100: this.rpnidx[ch]=(this.rpnidx[ch]&0x3f80)|msg[2]; break; /* rpn lsb */
        case 101: this.rpnidx[ch]=(this.rpnidx[ch]&0x7f)|(msg[2]<<7); break; /* rpn msb */
        case 6:  /* data entry msb */
          switch (this.rpnidx[ch]) {
            case 0:
              this.brange[ch]=(msg[2]<<7)+(this.brange[ch]&0x7f);
              break;
            case 1:
              this.tuningF[ch]=(msg[2]<<7)+((this.tuningF[ch]+0x2000)&0x7f)-0x2000;
              break;
            case 2:
              this.tuningC[ch]=msg[2]-0x40;
              break;
          }
          break;
        case 38:  /* data entry lsb */
          switch (this.rpnidx[ch]) {
            case 0:
              this.brange[ch]=(this.brange[ch]&0x3f80)|msg[2];
              break;
            case 1:
              this.tuningF[ch]=(((this.tuningF[ch]+0x2000)&0x3f80)|msg[2])-0x2000;
              break;
            case 2: break;
          }
          break;
        case 120:  /* all sound off */
          this.allSoundOff(ch);
          break;
        case 123:  /* all notes off */
        case 124: case 125: case 126: case 127: /* omni off/on mono/poly */
          this._allNotesOff(ch,t,audioTime);
          break;
        case 121: this.resetAllControllers(ch); break;
        }
        break;
      case 0xc0: this.setProgram(ch,msg[1]); break;
      case 0xe0: this.setBend(ch,(msg[1]+(msg[2]<<7)),t,audioTime); break;
      case 0x90: this.noteOn(ch,msg[1],msg[2],t,audioTime); break;
      case 0x80: this.noteOff(ch,msg[1],t,audioTime); break;
      case 0xf0:
        if (msg[0] == 0xff) {
          this.reset();
          break;
        }
        if(msg[0]!=254 && this.debug){
          var ds=[];
          for(let ii=0;ii<msg.length;++ii)
            ds.push(msg[ii].toString(16));
        }
        if (msg[0]==0xf0) {
          if (msg[1]==0x7f && msg[3]==4) {
            if (msg[4]==3 && msg.length >= 8) { // Master Fine Tuning
              this.masterTuningF = (msg[6]*0x80 + msg[5] - 8192) / 8192;
            }
            if (msg[4]==4 && msg.length >= 8) { // Master Coarse Tuning
              this.masterTuningC = msg[6]-0x40;
            }
          }
          if (msg[1]==0x41 && msg[3]==0x42 && msg[4]==0x12 &&msg[5]==0x40) { // GS
            if ((msg[6]&0xf0)==0x10 && msg.length==11) {
              const c=[9,0,1,2,3,4,5,6,7,8,10,11,12,13,14,15][msg[6]&0xf];
              if (msg[7]==0x15) {
                this.rhythm[c]=msg[8];
              }
              else if (msg[7] >= 0x40 && msg[7] <= 0x4b) { // Scale Tuning
                this.scaleTuning[c][msg[7]-0x40] = (msg[8]-0x40) / 100;
              }
            }
            else if (msg[6]==0) {
              if (msg[7]==0 && msg.length==14) { // Master Tuning
                this.masterTuningF = (msg[8]*0x1000 + msg[9]*0x100 + msg[10]*0x10 + msg[11] - 0x400) / 1000;
              }
              else if (msg[7]==5 && msg.length==11) { // Master Transpose
                this.masterTuningC = msg[8]-0x40;
              }
            }
          }
        }
        break;
      }
    },
    _createWave:(w)=>{
      const imag=new Float32Array(w.length);
      const real=new Float32Array(w.length);
      for(let i=1;i<w.length;++i)
        imag[i]=w[i];
      return this.actx.createPeriodicWave(real,imag);
    },
    getAudioContext:()=>{
      return this.actx;
    },
    setAudioContext:(actx,dest)=>{
      if(!actx || typeof actx.createGain!=="function" || actx.state==="closed" || (dest && dest.context!==actx))
        throw new TypeError("A live AudioContext and a destination belonging to it are required");
      const keepOwned=this._ownedContext===actx;
      if(keepOwned) this._ownedContext=null;
      this._tearDownGraph();
      if(keepOwned) this._ownedContext=actx;
      this.audioContext=this.actx=actx;
      this.dest=dest;
      if(!dest)
        this.dest=actx.destination;
      this.tsdiff=performance.now()*.001-this.actx.currentTime;
      if(this.debug)
        console.log("TSDiff:"+this.tsdiff);
      this.out=this._createNode("Gain");
      this.comp=this._createNode("DynamicsCompressor");
      var blen=this.actx.sampleRate*.5|0;
      this.convBuf=this.actx.createBuffer(2,blen,this.actx.sampleRate);
      this.noiseBuf={};
      this.noiseBuf.n0=this.actx.createBuffer(1,blen,this.actx.sampleRate);
      this.noiseBuf.n1=this.actx.createBuffer(1,blen,this.actx.sampleRate);
      var d1=this.convBuf.getChannelData(0);
      var d2=this.convBuf.getChannelData(1);
      var dn=this.noiseBuf.n0.getChannelData(0);
      var dr=this.noiseBuf.n1.getChannelData(0);
      for(let i=0;i<blen;++i){
        if(i/blen<Math.random()){
          d1[i]=Math.exp(-3*i/blen)*(Math.random()-.5)*.5;
          d2[i]=Math.exp(-3*i/blen)*(Math.random()-.5)*.5;
        }
        dn[i]=Math.random()*2-1;
      }
      for(let jj=0;jj<64;++jj){
        const r1=Math.random()*10+1;
        const r2=Math.random()*10+1;
        for(let i=0;i<blen;++i){
          var dd=Math.sin((i/blen)*2*Math.PI*440*r1)*Math.sin((i/blen)*2*Math.PI*440*r2);
          dr[i]+=dd/8;
        }
      }
      if(this.useReverb){
        this.conv=this._createNode("Convolver");
        this.conv.buffer=this.convBuf;
        this.rev=this._createNode("Gain");
        this.rev.gain.value=this.reverbLev;
        this.out.connect(this.conv);
        this.conv.connect(this.rev);
        this.rev.connect(this.comp);
      }
      this.setMasterVol();
      this.out.connect(this.comp);
      this.comp.connect(this.dest);
      this.chvol=[]; this.chmod=[]; this.chpan=[];
      this.wave={"w9999":this._createWave("w9999")};
      this.lfo=this._createNode("Oscillator");
      this.lfo.frequency.value=5;
      this.lfo.start(0);
      for(let i=0;i<16;++i){
        this.chvol[i]=this._createNode("Gain");
        if(this.actx.createStereoPanner){
          this.chpan[i]=this._createNode("StereoPanner");
          this.chvol[i].connect(this.chpan[i]);
          this.chpan[i].connect(this.out);
        }
        else{
          this.chpan[i]=null;
          this.chvol[i].connect(this.out);
        }
        this.chmod[i]=this._createNode("Gain");
        this.lfo.connect(this.chmod[i]);
        this.pg[i]=0;
        this.resetAllControllers(i);
      }
      this.setReverbLev();
      this.reset();
      this.send([0x90,60,1]);
      this.send([0x90,60,0]);
      const completion=Promise.all(this._closing).then(()=>undefined);
      completion.catch(()=>{});
      return completion;
    },
  });
  for(const key of Object.keys(target)){
    if(typeof target[key]==="function" && key[0]!=="_" && key!=="dispose" && key!=="ready"){
      const operation=target[key];
      target[key]=(...args)=>{
        if(this._disposed) throw new Error("TinySynth is disposed");
        return operation(...args);
      };
    }
  }
}
if(window && window.customElements){
  class WebAudioTinySynthElement extends HTMLElement {
    constructor(){
      super();
    }
    connectedCallback(){
      if(this._initialized) return;
      const div = document.createElement("div");
      div.innerHTML=
  `<canvas
    id='wa-canvas' width='300' height='32'
    touch-action='none' tabindex='0'
    style='
      position:relative;
      margin:0;
      border:none;
      width:300px;
      height:32px;
    '
  ></canvas>
  <div id='wa-logo'
    style='
      display:none;
      position:absolute;
      top:5px;
      left:5px;
      color:#fff;
      font-size:8px;
      background:rgba(0,0,0,0.5);
    '
  >TinySynth</div>`;

      this.getAttr = (n,def)=>{
        let v=this.getAttribute(n);
        if(v==""||v==null) return def;
        switch(typeof(def)){
        case "number":
          if(v=="true") return 1;
          v=+v;
          if(isNaN(v)) return 0;
          return v;
        }
        return v;
      };

      this.canvas = div.children[0];
      this.appendChild(div);
      WebAudioTinySynthCore.bind(this)(this);
      const plist=this.properties;
      for(let k in plist){
        const v = plist[k];
        if(v.observer){
          this["_"+k] = v.value;
          Object.defineProperty(this, k, {
            get:()=>{return this["_"+k]},
            set:(val)=>{
              this["_"+k] = val;
              this[v.observer]();
            }
          });
        }
        else{
          this[k]=v;
        }
      }
      for(let k in plist){
        const v = plist[k];
        this[k] = this.getAttr(k,v.value);
      }
      this.setQuality(1);
      try { this.init(); }
      catch(error){ this.dispose().catch(()=>{}); throw error; }
      this._guiInit.bind(this)();
      this._timers.add(setInterval(()=>{ if(!this._disposed) this._guiUpdate(); },100));
    }
    disconnectedCallback(){
      if(this.dispose) this.dispose().catch(error=>console.error(error));
    }
  }
  window.customElements.define('webaudio-tinysynth', WebAudioTinySynthElement);
}

class WebAudioTinySynth {
  constructor(opt){
    WebAudioTinySynthCore.bind(this)(this);
    for(let k in this.properties){
      this[k]=this.properties[k].value;
    }
    this.setQuality(1);
    if(opt){
      this._initialContext=opt.audioContext;
      this._initialDestination=opt.destination;
      if(opt.useReverb!=undefined)
        this.useReverb=opt.useReverb;
      if(opt.quality!=undefined)
        this.setQuality(opt.quality);
      if(opt.voices!=undefined)
        this.setVoices(opt.voices);
    }
    if(this._initialDestination && !this._initialContext)
      throw new TypeError("destination requires audioContext");
    try { this.init(); }
    catch(error){ this.dispose().catch(()=>{}); throw error; }
  }
}

// Decode SMF data without constructing an audio context or mutating playback.
WebAudioTinySynth.parseMIDI=function(data) {
  var bytes=new Uint8Array(data), cursor=0, end=bytes.length;
  function invalid(reason) { throw new Error("Invalid MIDI: "+reason); }
  function need(length) {
    if(length>end-cursor) invalid("truncated data");
  }
  function read(length) {
    need(length);
    var value=0;
    while(length--) value=value*256+bytes[cursor++];
    return value;
  }
  function variable() {
    var value=0;
    for(var count=0;count<4;++count) {
      var byte=read(1);
      value=value*128+(byte&127);
      if(!(byte&128)) return value;
    }
    invalid("variable-length value exceeds four bytes");
  }
  function text(length) {
    need(length);
    var value="";
    while(length--) value+=String.fromCharCode(bytes[cursor++]);
    return value;
  }
  if(read(4)!==0x4d546864) invalid("missing MThd");
  var headerLength=read(4);
  if(headerLength<6) invalid("short header");
  need(headerLength);
  var format=read(2), tracks=read(2), division=read(2);
  if(format>1) invalid("unsupported SMF format "+format);
  if(!tracks || (format===0 && tracks!==1)) invalid("invalid track count for SMF format");
  if(division&0x8000) invalid("SMPTE timing is unsupported");
  if(!division) invalid("zero time division");
  var timebase=division*4;
  cursor+=headerLength-6;
  var song={copyright:"",text:"",tempo:120,timebase:timebase,ev:[]};
  var maxTick=0;
  for(var track=0;track<tracks;++track) {
    end=bytes.length;
    if(read(4)!==0x4d54726b) invalid("missing MTrk");
    var length=read(4);
    need(length);
    end=cursor+length;
    var tick=0, running=0, ended=false;
    while(cursor<end) {
      tick+=variable();
      var status=read(1);
      if(status<128) {
        if(!running) invalid("running status without channel status");
        --cursor;
        status=running;
      }
      if(status<0xf0) {
        running=status;
        var message=[status];
        var count=(status&0xf0)===0xc0 || (status&0xf0)===0xd0 ? 1 : 2;
        while(count--) {
          var value=read(1);
          if(value>=128) invalid("invalid channel data byte");
          message.push(value);
        }
        song.ev.push({t:tick,m:message});
      }
      else {
        running=0;
        if(status===0xff) {
          var type=read(1), size=variable();
          need(size);
          if(type===0x2f) {
            if(size!==0) invalid("invalid End-of-Track length");
            ended=true;
            break;
          }
          if(type===0x51) {
            if(size!==3) invalid("invalid tempo length");
            var tempo=read(3);
            if(!tempo) invalid("zero tempo");
            song.ev.push({t:tick,m:[0xff51,60000000/tempo]});
          }
          else if(type===2) song.copyright+=text(size);
          else if(type===1 || type===3 || type===4 || type===9) song.text=text(size);
          else cursor+=size;
        }
        else if(status===0xf0 || status===0xf7) {
          var size=variable();
          need(size);
          var message=Array.from(bytes.slice(cursor,cursor+size));
          message.unshift(0xf0);
          song.ev.push({t:tick,m:message});
          cursor+=size;
        }
        else invalid("unsupported event status");
      }
    }
    if(!ended) invalid("missing End-of-Track");
    if(tick>maxTick) maxTick=tick;
    cursor=end;
  }
  song.ev.sort(function(x,y){return x.t-y.t});
  song.maxTick=maxTick;
  return song;
};

if(typeof exports === 'object' && typeof module !== 'undefined'){
  module.exports = WebAudioTinySynth;
}
else if(typeof define === 'function' && define.amd){
    define(function(){
      return WebAudioTinySynth;
    });
}
else{
  window.WebAudioTinySynth = WebAudioTinySynth;
}

})(this);
