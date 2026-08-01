# TakeOn as a game engine

TakeOn started as one game and grew into the engine underneath it. This is the
map: what the layers are, which concept owns what, and where to add things.

Everything below is in `packages/engine` unless stated otherwise. The layering
is enforced in CI by `test/layering.test.ts` — lower layers may never import
upward.

```
util ──► world ──► sim ──► scene ──► render ──► input
 │        │         │        │          │
 │        │         │        │          └── iso diorama · flat 2D map · entity parts
 │        │         │        └── renderer-agnostic frame description
 │        │         └── the rules: deterministic, fixed 10 Hz
 │        └── voxels, terrain generation, analysis, authoring
 └── rng · noise (value · perlin · simplex · worley · blue) · events

                    core ──► RoverGame (the facade everything embeds)
        net ──► SyncAdapter          parts ──► catalogue + stats maths
        @takeon/ui ──► React shell   @takeon/editor ──► authoring tool
```

## The concepts

| Concept | Where | What it owns |
|---|---|---|
| **World** | `world/world.ts` | Dense voxel storage, column heights, player edits |
| **Terrain** | `world/terrain.ts` | Deterministic generation from `(BodyDef, seed)` |
| **Simulation** | `sim/simulation.ts` | Every rule: driving, power, mining, weather, structures. Fixed 10 Hz, renderer-free |
| **Scene** | `scene/` | One frame flattened into entities — positions, facings, variants, flags. Pure data |
| **View** | `render/view.ts` | The `SceneView` contract: draw, pick, resize, rotate, photo, minimap |
| **Entity parts** | `render/rover.ts`, `render/flat-painters.ts` | How an entity is *drawn*, as registered components |
| **Game** | `core/game.ts` | `RoverGame`: loop, input, audio, view switching, save |
| **Authoring** | `world/authoring.ts`, `world/analysis.ts`, `world/registry.ts` | Drafts, validation, the inspector schema, terrain measurement, the runtime catalogue |

The rule that keeps this honest: **gameplay lives in `sim/` and `parts/`**.
Views and UI observe state and call actions; they never decide outcomes. A game
that replaces every pixel of the presentation still plays identical missions.

## Scenes, in 2D and 3D

A scene is the renderer-agnostic description of a frame:

```ts
const scene = game.scene();
// { id, name, view, size, time, daylight, home, entities: [
//   { id: 'rover', kind: 'rover', pos: {x, y}, z, facing, data: {...}, ref },
//   { id: 'st_3', kind: 'structure', variant: 'refinery', data: { powered: true } },
// ] }
```

Two views ship, and both draw the same world:

- **`iso`** — the isometric voxel diorama: smoothed surfaces, cliffs, strata,
  ambient life. The default, and what "3D" means here (2.5D projection over
  Canvas 2D — there is no GL dependency).
- **`flat`** — the top-down 2D map: hillshaded heightfield, grid, contour
  shading, entity glyphs, scanner reach and the home pin. Rasterised once per
  world change, so a frame is one scaled blit plus entities.

```ts
game.setView('flat');   // or game.toggleView()
game.view;              // 'flat'
game.camera;            // shared by both views — switching keeps your place
```

In the game, the HUD's `⬔ / ▦` button toggles them. In the editor, the scene
card's `3D / 2D` button does. Some screens simply read better flat — route
planning, outpost layout, ore surveying — and a UI-heavy scene in a game built
on TakeOn may want no diorama at all.

To add a third view (WebGL, Pixi, SVG…), implement `SceneView` and draw from
`buildScene(sim)`; nothing else needs to know.

## Entities are assembled from parts

The rover is not one painter — it is a list of registered parts, each with a
condition, an order and whether it rides the suspension:

```ts
import { registerRoverPart } from '@takeon/engine';

registerRoverPart({
  id: 'my-game/pennant',
  order: 76,
  sprung: true,
  when: (p) => p.has.scanner,          // build-driven
  draw: (ctx, p) => { /* vector art in rover-local space */ },
});
```

