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

## Kinds, chunked biomes and world layers

Three related, independently opt-in systems for landscapes that vary by more
than one noise config:

**Kinds** (`world/kinds.ts`) are an inheritable preset tree above `BodyDef` —
`body` → `planet` → `rocky-planet` / `earth-like`, `body` → `moon` →
`ice-moon` / `rocky-moon`, `body` → `asteroid` → `c/m/s-type-asteroid`,
`body` → `gaseous`. `BodyType` ('planet'/'moon'/'asteroid'/'gaseous') is the
coarse category gameplay branches on; a *kind* bundles the physics/palette/
weather/climate defaults for a flavour of it, inheriting from its parent so
you only override what's different:

```ts
import { instantiateBody } from '@takeon/engine';

// A host's own solar-system sim hands in the one thing it actually knows —
// this body's real temperature — and gets back a concrete, generatable body.
const body = instantiateBody('rocky-planet', {
  id: 'kepler-186f', name: 'Kepler-186f', seed: 42,
  climate: { temperature: -63 },
});
```

**Chunked biomes** (`world/biomes.ts`, opt in with `terrain.biomes: true`)
divide the surface into a `CHUNK_SIZE` (16) grid, each chunk independently
seeded and rolling one `Biome` — a small surface/subsurface material list,
gated by the body's `kind` (`allowedBiomesForKind`) and, if set, `climate`
(a per-chunk temperature sampled around `climate.temperature`, swung by
`climate.tempVariance`). Ore veins stay `OreBand`'s job — a biome only
dresses the top couple of surface voxels, so the "skin" and the "mineral
economy underneath" stay independent, composable layers. Absent the flag, a
body keeps the original single-skin generation byte-for-byte.

**World layers** (`world/layers.ts`) are the seam for a second grid
alongside the surface world — a cave layer, a sky layer — for a *module*
built on top of TakeOn, not core itself: core registers none, so mining
stays exactly what it is today (top-down, deposits and ice). A module calls
`registerWorldLayer(id, (body, seed, world) => yourData)`; `generateTerrain`
runs every registered generator and attaches the result to
`world.layers[id]`, opaque to core. Deterministic like the rest of
generation, so it needs no persistence of its own.

See [LANDNAM.md](LANDNAM.md) for how this maps onto a specific host game's
scenes.

## Registries — the extension points

| Registry | Add with | Used for |
|---|---|---|
| Destinations | `registerBody(def)` | Editor drafts, backend rows, host worlds |
| Body kinds | `registerBodyKind(kind)` | New planet/moon/asteroid presets to `instantiateBody()` |
| Biomes | `registerBiome(biome)` | New chunk-scale surface skins |
| World layers | `registerWorldLayer(id, fn)` | A module adding an underground/sky grid |
| Materials/resources | `registerMaterial`/`registerResource` | New voxel materials and cargo keys |
| Structures | `registerStructure(def)` | New buildable structures |
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

## Field module (KES-541)

`src/field/` is a self-contained, opt-in model for mobile scenes. It sits apart from the voxel world and the isometric renderer, which are unchanged.

- **`FieldTerrain`** is a continuous height function in metres, deterministic from `(recipe, seed)`.
  - The five styles are `regolith`, `rust`, `carbon`, `metal` and `ice`.
  - The landing area is always flat and clear, and the first deposits sit a short drive from it. `terrain.sources` holds full attribution for any real data, and `terrain.credits` holds a short HUD credit.
- **Field PCG** (`pcg.ts`, KES-543) builds the surface from a recipe of layers, `{ kind, ...params }`. Each registered `FieldLayer` can have up to three passes:
  - `prepare` places features before the grid is built.
  - `shape` adds height and tone to each sample.
  - `place` runs on the finished surface and can read height and slope.

  Hosts add kinds with `registerFieldLayer` and pass `recipe` to compose their own; `recipeForStyle` gives the defaults. The built-in kinds are:
  - `dem`: a seeded window of a real DTM in true metres. If the field is wider than the patch, the patch is stretched and its heights are scaled by the same factor, so slopes stay true. The landing moves to the flattest open ground.
  - `craters`: a measured size–frequency power law, N(≥D) = a·D^-b. The default is the lunar small-crater equilibrium, a = 0.0794, b = 2.
  - `boulders`: the Golombek–Rapp rock-abundance model, F(D) = k·e^(−qD).
  - `dunes`, `relief`, `ridges` and `grain`: procedural shape and detail.
  - `deposits`: ore in hollows.

  Which recipe each body gets by default:
  - The Moon starts from Kaguya Taurus-Littrow.
  - Mars starts from HiRISE Jezero or Gale.
  - Bodies with no surface data are procedural.
