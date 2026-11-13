# Shared Go runtime migration (SSL-778)

## Audit and boundary

The runtime promotion and package boundary are SSL-835. Full simulation parity,
existing API replacement and mobile ownership are SSL-836, SSL-837 and SSL-838.
This is a migration in progress: the TypeScript default must remain available
until the unsupported behavior below is implemented and verified.

| Piece | Owns today | Intended ownership |
| --- | --- | --- |
| `packages/engine/src/sim`, `world`, `parts` | Full TypeScript simulation, structures, recipes, procedural worlds, registries and derived parts | Go owns gameplay rules, deterministic world generation, parts/stat derivation, stepping, commands, snapshots and restore |
| `go/` | Existing deterministic terrain/rover/weather core plus mission hooks, easy-mining, terrain windows and seeded cargo drop-off | Canonical portable runtime, expanded under SSL-836 |
| `packages/engine/src/core/game.ts` | Browser loop, input, render scheduling and renderer-coupled autopilot | Host loop/input/rendering stay TS; simulation and autopilot rules move to Go |
| `packages/pixi-adapter` | Hosts the engine canvas as a Pixi texture and maps input | Remains a renderer/host adapter, consumes the Go-backed engine after SSL-837 |
| Landnam `native/TakeonKit` | Swift protocol, JSON models and `GoTakeonEngine`, already calling gomobile `MobileEngine` | Portable bindings move here under SSL-838; game target aliases remain in Landnam |
| `go/android` | Kotlin facade over gomobile AAR | Same core revision as web/Node/Swift; Android runtime verification remains required |
| Landnam `web/lib/takeon` | Target/resource/event mapping, sync/persistence and an optional separate WASM loader | Game mappings stay in Landnam; remove the parallel loader after the package replacement |

The ticket's claim of a separate native Swift simulation is outdated. The native
package already wraps the `orbit/go-runtime` Go implementation; `NullTakeonEngine`
is a placeholder, not a second implementation of its gameplay rules.

Rendering, cameras, UI, input, audio, network/auth, offline persistence and
Landnam-specific progression are outside the Go core. Declarative bodies, parts,
materials, biomes and missions cross the boundary as validated data; embedding
app-specific identifiers or UI behavior in the core is not part of this design.

## Source provenance

The current production branch contained the determinism spike. The mission,
mining, terrain-window and drop-off runtime, mobile facade, Kotlin wrapper and
mission golden vectors are promoted from `orbit/go-runtime` at
`bcf79f93c5c73e4175dbb7cb81a9653a88272c9d`, with the new JSON boundary and package
loader added on top. Historical math/parity details remain in
[go-core-spike.md](go-core-spike.md).

The existing body/part JSON and golden vectors were generated from the historical
TypeScript baseline. Passing those vectors does not establish parity with all
current TypeScript extensions or Landnam's vendored 0.2.3. Regenerating vectors
must be reviewed as a behavior change, never used to hide a mismatch.

## Contract and capabilities

`go/bridge.Session` exposes protocol version 1 as JSON requests/responses. Each
`create` allocates an independent game. `dispose` releases it; IDs are not reused.
Errors are explicit responses and failed restores leave the live game intact.
The WASM target exposes only `globalThis.takeonCore(requestJSON)`; it does not
replace the older optional `globalThis.takeon` loader protocol.

`takeon.Capabilities()` and mobile `CapabilitiesJSON()` describe the same core.
Available operations include create, fixed-step advance, move/drill/mine/cancel,
mission progress, terrain window, snapshot/restore, seedCache, seedCargo, deposit,
and bank. The snapshot format is `takeon-go/v1`, not TS `MissionState`.

Known gaps: structures/power/drill rigs/launch/habitats, build/scan/photo/craft,
mobility upgrades, place/repair, runtime custom-world registries, blue noise, ore
bands, DEM sampling and the existing synchronous `Simulation`/render projection
API. Go's mission yield and autopilot conventions also differ from the current
host's conventions. **Do not enable Go as Landnam's default until these are
covered and the existing API adapter is verified.**

## Web and Node package entry

`@takeon/engine/go` is additive. Existing `@takeon/engine` and `@takeon/pixi` entry
points are unchanged; they still use TypeScript simulation in this slice.

Build the package with Go >= 1.26 and the usual npm dependencies:

```sh
npm ci --ignore-scripts --workspace @takeon/engine --workspace @takeon/pixi
npm run build:go -w @takeon/engine
node scripts/check-go-package.mjs
```

`build:go` builds the WASM and copies its matching toolchain's `wasm_exec.js` into
`dist/go`, then compiles TypeScript. `prepack` runs it too, so published archives
cannot silently omit the exported runtime assets. Both assets must be deployed
together. A failed Go build stops packaging; shim copying cannot mask that error.

Node:

```js
import { readFile } from 'node:fs/promises';
import { loadGoCore } from '@takeon/engine/go';
const core = await loadGoCore({
  wasmBytes: await readFile(new URL(import.meta.resolve('@takeon/engine/go/takeon.wasm'))),
});
const game = core.createEngine(4212, 'moon');
game.step(0.1);
const snapshot = game.snapshot();
game.restore(snapshot);
game.dispose();
```

Browser (serve the paired assets on your static origin):

```js
import { loadGoCore } from '@takeon/engine/go';
const core = await loadGoCore({
  wasmURL: '/takeon/takeon.wasm',
  wasmExecURL: '/takeon/wasm_exec.js',
});
const game = core.createEngine(4212, 'moon');
const terrain = game.window(0, 0, 16, 16);
```

The loader starts one VM and supports many games inside it. Load failures are
retryable. Seeds must be safe integers and are reduced to uint32. `step` accepts
0–60 seconds; hosts should advance normal frame deltas rather than long elapsed
time in one call. Unsupported commands throw; callers must inspect capabilities
instead of assuming full API compatibility. Go snapshots are trusted engine data,
not an interchange format for arbitrary external JSON.

## Mobile builds and remaining gates

`go/scripts/build.sh ios` / `android` use the pinned `go tool gomobile` dependency.
Xcode is required for Apple artifacts; Android SDK, NDK and JDK are required for
Android. The promoted Kotlin wrapper is existing source, not newly verified
Android functionality. Portable Swift binding ownership and one revision-pinned
artifact manifest across all platforms remain SSL-838; they are not completed by
building WASM.

Before default replacement: close SSL-836 parity gaps, implement SSL-837's public
API compatibility adapter, verify real Landnam scenes and saves, and build/run
Swift and Kotlin artifacts on supported SDKs. Keep SSL-778 In Progress until
those outcomes are complete.
