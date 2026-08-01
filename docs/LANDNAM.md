# Landnam readiness

[Landnam](https://github.com/Signal-K/planet-hunters-experiment-1) is a
Star Sailors spoke that vendors `@takeon/engine`/`@takeon/pixi` as `file:`
tarballs (`web/vendor/takeon/`) and currently only wires them into a
standalone technical-preview demo (`TakeonEngineDemo.tsx`), not into live
game state. This maps its four scene families — construction, underground,
settlement/exploration — onto what TakeOn now provides, and what changed in
this repo to close the gaps found during the audit. No changes were made to
the Landnam repository; it is read-only context for this engine.

## Construction

Landnam's live build screen (`BuildPlaceScreen.tsx`) already matches TakeOn's
shape: a plot grid, a structure catalog, and a cost-in-minerals gate. TakeOn
covers this with `STRUCTURES`, `game.build(type)`/`built`/`buildFailed`
events, and `RECIPES`/`game.craft(id)` for refining (see
[INTEGRATION.md](INTEGRATION.md)). The gap was that Landnam's structure and
mineral catalogs (`target-structures.ts`, `minerals.ts`) don't line up with
TakeOn's fixed built-in `StructureType`/`ResourceKey` unions — a spoke can't
register its own building or ore without either forking the engine or
waiting on a PR here.

**Fix**: `StructureType` and `ResourceKey` are now open string unions
(`| (string & {})`), and `MATERIALS`/`RESOURCE_NAMES`/`RESOURCE_VALUE`/
`STRUCTURES` are backed by a real registry (`registerStructure`,
`registerResource`, `registerResourceValue`, `registerMaterial` — all
exported from `@takeon/engine`). A host registers its own catalog once at
startup; every internal call site (`MATERIALS[m]`, `STRUCTURES[type]`,
build/craft/render code) already reads through these objects, so custom
entries work with zero engine changes. Landnam's 10 `TARGET_STRUCTURES` and
16 `MINERAL_META` entries can be registered directly instead of remapped
onto TakeOn's built-in set.

Also unblocked: Landnam's orphaned decorative `ConstructionTargetCanvas`
scene (3 fixed pads, no simulation underneath) can now be replaced with a
real `game.build()`-backed screen if Landnam wants it live.

## Underground

Landnam's `HubSubsurfaceView.tsx` is a static SVG of three fixed strata
(topsoil/subsoil/bedrock, each a hardcoded mineral). TakeOn had the data for
a *real* underground view (`crossSection()` in `world/analysis.ts`) but no
ore stratification (bodies only had a flat iron/copper/titanium mix) and no
reusable painter — the pixel-to-canvas logic lived inside `@takeon/editor`'s
internal `maps.ts`, unusable by a host game.

**Fix, two parts**:

1. **Depth-stratified ore** (`OreBand`, opt-in per body via
   `terrain.bands`): fraction-of-column-depth bands (`from`/`to` in `0..1`,
   independent of a body's `maxHeight`) each naming which materials can
   appear in that stratum. Bodies that don't opt in keep the old flat mix
   byte-identical (`test/noise.test.ts`, `test/ore-bands.test.ts`). This is
   what makes Landnam's "topsoil is platinum, bedrock is rhodium/gold" idea
   an actual generation rule instead of a hand-drawn illustration.
2. **A droppable component**: `crossSectionImage()`/`renderCrossSection()`
   (`@takeon/engine`, `render/cross-section.ts`) turn a world slice into
   real pixels — DOM-free (`crossSectionImage` feature-detects `ImageData`
   so it runs in a worker or a Node test) and canvas-blitting
   (`renderCrossSection`). `@takeon/ui` wraps it as `<CrossSectionView/>`: a
   live panel that follows the rover's position along an axis and redraws
   on an interval, styled to match the rest of the HUD
   (`.tk-cross-section*` in `styles.css`). It isn't part of the default
   `MissionScreen` layout — mount it via a slot, a custom panel, or a
   standalone screen, matching how Landnam's subsurface view is its own
   route/screen already.

`@takeon/editor`'s own cross-section tool now delegates to the same
`renderCrossSection()` rather than duplicating the pixel logic, so the
editor preview and the in-game view are guaranteed to agree.

## Settlement / exploration

Landnam's `RoverMiningScreen.tsx` is a stub timer, not a simulation — this
is the one scene family that isn't a TakeOn gap so much as a Landnam
integration gap. TakeOn's actual rover sim already exercises this world:
`game.move`/`game.mine`/`game.scan`/`game.photo`, `anomalyDocumented`
discoveries, and the pure offline-first objective module
(`createWorldState`/`explore`/`deriveMissionProgress`) for a lighter,
non-realtime progress loop if Landnam doesn't want the full tile sim. Per
Landnam's own decision doc (`.knowns-outbox/takeon-decision-bundle-*.md`),
exploration is intended as the first mechanic to prove out — nothing further
was needed engine-side for this pass; settlements/refineries/research-labs
are called out there as a later module split, which the construction-scene
work above already anticipates (open catalogs, no engine fork needed).

## Summary of engine changes

| Area | Before | After |
|---|---|---|
| `Material`, `ResourceKey`, `StructureType` | closed enum / string unions | open, with a mutation-based runtime registry |
| Ore placement | flat mix, whole column | optional `terrain.bands` depth strata, opt-in per body |
| Underground rendering | trapped in `@takeon/editor`'s `maps.ts` | `@takeon/engine`'s `crossSectionImage`/`renderCrossSection` + `@takeon/ui`'s `<CrossSectionView/>` |

All of the above ships in `@takeon/engine` v0.2.0+ and `@takeon/ui` v0.2.0+;
Landnam picks it up by bumping its vendored tarballs.
