# @xrnavigation/webaudio-tinysynth

A Web Audio GM synthesizer with generated instruments, MIDI-file playback, and
independently owned voices. This XR Navigation fork adds explicit context and
voice lifecycle ownership and ships JavaScript and TypeScript declarations.

## Install

This fork is published to GitHub Packages. Configure your project's `.npmrc`:

```ini
@xrnavigation:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

Set `NPM_TOKEN` outside the repository to a token with package read access and
any required organization SSO authorization. Then install:

```sh
npm install @xrnavigation/webaudio-tinysynth
```

CommonJS:

```js
const WebAudioTinySynth = require('@xrnavigation/webaudio-tinysynth');
```

TypeScript:

```ts
import WebAudioTinySynth = require('@xrnavigation/webaudio-tinysynth');
```

For a browser script, serve `webaudio-tinysynth.js` or
`webaudio-tinysynth.min.js` from this package:

```html
<script src="./webaudio-tinysynth.js"></script>
```

Both distributions are self-contained. Instruments use oscillators and generated
noise; no sample bank is downloaded.

## Create a synth

```js
const context = new AudioContext();
const synth = new WebAudioTinySynth({
  audioContext: context,
  destination: context.destination,
  quality: 1,
  useReverb: 1,
  voices: 64,
});
```

Zero-argument construction creates an internally owned AudioContext. An injected
context belongs to the caller and is never closed by the synth. `destination`
requires `audioContext` and must belong to that context.

`quality: 0` selects the lighter chiptune instrument set; `quality: 1` selects
the FM instrument set. `useReverb: 0` disables the reverb graph. The `voices`
limit applies to MIDI voices, including percussion; independently owned voices
have no automatic admission limit or stealing.

Follow the browser's audio activation rules and resume your shared context from
a user interaction when necessary.

## Independently owned voices

```js
const voice = synth.playNote({
  program: 73,
  note: 60,
  velocity: 100,
  gain: 0.5,
  startTime: context.currentTime,
  duration: 0.25,
});