- **Real DTM patches** (`dem.ts`, `dems.generated.ts`) are windows cut from USGS analysis-ready DTMs (CC0) by `scripts/fetch-field-dems.py`. The script uses rasterio and range-reads cloud-optimised GeoTIFFs. It picks the roughest window a rover can still drive and stores heights in decimetres. Hosts add their own with `registerFieldDem`.
- **`FieldPlanner`** (`path.ts`) does tap-to-drive routing. It runs A* on a 1 m grid. Cells steeper than the rover can climb, or under a boulder (grown by the rover's half width), are closed. Open cells cost more the steeper they are. The path is then pulled tight into a few straight legs.
- **`FieldVehicle`** is a skid-steer rover in continuous space.
  - `follow(route)` drives a planned route by itself. Manual input drops the route. If the rover is held up for more than 1.2 s it gives up and calls `onStuck`.
  - Manual input is a screen direction. The camera is north-up, so the screen direction is also the world direction.
  - It turns toward the input and drives once it faces it.
  - Slopes push back with the body's gravity, grades over `maxGrade` stop it, and boulders block it.
  - It runs on a fixed 60 Hz step.
- **`FieldRenderer`** (KES-543) is a WebGL2 3D view. It replaced the top-down canvas view, which read as tiny and upside-down on a phone.
  - The camera is built for a phone held upright. It never turns, and it looks north and steeply down, about 60° on the surface and 62° in orbit, like a top-down action game. A low chase camera wasted half of a portrait screen on sky and squeezed the ground into a strip.
  - It frames a fixed ground width across the narrow side of the screen (18 m on the surface, wide enough to see where to send the rover, and 26 m in orbit), so the rover is the same size on every phone. It leads the way the vehicle is moving, so the rover sits a little below centre with room ahead.
  - The terrain is one mesh: 0.5 m inside the field, with a coarse apron out to the horizon.
  - Shading is per pixel: a south-west sun, baked self-shadows, a tiling grain texture, wheel tracks, the vehicle's shadow, the scan pulse, ore glow and the laser hit point.
  - Boulders, ore crystals, the rover (wheels spin with the odometer) and the ship are low-poly meshes from `meshes.ts`.
  - The laser beam, sparks and engine flares are additive billboards.
  - The look is painted and inked, in the Out There: Omega manner. Lighting falls in cel bands, shadows lean plum and distance fades into a coloured haze. The scene renders off-screen into colour, normal and depth targets. A comic pass then draws navy ink lines where depth creases or normals break, adds hatching to the deepest shade, and applies a warm/plum grade, paper grain and a vignette. Lines fade with distance so the horizon stays painted.
  - The sky is painted per style: saturated nebulae, stars and a banded, inked planet for airless bodies, and a lilac sky with warm cloud banks for rust. The steep camera rarely shows it.
  - Models are outlined wherever they meet the ground, however far away the camera is. Fog and line fade scale with the camera distance.
  - Over a crater rim, the camera tilts steeper rather than lose the rover behind it.
  - The rover is the Landnam/TakeOn rover in 3D, part for part with the iso painter (`render/rover.ts`). Pass `rover` as a `RoverSpec` and `roverLookFromSpec` reads its fit-out:
    - hull colour and chassis (scout, a longer hauler, a taller lab);
    - six dark spoked wheels, or tracks;
    - blue solar wings out to the sides, or an RTG;
    - a camera mast with a white head and stereo eyes;
    - a scanner whip with a cyan tip;
    - a jointed tool arm, where the laser leaves;
    - a cargo bed.

    Every build also has the ribbed blue-grey aft tank, the white dish, the green charge strip and the amber beacon. There is no orange, as on the iso rover. Vertex colours are weathered at build time (`MeshBuilder.weather`).
  - The mining ship is Landnam's (`laser/ship.png`, the minimal mine pass): a cream hull with a pointed nose, blue side and spine stripes, a blue-framed cockpit, a dorsal fin, a grey nozzle, landing legs and a ventral laser.
  - Call `project()` to turn a world point into CSS pixels, and `pick()` to turn CSS pixels into a ground point.
- **`FieldOrbiter`** is the mining ship on a low pass. It drifts north at orbital speed, the stick slides it east and west and trims the drift, and it comes round again at the south edge.
- **`FieldMiner`** is the laser. It locks only onto scanned ore within range (rover 7 m, orbit 45 m) and cuts until the deposit is empty. `depositScale` (opt-in) makes the bigger veins that orbit fields use.
- **`mountFieldScene(canvas, opts)`** wires these together.
  - `mode` is `surface` or `orbit`.
  - On the surface the rover takes commands. Tap the ground and it plans a route and drives there. Tap scanned ore and it drives into laser range and mines the ore until it is empty. Arrows and WASD steer by hand and cancel the order.
  - Hosts can call `command(x, y)`, read `order` and listen on `onOrder`. The overlay draws the dotted route, a marker at the goal, and a red cross where a tap has no way through.
  - In orbit, drag to steer, and a quick tap on scanned ore aims the laser.
  - The host owns the HUD and calls `scan()` and `laser(on)`.
  - Pass an `overlay` canvas to get the route, the drag ring (orbit) and pointers to off-screen ore. The pointers stay clear of the top gauge panel and the bottom thumb buttons.

### Hosting the field (`@takeon/engine/field`)

The 3D field (KES-541, KES-543) is its own entry point, `import { mountFieldScene } from '@takeon/engine/field'`, so a host can load it on demand without the iso engine. It only depends on `util/rng`, `util/noise` and `types`. For a host running a mining order:

- `resources` lists ore by likelihood; the first one is always the seam nearest the landing, so list what the order wants first.
- `capacity` is the hold size: the laser stops at it and a rover with a cargo bed shows a crate per quarter full.
- `ship` picks the rocket on the orbit pass, one of Landnam's rocket types: `explorer` (default), `prospector` or `surveyor` (`FIELD_SHIP_KINDS`).
- The rover is built from blocks on a 1 m grid, Haphazard Martians style: hex nodes, braced girders, wheels on the end columns, a blue Navcam mast at the front, one fitted part per bay. It is 1.8 m over the wheels.
- `ORE_COLOURS` is mutable; write the host's mineral colours into it before mounting.
- `terrain.credits` names the real DTM under Mars and Moon fields; show it.
- Scanned ore off screen, or hidden under the host's gauge panel (top left) or thumb buttons (bottom right), gets an edge pointer with its distance. Seams that point the same way share one pointer, labelled with the nearest distance and a count of the rest (`70 m +2`), so labels never overlap.

Landnam mounts it in `FieldMiningScreen` for mining contracts (vendored as a 0.2.5 repack).
