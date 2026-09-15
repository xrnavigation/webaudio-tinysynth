# Partial allocation benchmark

Baseline: `a1c4185b4d266a24e752d544f560922feb9603a8`, source blob
`ac42175aa4de97b2cb3f4c85f41243d12ee605e5`. Candidate removes the registry
snapshot and uses the construction's source/gain arrays for rollback.

Measured on Windows with Node 22.18.0 and web-audio-engine 0.13.4:

| Existing independent voices | Baseline microseconds/note | Candidate microseconds/note |
| --- | ---: | ---: |
| 0 | 56.15 | 57.02 |
| 100 | 57.36 | 56.90 |
| 500 | 78.30 | 46.46 |
| 1000 | 152.97 | 43.24 |

Each value is the median of seven samples of 200 `playNote` constructions using
program 0. Both sources run in the same process, alternating measurement order.
Each source/count gets 200 warmup constructions; stop and explicit GC occur
outside measured intervals. Context initialization and audio rendering are
excluded. The test harness seeds only each synth's VM, never process-global RNG.

There is no measured benefit at low polyphony in this run. At 500/1000 voices the
candidate avoids the growing registry-copy cost. These are construction costs in
a JavaScript audio engine, not browser rendering throughput or latency guarantees.

Reproduce with separately checked-out source files:

```sh
node --expose-gc scripts/benchmark-allocations.cjs /path/to/baseline/webaudio-tinysynth.js webaudio-tinysynth.js
```

The script emits all individual samples as JSON lines. Timing is informational;
the regression suite checks allocation rollback and the absence of registry
enumeration without a timing threshold.
