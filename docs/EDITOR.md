# The TakeOn editor

A minimal, Unity/Godot-shaped authoring tool for TakeOn worlds: project tree,
scene view, inspector, analysis instruments and a play button. It exists so
terrain, noise and map work can be *planned* — tuned against real numbers and
driven immediately — instead of guessed at in `bodies.ts` and rebuilt.

It ships as `@takeon/editor`, a single React component with no routing of its
own, so it runs in this repo's Next.js app, inside a game built on TakeOn
(Landnam), or in a desktop window.

```
┌───────────── toolbar: ▶ Play · undo/redo · seed · climb limit · JSON/TS ─────────────┐
│ Destinations │            Scene view (real iso renderer)            │  Inspector     │
│  built-ins   │  drag to pan · wheel zoom · R rotate · ☀ time scrub  │  (schema-      │
│  + drafts    ├─────────────────────────────────────────────────────┤   generated)   │
│              │            Events console (play mode)                │  Maps/Analysis │
└──────────────┴─────────────────────────────────────────────────────┴────────────────┘
```

## Running it

**In the browser** (also how you run it on a Mac):

```bash
npm install && npm run build
npm run dev                     # http://localhost:3400/editor
```

**As a desktop app** (macOS, Windows, Linux) — optional Electron shell, kept
out of the workspace so nobody downloads Electron who doesn't want it:

```bash
npm run build && npm run start -w takeon-web    # serve the app
cd desktop && npm install && npm start          # opens the editor window
```

Point it elsewhere with `TAKEON_EDITOR_URL=https://your-host/editor`.

**Inside your own game:**

```tsx
import { TakeOnEditor } from '@takeon/editor';
import '@takeon/ui/styles.css';
import '@takeon/editor/styles.css';

<TakeOnEditor
  bodies={worldsFromMyBackend}            // edit rows from your DB too
  onChange={(project) => save(project)}   // persist wherever you like
/>;
```

## What each panel is for

### Destinations (project tree)

Every shipped destination plus this project's drafts. Editing a built-in
creates a draft that *shadows* it (badge: `edited`); **Discard** removes the
draft and restores the shipped definition. **+ New** starts a validated blank
world, **Copy** forks the selection.

Drafts are published to the engine's runtime body registry as you edit
(`registerBody`), so `getBody('mars')` — in play mode, on `/launch`, anywhere in
the host app — resolves *your* Mars. Pass `publish={false}` to keep the editor
sandboxed.

### Inspector

Generated from the engine's field schema (`BODY_FIELDS` in
`world/authoring.ts`), grouped into Identity / Physics / World / Terrain /
Mineralogy / Weather / Palette. Fields marked `↻` feed generation, so changing
them rebuilds the world (debounced ~180 ms).

Validation runs on every keystroke: errors (which would break generation) block
play mode, warnings ("roughness above 0.9 leaves few drivable routes") don't.
Adding a new `BodyDef` property means describing it in the engine schema — the
inspector picks it up with no editor change. Hosts can append their own fields
via `extraFields`.

### Scene view

The real `IsoRenderer` drawing the real generated world, with the simulation
paused: nothing moves and no battery drains, so what you see is purely the
authored terrain. Drag to pan, wheel to zoom, `R` rotates 90°, `F` frames the
landing site, and the ☀ slider scrubs the day/night cycle to check lighting.

### Maps (terrain planning instruments)

One pixel per column, sampled from the same world the game will run:

| View | Answers |
|---|---|
| **Elevation** | Where the relief actually is; does the seed give you basins and ridges or mush |
| **Slope** | Red is steeper than the climb limit — the cliffs that will block a rover |
| **Surface** | The biome patches (silica flats, dust basins, regolith uplands) the player sees |
| **Ore density** | Ore voxels per column; crystal picked out separately |
| **Drivable** | Flood fill from the landing site — green is reachable, red is stranded terrain |
| **Noise** | The raw fBm field at the generator's own frequency, before craters and clamping |

Click any map to inspect a column (height, surface material, skin biome) and to
move the **cross-section** underneath it, which slices the world vertically with
the real material palette — the fastest way to see how ore veins and ice bands
are actually layered.

The climb limit used by Slope and Drivable is the toolbar's `climb ≤ n`; set it
to the drivetrain you're designing for (rocker-bogie 2, tracks 3).

### Analysis

The numbers behind the map: relief range, mean height, cliff fraction, drivable
percentage, height histogram, surface mix and total recoverable resources.
"92% drivable, 4% cliffs, 51k stone" is a design spec; "looks about right" is
not.

### Rover

The rover play mode uses — part dropdowns with the derived climb, speed, move
cost and cargo numbers, plus a warning when the build can't actually reach this
destination's delta-v. Mechanics work is mostly "does this drivetrain cope with
this terrain", so it sits next to the terrain controls.

### Play mode

▶ Play boots a real mission on the edited world using the full HUD from
`@takeon/ui` — the same components the shipped game uses. Every engine event
lands in the events console (`tick` and `stateChanged` filtered out), so you can
watch `mined`, `damaged`, `blocked` and `weather` fire as you drive. ■ Stop
returns to the scene view.

## Getting a world out of the editor

- **⧉ JSON** copies the `BodyDef` — paste it into `pocketbase/seed/bodies.json`,
  your own backend, or another project.
- **⧉ TS** copies a TypeScript literal ready to paste into
  `packages/engine/src/world/bodies.ts`, key order matching the built-ins.
- **⭳** downloads the JSON; **⭱ Import** parses a pasted `BodyDef` (missing
  fields fall back to draft defaults, problems are listed rather than thrown).

Projects persist to `localStorage` (`takeon.editor.v1`) by default. Pass
`storage={null}` for an in-memory session, or use `onChange` to persist
wherever you like.

## Extending it

Panels are registered through `@takeon/ui`'s slot registry, so a host can
replace any of them:

```tsx
<TakeOnEditor
  ui={{
    components: { EditorAnalysisPanel: MyAnalysisPanel },
    theme: { accent: '#ff8a3d' },
  }}
/>
```

Slot keys: `EditorToolbar`, `EditorBodyBrowser`, `EditorInspector`,
`EditorViewport`, `EditorMapsPanel`, `EditorAnalysisPanel`, `EditorRoverPanel`,
`EditorConsolePanel` (exported as `EDITOR_SLOT_KEYS`). The mission HUD inside
play mode uses the same mechanism — see [UI.md](UI.md).

The pieces are exported individually too (`useEditorState`, `useEditorSim`,
`paintMap`, `Inspector`, …), so you can build a different tool — a terrain
browser, a QA harness — out of the same parts.

## The engine APIs behind it

Nothing in the editor is privileged; it is built on public engine exports you
can use directly:

```ts
import {
  createBodyDraft, validateBody, BODY_FIELDS, setBodyField,  // authoring
  registerBody, listBodies,                                   // runtime catalog
  generateTerrain, analyzeTerrain, heightField, slopeField,   // measurement
  reachableMask, crossSection,
  bodyToJson, bodyToTypeScript, parseBodyJson,                // import/export
} from '@takeon/engine';

const world = generateTerrain(createBodyDraft({ id: 'test', size: 64 }));
const stats = analyzeTerrain(world, { maxClimb: 2 });
console.log(stats.traversable.reachableFraction, stats.slope.steepFraction);
```

All of it is pure and DOM-free, so terrain rules can be asserted in CI:
`packages/engine/test/authoring.test.ts` does exactly that.
