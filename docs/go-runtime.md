# Takeon Go runtime (v0.1, builds on the determinism spike)

Module: `go/` (`github.com/Signal-K/takeon-go`). Facade for hosts: `go/mobile` (gobind-safe). Spike findings (FMA, sin/cos, hypot) live in `go-core-spike.md`.

## What it does
- Deterministic RNG / noise / terrain / rover drive+drill / weather / tick, bit-identical to the TS engine (golden vectors).
- **Mission hooks** (`go/module.go`): port of `module/state.ts` (explore, returnToBase, reset, deriveMissionProgress, serialize, tolerant parse incl. v1 migration). JSON output is byte-identical to TS.
- **Easy mining** (`go/runtime.go`): `OrderMine(x,y)` / `Order("mine", x|y<<16)` plans a climb-limited BFS route to a tile adjacent to the target, faces it and drills until level with the rover's ground; progress/fail events (`mineOrder: done | failed:no-route|cargo-full|battery|...`). Runs inside `Tick`, inert when unused, so sim parity is untouched.
- **Mission wiring**: entering a new tile explores it (+1 held data); each mined deposit gives held samples; `Bank` (within 2 tiles of landing) banks yield; `missionComplete` event. Yield amounts are a Go-runtime convention (the TS module leaves yield to the host), so they are tested for determinism and snapshot round-trip but not TS parity.
- Snapshot now also carries mission state; restore + continue is identical to uninterrupted.

## Build
`go/scripts/build.sh [test|wasm|ios|android|all]` -> `go/dist/` (gitignored):
- `Takeon.xcframework` (ios-arm64, ios simulator arm64+x86_64, macOS arm64+x86_64), ~31 MB
- `takeon.aar` (arm64-v8a, armeabi-v7a, x86, x86_64; package `com.signalk.takeon`), ~7.8 MB
- `takeon.wasm` + `wasm_exec.js` (`globalThis.takeon.{new,step,order,orderMine,bank,state,mission,snapshot,restore}`), ~3.5 MB

Prereqs: Go 1.25, Xcode, `go get -tool` gobind/gomobile (recorded in go.mod; run `go tool gomobile init` once), Android: `ANDROID_HOME`, `ANDROID_NDK_HOME` (NDK 27.2.12479018 verified), JDK 17.

## Regenerating golden vectors
```
npx -y esbuild packages/engine/scripts/golden.ts --bundle --platform=node --format=esm --outfile=/tmp/g.mjs && node /tmp/g.mjs golden
npx -y esbuild packages/engine/scripts/golden-module.ts --bundle --platform=node --format=esm --outfile=/tmp/gm.mjs && node /tmp/gm.mjs golden
cd go && go test -count=1 -v .     # prints the parity table
```

## Swift binding plan (TakeonKit; NOT wired yet)
1. Ship `Takeon.xcframework` as a SwiftPM `.binaryTarget` (local path in dev, release asset + checksum in CI) inside `native/TakeonKit/Package.swift`; gomobile emits ObjC (`MobileEngine`, imported as Swift `MobileEngine`).
2. Add `GoTakeonEngine: TakeonEngine` next to `NullTakeonEngine`: `loadWorld(TakeonWorldSeed)` -> `MobileNewEngine(Int64(seed), bodyId)`; map `targetId` -> body id via a table; `step(dt)` -> `engine.step(dt, &err)` then decode the events JSON into `TakeonEvent` (depositMined/structureBuilt/missionObjectiveMet from `depositMined`/`missionComplete`; extra events ignored or added to the enum); `snapshot()/restore()` pass the opaque `Data`.
3. Extend the protocol additively: `orderMine(x:y:)`, `bank()`, `missionProgress() -> Decodable`, `state()` for the renderer; keep `NullTakeonEngine` default so Landnam is unchanged until wiring.
4. Seed: protocol uses UInt64; Go takes int64 and truncates seed via `int32` in places (mirrors TS bit ops) - clamp seeds to 32 bits at the binding.
5. Threading: engine is not goroutine-safe; wrap in a Swift actor, step from a 10 Hz timer (or per frame with accumulated dt - the engine accumulates fractions).
6. Tests: XCTest running the same scripted run vs fixture JSON; CI builds xcframework on macOS runner. Do this only after Liam approves wiring into Landnam native.
7. Android mirror: Kotlin wrapper over `com.signalk.takeon.mobile.Engine` from the aar.

## Still missing
Structures/power/launch/habitat, crafting, scan, photo, build orders (return `ErrUnsupported`), blue noise, ore bands, DEM sampling (DEM data empty in this repo anyway), runtime body registry/authoring, a Go-side FMA lint, CI matrix, TS `orderMine` autopilot parity (route/behaviour differs from the renderer-coupled TS one), on-device test of the xcframework/aar (builds only), seed-width clamp.