The built-in set reacts to the build *and* the live state: drivetrain (wheels
or tracks, upgraded by mobility kits), solar wings with a daylight glint, an
RTG that glows at night, camera mast, sweeping dish, scanner whip with a pulse,
tool arm that swings and throws chips while drilling, crates that stack as the
hold fills, a five-LED charge strip, scorch marks and sparks as the hull wears,
a status strobe that goes red in trouble, and headlights after dusk.

The flat view has its own painter per entity kind
(`registerFlatPainter('rover', …)`), so a host can add entity types to either
view without forking a renderer.

## Noise

`util/noise/` is a small field library rather than one hard-coded function:

| Sampler | Character |
|---|---|
| `valueNoise2` | The original TakeOn field. Soft, lumpy. Cheapest |
| `perlin2` | Gradient noise — flowing dunes and ridges |
| `simplex2` | Isotropic gradient noise, no grid artefacts |
| `worley2` | Cellular: craters/pans (`f1`), fractures (`f2f1`), plates (`cells`) |
| `blueNoiseMask` / `poissonDisk` / `scatterPoints` | Evenly spread randomness for *placement* — boulders, flora, sample sites, dithering |

Fractal stacking (`fbm`, `ridged`, `billow`), domain warping and frequency all
come from one config:

```ts
const field = makeNoise(
  { type: 'simplex', fractal: 'ridged', frequency: 0.06, octaves: 5, warp: 4 },
  seed,
);
field(x, y); // [0,1]
```

A destination opts in by carrying that config:

```ts
terrain: { roughness: 0.6, craters: 4, iceCaps: 0, oreRichness: 0.5,
           noise: { type: 'perlin', fractal: 'billow', frequency: 0.05 } }
```

**Bodies without a `noise` block keep the original field exactly** — the
shipped worlds regenerate byte-for-byte, which matters because saves store only
voxel edits. A test asserts it.

The editor exposes all of this: a *Noise field* group in the inspector, a live
preview of the exact field the generator will use, and a blue-noise **Scatter**
preview.

## Registries — the extension points

| Registry | Add with | Used for |
|---|---|---|
| Destinations | `registerBody(def)` | Editor drafts, backend rows, host worlds |
| Rover parts | `registerRoverPart(part)` | New hardware on the rover sprite |
| Flat painters | `registerFlatPainter(kind, fn)` | Drawing new entity kinds in 2D |
| UI components | `<TakeOnUIProvider components={…}>` | Replacing any HUD component ([UI.md](UI.md)) |
| Editor panels | same registry, `Editor*` keys | Replacing tool panels ([EDITOR.md](EDITOR.md)) |
| Inspector fields | `BODY_FIELDS` + `extraFields` | New authorable properties |
| Persistence | `SyncAdapter` | Putting mission data in your database |
| Events | `game.events` / `GAME_EVENT_KEYS` | Quests, XP, analytics — every event is enumerable |

## Determinism rules

1. A world is a pure function of `(BodyDef, seed)`. Never persist voxels; persist
   edits (`MissionState`).
2. Anything that changes generation output changes every existing save of that
   body. New generation features must be opt-in per body (that is why
   `terrain.noise` exists rather than a global switch).
3. The sim uses seeded RNG only — no `Math.random` in `sim/` or `world/`.
4. Renderer-only randomness (ambient life, particles) never feeds back into the
   sim, and is not saved.

## Adding things

- **A destination** — author it in the editor, export the TS literal into
  `world/bodies.ts`, or `registerBody()` it at runtime.
- **A noise type** — add the sampler in `util/noise/`, list it in `NOISE_TYPES`,
  and it appears in the config factory, the inspector and the previews.
- **A body property** — add the field to `BodyDef`, describe it in
  `BODY_FIELDS`, validate it in `validateBody`. The inspector picks it up.
- **A rover component** — `registerRoverPart`.
- **A view** — implement `SceneView`, draw from `buildScene`.
- **A HUD component** — add a slot key in `@takeon/ui` and register the default.
- **A gameplay rule** — it goes in `sim/`, with a test. Nowhere else.