voice.gain = 0.25;
voice.release(); // begin the instrument's release envelope
voice.stop();    // immediately silence this voice, including its release tail
await voice.ended;
```

Program and note are required integer MIDI values 0–127. Velocity defaults to
100, accepts integer values 0–127, and is silent at zero. Gain defaults to 1 and must be finite
and nonnegative. It scales the voice independently of velocity and timbre.

`startTime` is absolute AudioContext seconds; past times start now. Optional
`duration` specifies seconds from accepted start to release. Both must be finite
and nonnegative. Without duration, the voice remains active until released, stopped,
or its synth is disposed or reconfigured. These times ignore MIDI timestamp mode.

`release(time?)` defaults to now and evaluates each partial's envelope at release.
An earlier release can replace a future release; a later repeated release does not
extend it. Release before a future start cancels the voice. `stop()` is immediate,
even after a future duration or release has been scheduled.

`state` is `scheduled`, `playing`, `releasing`, or `ended`. The `ended`
promise resolves when all source nodes have been released. Retained ended handles
are inert.

### Routing and isolation

The default route includes the synth's master gain, compressor, and optional
reverb. Supply a same-context `destination` to receive the dry voice directly,
bypassing shared controls and effects:

```js
const panner = context.createStereoPanner();
panner.connect(context.destination);
const voice = synth.playNote({ program: 73, note: 60, destination: panner });
```

The caller owns this destination and its downstream effects. Voice cleanup never
disconnects the caller's destination. Shared reverb may retain an already emitted
tail after a voice stops; use a caller-owned dry route for independently controlled
effects.

MIDI program changes, tuning, controllers, reset, and transport operations do not
alter independent voices. Context replacement and disposal stop every owned voice.
Invalid voice options throw before allocation; graph-construction failure releases
partial allocations without interrupting other independent voices.

## MIDI messages and files

```js
synth.send([0x90, 60, 100]); // channel 1, middle C
synth.send([0x80, 60, 0], context.currentTime + 0.25);
```

Channels are 0–15; channel 9 defaults to percussion, with drum notes 35–81.
Programs and melodic notes are 0–127.

By default, message timestamps are AudioContext seconds. After `setTsMode(1)`,
public message timestamps use the `performance.now()` millisecond timeline.
Omitted or zero timestamps mean now. Built-in sequence timing remains in
AudioContext seconds regardless of this external timestamp mode.

A note-off (or All Notes Off) applies to notes already sounding when it is
sent. An earlier note-off replaces a scheduled later one; a later note-off does
not extend the note. A held sustain pedal still defers the release until
pedal-up.

```js
await synth.loadMIDIUrl('./song.mid');
synth.setLoop(1);
synth.playMIDI();
synth.locateMIDI(480);
const status = synth.getPlayStatus(); // { play, curTick, maxTick }
synth.stopMIDI();
```

Seeking restores initial channel state and replays supported state changes strictly
before the target tick. Events at that tick remain pending; historical notes are
not retriggered. The target is clamped to the song boundaries. Seeking while
playing resumes there, except seeking to the end stops playback.

`loadMIDI(arrayBuffer)` loads synchronously. SMF format 0 (one track) and format 1
with ticks-per-quarter-note timing are supported. Malformed files, format 2, and
SMPTE timing throw before replacing the current song. Tempo precision and
End-of-Track duration, including trailing silence, are retained.

`loadMIDIUrl(url)` returns a promise. HTTP, network, and parser errors reject and
leave the current song intact. The latest started URL load wins; a newer request,
successful direct load, or disposal cancels pending loading with an `AbortError`.
Handle cancellation rejections. An empty URL is a no-op on a live synth.

`WebAudioTinySynth.parseMIDI(arrayBuffer)` parses without creating a synth or
AudioContext. Its result contains:

- `copyright` and `text`.
- `tempo`: initial 120 BPM.
- `timebase`: ticks per whole note.
- `maxTick`: final End-of-Track tick.
- `ev`: events shaped `{ t, m }`, sorted by tick, then source track/event order.
  Tempo messages use `[0xff51, BPM]` with fractional precision.

### MIDI API reference

| Method | Purpose |
| --- | --- |
| `noteOn(ch, note, velocity, time?)` | Start a note; velocity zero acts as note-off. |
| `noteOff(ch, note, time?)` | Release matching notes, honoring sustain. |
| `setProgram(ch, program)` | Select the channel instrument. |
| `setModulation(ch, value, time?)` | Set vibrato depth, 0–127. |
| `setChVol(ch, value, time?)` | Set channel volume, 0–127; default 100. |
| `setExpression(ch, value, time?)` | Set channel expression, 0–127. |
| `setPan(ch, value, time?)` | Set pan, 0–127; center 64. |
| `setSustain(ch, value, time?)` | Pedal on at 64 or higher. |
| `setBend(ch, value, time?)` | Set pitch bend, 0–16383; center 8192. |
| `setBendRange(ch, value)` | Set the legacy encoded bend range; default 0x100. |
| `allSoundOff(ch)` | Immediately stop all MIDI sources on the channel. |
| `resetAllControllers(ch)` | Reset bend, expression, modulation, sustain, and RPN selection. |
| `reset()` | Reset all channels, programs, tuning, and MIDI voices. |
| `setMasterVol(value)` | Set shared output gain; default 0.5. |
| `setReverbLev(value)` | Set shared reverb level; default 0.3. |
| `setQuality(value)` | Replace timbres with quality 0 or 1 defaults. |
| `setVoices(value)` | Set the MIDI voice limit. |
| `getTimbreName(mode, index)` | Get a melodic program name (mode 0) or drum name (mode 1). |

Supported messages include note on/off, program change, pitch bend, modulation,
volume, pan, expression, sustain, RPN selection/data entry, and channel-mode
messages. All Notes Off (CC123) honors sustain and release tails; All Sound Off
(CC120) silences immediately. Polyphonic and channel pressure are not synthesized.
RPN tuning and supported universal/GS tuning messages are implemented in
`send()`; see `test-midi/` for tuning fixtures.

## Custom instruments

```ts
const partials: WebAudioTinySynth.TimbrePartial[] = [
  { w: 'sine', v: 0.4, d: 0.7, r: 0.1 },
  { w: 'triangle', v: 3, d: 0.7, s: 0.1, g: 1, a: 0.01, k: -1.2 },
];
synth.setTimbre(0, 0, partials);
```

Use mode 0 with program 0–127, or mode 1 with drum note 35–81. Each array item is
one partial. Omitted fields receive defaults; `setTimbre()` fills those defaults
into the supplied objects.

| Field | Meaning |
| --- | --- |
| `w` | `sine`, `square`, `sawtooth`, `triangle`, `n0` (white noise), `n1` (metallic noise), or `w9999` (harmonics). |
| `g` | 0 routes to output; 1–10 modulate frequency of partial `g-1`; 11+ modulate gain of partial `g-11`. Targets must precede the partial. |
| `t`, `f` | Frequency multiplier and fixed offset in Hz. |
| `v` | Partial level. |
| `a`, `h` | Attack and hold duration in seconds. |
| `d`, `s` | Decay time constant in seconds and sustain fraction. |
| `r` | Release time constant in seconds. |
| `p`, `q` | Pitch target multiplier and transition time constant in seconds. |
| `k` | Volume key-tracking exponent. |

## Context and disposal

`getAudioContext()` returns the active context.
`setAudioContext(context, destination?)` synchronously stops the previous graph
and builds a replacement. Its promise observes closure of an old internally owned
context. Reusing the same owned context retains ownership without closing it.
Injected contexts and caller destinations remain caller-owned.

`dispose()` immediately stops owned sources, disconnects owned nodes, cancels
pending reads, removes GUI listeners, and clears timers. It returns the same
promise on repeated calls, waiting for owned-context closures and rejecting if
closure fails. Synchronous graph cleanup still happens.

Disposal is permanent. Subsequent synchronous public operations throw
`TinySynth is disposed`; `ready()` and `loadMIDIUrl()` reject their promises.
Initialization is synchronous, so `ready()` needs no polling timer.
Calling `init()` twice throws; use `setAudioContext()` to rebuild instead.

## Custom element

Loading the browser distribution registers `webaudio-tinysynth`:

```html
<webaudio-tinysynth id="synth" quality="0" useReverb="0"></webaudio-tinysynth>
<script>
  const synth = document.getElementById('synth');
  synth.ready().then(() => synth.send([0x90, 60, 100]));
