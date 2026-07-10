# Changelog

`@takeon/engine` and `@takeon/pixi` are versioned **in lockstep** and released
by tagging: pushing a `v*` tag (e.g. `v0.2.0`) runs the CI publish job, which
builds, tests, and publishes any package whose version isn't already on
npmjs.org. Bump both `package.json` versions + add an entry here in the same
change. Semver: breaking engine/adapter API → major (minor while pre-1.0),
additive → minor, fixes → patch.

## 0.2.0 — first published release

### @takeon/engine

- The full game as a zero-runtime-dependency library: deterministic 10 Hz
  simulation (drive/mine/scan/photo/build/craft/repair, weather, anomalies),
  procedurally generated voxel worlds from `(BodyDef, seed)`, smoothed
  isometric Canvas 2D renderer with adaptive resolution, parts catalogue +
  customiser maths, cargo-launch rockets, in-field mobility upgrades, outpost
  automation (power grid, self-shipping pads, habitats), ambient life,
  synthesised audio (`GameAudio`), the `SyncAdapter` persistence boundary
  (`LocalSync`, `PocketBaseSync`), and the offline-first objective module
  (`createWorldState` / `deriveMissionProgress`).
- Save format carries `MISSION_SCHEMA_VERSION`; legacy saves resume cleanly.

### @takeon/pixi

- `mountRoverGame` — embed a mission in a PixiJS scene (v7 or v8) via
  structural typings. `pixi.js` is declared as an **optional** peer: the
  adapter never imports it (hosts pass the namespace in), so plain-canvas
  hosts aren't forced to install Pixi.

## 0.1.0

Internal workspace-only version; never published.
