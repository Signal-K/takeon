# Changelog

`@takeon/engine`, `@takeon/pixi`, `@takeon/ui` and `@takeon/editor` are
versioned **in lockstep** and released by tagging: pushing a `v*` tag (e.g. `v0.2.0`) runs the CI publish job, which
builds, tests, and publishes any package whose version isn't already on
npmjs.org. Bump every `package.json` version + add an entry here in the same
change. Semver: breaking engine/adapter API → major (minor while pre-1.0),
additive → minor, fixes → patch.

## Unreleased

### @takeon/engine

- **Runtime body registry** (`world/registry.ts`): `registerBody`,
  `registerBodies`, `unregisterBody`, `listBodies`, `isRegisteredBody`.
  `getBody` now resolves registered bodies first, so an editor draft or a
  backend row can shadow a built-in without patching the catalog.
- **Terrain analysis** (`world/analysis.ts`): `heightField`, `slopeField`,
  `reachableMask`, `crossSection` and `analyzeTerrain` — relief, slope
  distribution, drivable fraction for a given climb limit, surface/material
  mix and total recoverable resources. Pure and DOM-free.
- **Authoring** (`world/authoring.ts`): `createBodyDraft`, `cloneBody`,
  `forkBody`, `validateBody` (errors + playability warnings), the
  `BODY_FIELDS` inspector schema with `getBodyField`/`setBodyField`, and
  `bodyToJson` / `bodyToTypeScript` / `parseBodyJson`.
- `GAME_EVENT_KEYS` lists every event key at runtime (with a compile-time
  exhaustiveness guard) so hosts can subscribe to everything.
- `skinBiome` is exported for tools that need the surface-patch field.

### @takeon/ui (new)

- React mission shell: `MissionProvider` (engine lifecycle, HUD snapshot,
  toasts, autosave, persistence via `SyncAdapter`), `MissionScreen` and the
  full HUD component set, plus `TakeOnMission` for one-line embedding.
- Component registry: every component is registered through `createSlot` and
  resolved via `TakeOnUIProvider`, so a parent app can replace, wrap, restyle
  (`classNames`, `theme`), relabel (`labels`) or extend (`slots`) any part of
  the interface. See `docs/UI.md`.

### @takeon/editor (new)

- `TakeOnEditor`: mountable world editor — project tree of built-ins and
  drafts, schema-generated inspector with live validation, isometric scene
  view with camera controls and a day/night scrub, elevation / slope /
  surface / ore / drivability maps, raw noise preview, vertical cross-section,
  terrain analysis, rover picker, undo/redo, JSON/TS import-export and an
  in-editor play mode wired to the real HUD. See `docs/EDITOR.md`.

### web

- `/editor` route; the mission screen is now a thin host over `@takeon/ui`,
  and destination lists resolve through `listBodies()` so edited worlds are
  immediately launchable.

### desktop (new, not published)

- Optional Electron shell so the editor runs as a macOS/Windows/Linux app.

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