</script>
```

The connected element exposes the same instance APIs. Attributes include
`quality`, `useReverb`, `masterVol`, `reverbLev`, `voices`, `loop`,
`tsmode`, `src`, `width`, `height`, `graph`, `perfmon`, and
`disableDrop`. Use `internalContext="0"` to provide a context later through
`setAudioContext()`. Automatic `src` loading reports failures through an
`error` event whose `detail` is the error; cancellation does not emit an event.

Disconnecting an element disposes it permanently. Create a new element for a new
session. Automatic disposal reports context-close failures to the console; calling
`dispose()` also gives access to the completion promise.

## Development and releases

Use Node 22 or 24:

```sh
npm ci
npm test
npm run check:dist
npm run test:package
npx playwright install chromium
npm run test:browser
```

`npm run build` regenerates the minified distribution and source map. Commit both
generated files after source changes. `check:dist` rebuilds and checks consistency.
The package check installs the actual tarball into a temporary consumer and checks
CommonJS/browser exports and TypeScript usage. Native Chromium checks exercise
Web Audio scheduling and rendered output.

CI runs on pull requests and master. Releases use a reviewed version change and a
matching `v<version>` tag. The tag workflow validates, publishes to GitHub
Packages, and creates a GitHub release. Package versions are immutable.

## Upstream and license

Based on [Tatsuya Shinyagaito's WebAudio TinySynth](https://github.com/g200kg/webaudio-tinysynth),
licensed under Apache-2.0. See [LICENSE](LICENSE).

The upstream npm package `webaudio-tinysynth`, its CDN URLs, and
[upstream demos](https://g200kg.github.io/webaudio-tinysynth/) are separate from
this scoped fork. To exercise this checkout, serve its local `simple.html`,
`jstest.html`, or `soundedit.html`. The editor and custom-element demos also
load upstream WebAudio controls.
