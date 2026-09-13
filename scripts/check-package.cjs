const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadSynth } = require('../test/harness.cjs');
const npmCli = process.env.npm_execpath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tinysynth-package-'));
try {
  const [packed] = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', tmp], { encoding: 'utf8' }));
  assert.deepEqual(packed.files.map(file => file.path).sort(), [
    'LICENSE', 'README.md', 'package.json', 'webaudio-tinysynth.js', 'webaudio-tinysynth.d.ts',
    'webaudio-tinysynth.min.js', 'webaudio-tinysynth.min.js.map',
  ].sort());
  const consumer = path.join(tmp, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"name":"consumer","private":true}');
  execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(tmp, packed.filename)], { cwd: consumer, stdio: 'pipe' });
  const entry = require.resolve('@xrnavigation/webaudio-tinysynth', { paths: [consumer] });
  assert.equal(typeof require(entry), 'function', 'native CommonJS import works without browser globals');
  fs.copyFileSync(path.join(__dirname, '..', 'test', 'consumer.ts'), path.join(consumer, 'consumer.ts'));
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--noEmit', '--target', 'ES2020', '--module', 'commonjs', 'consumer.ts'], { cwd: consumer, stdio: 'pipe' });
  for (const filename of [entry, path.join(path.dirname(entry), 'webaudio-tinysynth.min.js')]) {
    for (const commonjs of [true, false]) {
      const { Synth, context } = loadSynth(filename, commonjs);
      const synth = new Synth({ audioContext: context, useReverb: 0 });
      assert.equal(synth.program.length, 128);
      synth.send([0x90, 60, 100]);
      const voice = synth.playNote({ program: 73, note: 60, gain: 0 });
      voice.stop();
      assert.equal(voice.state, 'ended');
      synth.dispose();
    }
  }
  console.log('Packed install and CommonJS/browser entry points passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
