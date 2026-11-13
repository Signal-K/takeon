# Takeon shared Go core (SSL-778)

## Ownership and audit

The canonical runtime is `go/`: world generation, rover/part stats, commands,
fixed-step simulation, weather, mining, structures/power/outposts, crafting,
upgrades, scan/photo, mission objectives, and snapshots. There is no TypeScript
simulation ticking alongside it.

| Host piece | Responsibility |
| --- | --- |
| `packages/engine/src/sim/simulation.ts` | Existing synchronous API and mutable render projection over Go; preserves rover/structure/anomaly references |
| `packages/engine/src/world` and `parts` | Resolve host-authored registries to data; delegate generation, biome selection, anomalies and stats to Go; retain read-only authoring/render queries |
| `packages/engine/src/core`, `render`, `input`, `audio` | Browser frame loop, presentation interpolation, cameras, input/order planning, Canvas and audio |
| `packages/pixi-adapter` | Host the same engine canvas as a Pixi texture; no simulation implementation |
| `swift/Sources/TakeonCore` | Portable Swift protocol, models and gomobile binding |
| `go/android` | Kotlin binding over the AAR built from the same `go/mobile` |
| Landnam `native/TakeonKit` | Compatibility re-export and Landnam target aliases only |
| Landnam `web/lib/takeon` | Target/material mapping and offline persistence; the separate optional WASM loader is removed |

The audit corrected SSL-778's premise: Landnam's native package already wrapped
Go, rather than implementing a Swift simulation. Its portable bindings now live
in Takeon. The production branch had the older determinism spike; the newer
mission/mining/drop-off runtime was promoted from `orbit/go-runtime` at
`bcf79f93c5c73e4175dbb7cb81a9653a88272c9d` before completing the missing rules.

Rendering, authored layer-extension data, input planning, audio, authentication,
network persistence and game-specific progression remain host-owned. Host
callbacks never execute inside Go; resolved bodies, parts, materials, biomes,
recipes and structure catalogs cross as data. Pure noise/geometry helpers kept
for host presentation and authoring are not an alternate simulation.

## Shared content

`go/data/{bodies,parts,materials,biomes,rules}.json` are canonical. The package
build embeds them in Go and generates its TypeScript catalog module from the
same files. Do not edit generated `src/data/core-catalog.ts` or
`src/go/artifacts.ts`; both are ignored build products.

Core commands cover construction, rotation/demolition, refining, solar/generator
power and pylons, automated drills, launch pads, habitat construction/service,
mobility upgrades, repair, block placement, scanning and photos. Generation
supports authored noise including blue noise, ore bands, DEM patches, custom
materials and host-resolved biome/kind registries. The generic objective module
also delegates its transitions to Go.

## Package API and build

`@takeon/engine` and `@takeon/pixi` retain their existing entry points and renderer
APIs. Rover specs remain optional at the game/Pixi boundary. Importing the
package does not start Go during SSR; the first core operation initializes the
embedded, synchronously compiled WASM once, preserving the synchronous API.
There are no per-tick network reads or background polling.

```sh
npm ci --ignore-scripts --workspace @takeon/engine --workspace @takeon/pixi
npm run build -w @takeon/engine
npm run build -w @takeon/pixi
node scripts/check-go-package.mjs
```

Go >= 1.26, Node/npm and `shasum` are required. `prepack` builds the core, matching
Go toolchain shim, generated catalogs and package output. Failed compilation
stops packaging. The default engine embeds the paired artifacts to preserve the
synchronous API; the additive `@takeon/engine/go` entry can load standalone
artifacts asynchronously for headless or custom hosts.

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

Browser custom hosts may instead provide `wasmURL` and `wasmExecURL` pointing to
the paired static artifacts. One VM can own multiple isolated games. Dispose
releases a handle; the Simulation wrapper also registers a GC fallback. Loader
failures are retryable. Seeds are reduced to uint32. `step` takes finite 0–60
second deltas. Structured commands such as build/craft use `command(kind, text)`;
integer orders remain available for movement and existing mobile callers.

`coreCapabilities()` (default entry), `core.capabilities` (async entry), and
mobile `CapabilitiesJSON()` report protocol version, supported operations and
`sourceHash`. The build script embeds the same deterministic digest of canonical
runtime source/content into WASM, xcframework and AAR builds. The package smoke
check compares the default and async entries' digests.

## Persistence and compatibility

New `MissionState` saves keep the existing host fields and add `coreSnapshot`.
That opaque Go v1 continuation includes weather RNG, drill timers, upgrades,
structures and resolved content. Legacy saves without it resume through the
existing host projection; rejected optional snapshots fall back to that path.
Failed direct core restores are atomic and leave the live game unchanged.

Landnam writes the UTF-8 Go JSON to the existing `voxel_worlds.snapshot` field as
base64, matching native's established wire format. Web reads that field too.
No new collection or destructive data migration is introduced. Newly generated
photo/structure IDs are deterministic and the ID counter survives snapshots;
existing saved IDs remain intact. Resource traversal uses stable ordering so a
nearly full cargo hold cannot depend on Go map iteration order.

## Swift and Kotlin

The root `Package.swift` exposes `TakeonCore`. Build its binary first:

```sh
go/scripts/build.sh ios
# Shared package uses go/dist/Takeon.xcframework.
```

Landnam's shim prefers a sibling Takeon checkout when present; otherwise it uses
a pinned source revision. Set `TAKEON_PACKAGE_PATH` to choose a local checkout.
Its sync script builds that checkout's core, replacing the retired release
fetch. Without a framework the explicit unavailable-runtime adapter is retained.
Kotlin uses `go/scripts/build.sh android` and the existing Android wrapper project.
Both mobile targets bind `go/mobile`, not copied gameplay logic. Custom content
can be supplied through `ConfigureJSON` / `configureJSON`.

Apple builds require Xcode; Android requires SDK/NDK/JDK. The user explicitly
waived native build/runtime verification for SSL-778. Source migration and build
wiring are included; no claim of new xcframework/AAR build or device testing is
made. Rebuild mobile artifacts from the pinned checkout before shipping native.

## Verification fixtures

Historical math/terrain/rover/mission vectors remain unchanged. New
`golden/expanded.json` and `golden/world-extensions.json` were captured from the
pre-migration TypeScript engine at `prod/main` (`1a8ced2`) before removing its
simulation implementation. They cover construction, crafting, upgrades, repair,
placement, scan/photo, shipping, powered drills, habitats, ore bands, custom
biomes, DEM and blue masks. Reproducible capture scripts accept an explicit
pre-migration compiled oracle; do not regenerate expected values from Go to hide
a mismatch. Old determinism findings are in [go-core-spike.md](go-core-spike.md).
