# Go core spike: v0 determinism parity

Question: can a Go port reproduce the TS engine **bit-for-bit** where determinism is decided, so one small core can serve gomobile (iOS/Android) and WASM?

Answer: **yes for everything covered below (0 mismatches in ~330k comparisons)**. Reproduce with:

```
npx -y esbuild packages/engine/scripts/golden.ts --bundle --platform=node --format=esm --outfile=/tmp/takeon-golden.mjs
node /tmp/takeon-golden.mjs golden      # run from the repo root; writes golden/*.json and go/data/*.json
cd go && go test -v ./...               # prints the summary table
```

Golden vectors come from Node v26.8 / V8 on Apple Silicon (arm64). No engine source was changed; only `packages/engine/scripts/golden.ts` was added.

## Results

| vector set | count | exact | max abs err |
|---|---:|---:|---|
| mulberry32 (5 seeds x 1000) | 5000 | 5000 | 0 |
| hash2 / hash3 (incl. negative, > 2^32, > 2^53 products) | 1428 / 1428 | all | 0 |
| value, fbm, worley f1/f2f1/cells (3 seeds x 600 pts each) | 1764 each | all | 0 |
| perlin, simplex | 1764 each | all | 0 |
| makeNoise (ridged, billow+warp, cracks, default) | 800 each | all | 0 |
| Math.hypot (V8 algorithm) | 2000 | 2000 | 0 |
| Math.sin / Math.cos (ported fdlibm, FMA flavour) | 5000 each | all | 0 |
| terrain: chunk voxel hashes (5 bodies x 3 seeds) | 630 | 630 | 0 |
| terrain: column heights / surface materials | 157,632 each | all | 0 |
| landing site; anomaly lists (15 body x seed) | 15 each | all | 0 |
| scripted run: 100 ticks, move + drill, 4 bodies, snapshot every 10 | 264 float + 308 exact fields | all | 0 |
| long run: 2400 ticks incl. dust-devil / meteor-shower / solar-storm / cryo-fog | 216 float + 72 exact | all | 0 |
| derived rover stats | 4 | 4 | 0 |
| snapshot -> restore -> continue == uninterrupted | 3 | 3 | 0 |

Also green: `GOARCH=amd64 go test` (Rosetta) and `GOOS=js GOARCH=wasm go test` (run in Node). Same results on all three, so the Go side is host-independent.

## Where Go and JS differ (all handled)

