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

### @takeon/engine — engine structure

- **Scene layer** (`scene/`): `buildScene(sim)` flattens a running mission into
  renderer-agnostic entities (position, height, facing, variant, flags), so a
  host can draw TakeOn with its own technology. Enforced in the layering test.
- **View abstraction** (`render/view.ts`): `SceneView` — draw, pick, resize,
  rotate, photo, minimap — implemented by the isometric renderer and by a new
  **`FlatRenderer`**: a top-down 2D map with hillshading, contour shading, grid,
  scanner reach, home pin and entity glyphs, rasterised once per world change.
  `RoverGame.setView('iso' | 'flat')` / `toggleView()` switch at runtime on a
  shared camera; `startView` picks the initial one.
- **Entity parts**: the rover moved to `render/rover.ts` and is now assembled
  from registered parts (`registerRoverPart`, `listRoverParts`) with
  build/state conditions, plus new detail — cargo crates that stack with the
  hold, a charge LED strip, hull scorch and sparks, a status strobe, drilling
  chips, a sweeping dish, a pulsing scanner tip, solar glint and RTG heat glow.
  The 2D view has a painter registry per entity kind (`registerFlatPainter`).
- **Noise library** (`util/noise/`): Perlin, simplex, Worley (F1 / F2−F1 /
  cells), white, and blue noise (void-and-cluster mask, Poisson-disk sampling,
  `scatterPoints`); `fbm`/`ridged`/`billow` fractals, domain warp, and a
  `NoiseConfig` + `makeNoise` factory. Bodies opt in via `terrain.noise`;
  without it the shipped worlds regenerate byte-for-byte.
- `Simulation.landingSite`, `BodyField.defaultValue` (so inspectors show the
  effective default instead of 0), and a `viewChanged` game event.

### @takeon/ui — visual direction

- New default skin: a pulp sci-fi homage (Out There: Ω). Hex cells for the
  action bank and drive pad, notched panel frames with hairline neon edges,
  segmented resource gauges, uppercase condensed type, comic-caption toasts and
  a scene vignette. Pure CSS — no web fonts, no images, nothing fetched.
- `Meter` gained `tone`, `Modal` gained a title bar with a close control, and
  `Chip` gained `tone`; all still overridable through the registry, and the
  whole palette is `--tk-*` variables.
- View toggle in the HUD bar; `hud.view`, `actions.setView`/`toggleView` and a
  `view` prop on `MissionProvider`.
- `ActionBar` decluttered: only capability-gated, frequent verbs (mine, photo,
  scan) sit on the hotbar. Occasional actions (build, craft, place, repair,
  deposit, hold) collapse behind a single "More" hex that opens `.tk-tray`, a
  pop-up list that closes itself on selection, outside click or Escape. New
  `ActionItem.menu` flag controls the split for custom action sets.

### @takeon/editor (new)

- `TakeOnEditor`: mountable world editor — project tree of built-ins and
  drafts, schema-generated inspector with live validation, isometric scene
  view with camera controls and a day/night scrub, elevation / slope /
  surface / ore / drivability maps, raw noise preview, vertical cross-section,
  terrain analysis, rover picker, undo/redo, JSON/TS import-export and an
  in-editor play mode wired to the real HUD. See `docs/EDITOR.md`.
- Layout is one grid of uniform cards (scene 2×2, everything else the same
  footprint, each scrolling internally) instead of sidebars, so panels stay in
  line at every width. Chrome is light by default with a dark toggle
  (remembered); the scene stays dark either way.
- Scene card switches between the 3D diorama and the 2D map; the inspector
  gained a *Noise field* group; Maps gained a live preview of the body's actual
  noise field and a blue-noise **Scatter** preview.

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