1. **Fused multiply-add.** Go may compile `a*b+c` to FMA on arm64, *including across statements*. This produced real mismatches while porting (simplex: up to 68 ulp; warp: 32 ulp) until every product that feeds a sum was wrapped in `float64(...)`. Rule for the codebase: every product that is later added/subtracted gets an explicit `float64()`. A lint or review checklist is needed; golden tests catch violations on arm64 only for covered paths.
2. **Math.sin/cos.** Go's `math.Sin/Cos` differ from V8 in the last ulp for ~23% / ~28% of random angles in [0, 2pi]. Ported V8's fdlibm (`go/fdlibm.go`): 5000/5000 exact. A plain (non-fused) port still differed in ~0.6% of inputs, because **Node's V8 on arm64 is built with compiler-contracted FMAs in its fdlibm**. `TrigFMA=true` reproduces that build (variants of the contraction differ per inlining site; found empirically). `TrigFMA=false` gives the non-fused x86-64-style result. Implication: *the TS engine itself is not bit-identical across JS engines/builds for sin/cos* (JavaScriptCore on iOS uses system libm). Shipped bodies' terrain does not use sin/cos (only perlin/simplex configs do); the sim uses them for weather angles only. A Go core makes this deterministic by construction; `TrigFMA` should be fixed to one value and the TS side treated as the approximate one.
3. **Math.hypot.** V8 uses a scaled Kahan algorithm; `math.Hypot` and `sqrt(x*x+y*y)` mismatch 4% / 37% of samples. Ported exactly (2000/2000).
4. **Int semantics.** `Math.imul`, `>>> 0`, `x * 374761393` truncated by `^` (ToInt32, even beyond 2^53), `Math.round` (half up, not banker's) are reproduced.
5. **Weather rates ordering.** JS object insertion order drives which weather rolls first (and each roll consumes RNG); the Go port parses `weather` as an ordered list, not a map.
6. **Resume fidelity.** TS `resume` reseeds the weather RNG, so a restored mission diverges from an uninterrupted one. The Go snapshot stores the single-uint32 RNG state plus cooldown/timers, and restore-then-continue is bit-identical (tested mid-meteor-shower).

## What is ported, stubbed, missing

Ported: rng/hashes, value/fbm/perlin/simplex/worley, fractal + `makeNoise` (incl. warp), terrain generation (craters, irregular silhouettes, ice caps, sulfur, ore veins, chunk biomes + climate), landing site, anomalies, rover stats from the part catalog, move/drill/tick, charging and day/night, all weather types, snapshot/restore. Body and part catalogs are embedded from JSON dumped out of the TS source (single-sourced).

Stubbed (return `ErrUnsupported`, covered by a test): `build`, `scan`, `photo`, `craft`, `launch`, `deposit` orders; blue noise; ore `bands` (no shipped body uses them).
Not ported: structures (power grid, drill rigs, launch pads, habitats), recipes, mobility upgrades, photos, placeBlock/repair, runtime body/biome/kind registries, authoring, DEM sampling. **Caveat:** `dem/generated.ts` is empty in this commit, so Mars/Moon use the procedural fallback in TS and Go alike. When real DEM patches land, `sampleDem` (15 lines) and the data must be ported and golden-covered.

Coverage gaps in the golden set: terrain with `terrain.noise` set is covered through `makeNoise` vectors but not end-to-end; no golden run exercises structures.

## API (Landnam TakeonKit mapping)

`go/game.go`: `NewGame(seed, bodyID)`, `LoadWorld`, `Order("move"|"drill", arg)`, `Tick()`, `Step(dt) -> events JSON`, `Snapshot() []byte`, `Restore([]byte)`, `State()`. `go/mobile` is the gobind-safe facade (`Engine`) mirroring `TakeonEngine.loadWorld/step/snapshot/restore`.

## Build targets

- `GOOS=js GOARCH=wasm go build` and `go test`: OK.
- `GOOS=ios GOARCH=arm64` (cgo, iphoneos SDK) and `GOOS=android GOARCH=arm64`: build OK.
- `gomobile bind -target ios ./mobile`: OK, 18 MB xcframework (device + simulator slices), generates `MobileEngine` ObjC/Swift API. Binding the root package directly crashes gobind (an exported struct method with an unsupported signature), hence the `mobile` facade.
- `gomobile bind -target android`: not run, no Android SDK/NDK on this machine.

## Performance (arm64, single thread)

Terra (128x128x16) world generation: Go 13.7 ms vs Node 18.4 ms. One sim tick: ~43 ns.

## Effort for full parity

Remaining TS surface is roughly 600 lines of `simulation.ts` (structures, power, launch, habitat, crafting, scan/photo, upgrades), `structures.ts`/`recipes.ts` (~180), blue noise (230) and DEM sampling, plus extending the golden script (scripted runs with builds/crafts) which is the real cost. Estimate: **2-3 engineer-weeks** for sim parity with golden coverage, **+1 week** for Swift/Kotlin glue, CI (arm64 + amd64 + wasm test matrix), and an FMA-safety lint. Custom bodies/authoring registries can stay host-side (JSON in, `Body` struct out).

## Recommendation: GO (conditional)

Determinism is achievable and measurably holds across arm64, amd64 and WASM, with only three traps (FMA, trig, hypot), all now understood and tested. Conditions: (1) make Go the canonical sim and treat TS as a golden-checked renderer/consumer, since TS is itself engine-dependent for sin/cos; (2) keep golden vectors in CI on all three targets; (3) pick and freeze `TrigFMA`; (4) port structures next, driven by new golden scripts, before any Landnam content depends on the native core.
