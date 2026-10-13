# TakeOn cross-platform runtime and terrain presentation

Status: architecture decision for KES-212

Date: 2026-10-13

## Goal

TakeOn is a reusable Star Sailors runtime for games that need generated worlds
and a consistent terrain presentation. Rover missions are one consumer. Other
games must be able to use terrain, world inspection, camera behavior, and
rendered scene components without inheriting rover rules, Landnam progression,
or another host's economy and identity model.

The player-facing TakeOn experience must stay behaviorally and visually
consistent on web, Android, iOS, and macOS. Platform shells can adapt lifecycle,
input devices, accessibility, and host integration; they must not fork terrain
generation, gameplay rules, camera/projection behavior, material presentation,
or scene composition.

## Current implementation

| Layer | Current source | State and gap |
|---|---|---|
| World generation and rover simulation | `packages/engine` TypeScript | Full current game implementation. Deterministic terrain is generated from a body and seed; gameplay, state, and events are in the same package. |
| Terrain and scene rendering | TypeScript Canvas 2D in `packages/engine/src/render` | Isometric and flat views share the world and camera contract. Renderer directly consumes `Simulation`, `World`, and browser canvas APIs; this is not yet a generic terrain renderer package. |
| HUD and mission UI | `packages/ui` React/CSS | Reusable and host-overridable, but browser-based. The stock HUD is rover-mission-specific. |
| Pixi host adapter | `packages/pixi-adapter` | Embeds the existing canvas renderer in a Pixi stage. It is not another engine or renderer. |
| Go core | `go/` | A deterministic port of generation and a subset of rover simulation. Structures, recipes, scan/photo, repairs, upgrades, authoring and several other systems are absent or stubbed. It has no visual renderer or app. |
| Native host clients | Outside this repository | Landnam has a Swift app and a TakeonKit boundary, but that does not make the TakeOn visual and simulation stack shared. This checkout has no native TakeOn renderer, Android app, or platform parity harness. |

The current `Scene`/`SceneEntity` and `SceneView` interfaces are useful seams,
but `Scene` is built from a rover `Simulation`, the isometric renderer reads
rover/world internals, and `RoverGameOptions` requires an `HTMLCanvasElement`.
Those are concrete coupling points to remove or wrap during generalization.

The first host-neutral scene API now exists: `createSceneSnapshot()` composes
a data-only frame from host-provided world metadata and entities, and
`RoverGame.sceneSnapshot()` strips live object references from the compatibility
`scene()` result. A snapshot is intentionally a scene frame, not terrain data;
consumers still pair it with a `BodyDef`/`VoxelWorld` until the renderer is
separated from rover simulation.

## Decision

Keep the complete TypeScript engine as the canonical gameplay and generation
implementation for the first parity phase. Deliver that same runtime and
presentation bundle to browser clients and to native app shells through an
embedded JavaScript/WebView surface. Native Swift/Kotlin code owns the app
shell and platform services; it calls a narrow host bridge and does not
reimplement TakeOn simulation or terrain drawing. The Go spike remains a
determinism reference and possible backend tool, not a second client engine.

This is the smallest path to one source of gameplay and terrain presentation:
the TypeScript engine is already the complete shipped game, its renderer and
HUD exist, and the native TakeonKit boundary can host a shared client. A full
Swift/Kotlin port would duplicate simulation rules and renderer behavior. A
Go-core plus per-platform renderers would still leave camera, lighting,
material shading, scene composition, and animation to drift. A new native
graphics engine would require replacing a working renderer before it could
deliver cross-platform parity.

The choice is a migration direction, not a claim that parity already exists.
It also does not make arbitrary browser Canvas implementations pixel-identical
by assumption. The parity harness will compare deterministic state and
rendered scenes on every target. If Canvas/WebView differences produce visible
terrain drift, terrain rasterization becomes a shared deterministic pixel
renderer with thin platform presentation adapters; platform-specific terrain
painters are not an acceptable fix.

## Runtime and host boundary

TakeOn owns:

* Seeded terrain generation, terrain edits, materials, biomes, weather, and
  terrain-derived analysis.
* Generic world queries, camera/projection math, scene snapshots, visual
  terrain composition, built-in terrain effects, and the rules for any
  gameplay module that ships as part of TakeOn.
* Stable commands and events, fixed-step timing, deterministic state
  transitions, and serializable runtime state.
* Optional game modules such as rover exploration. A rover module can add its
  own actors, tools, resources, and mission rules without making them required
  by every terrain consumer.

The host game owns:

* Account identity, economy, progression, narrative, quests, citizen-science
  workflows, save destination, multiplayer policy, and app navigation.
* Host-specific HUD, controls, and actors where the host intentionally owns
  those concerns. It may add entities through supported extension points, but
  it must use TakeOn's terrain/world presentation contract for the shared
  visual result.
* A platform bridge for app lifecycle, safe area, keyboard/controller/touch
  input, accessibility, and host events. Bridge messages are versioned data;
  no platform may call private renderer internals.

The generic API should converge on these concepts:

| Concept | Contract |
|---|---|
| World definition | Stable ID, seed, dimensions, generation parameters, palette/material catalog, and optional authored overrides. |
| World state | Deterministically generated terrain plus explicit edits and module-owned state. |
| Actor/entity | Stable ID, world position, kind, presentation variant, and opaque host data; no requirement that every world contain a rover. |
| Command | Versioned, serializable intent such as move, inspect, interact, or module-specific action. Platform input maps into commands. |
| Scene snapshot | Immutable frame description with world/camera parameters, palette, terrain visibility, ordered entities, lighting/time, and overlays. |
| Renderer | One canonical terrain presentation implementation consuming scene/world data; host extensions register painters or overlays without replacing the terrain contract. |
| Event | Versioned result of a command or simulation transition; host translates it into its own economy/progression. |
| Persistence adapter | Host-owned storage implementing a stable runtime save interface; TakeOn defines data shape and migration version, not account/storage policy. |

Existing `RoverGame`, `Simulation`, `Scene`, `SceneView`, `SyncAdapter`, and
native TakeonKit entry points remain compatibility facades while consumers
migrate to the generalized runtime. Do not break Landnam's host boundary as a
side effect of generic terrain work.

## Parity contract

Parity is evaluated for the same runtime version, body/world definition, seed,
initial state, command stream, and virtual viewport. Device-specific input is
normalized into the same commands; viewport size and safe area may change
layout, but cannot change world rules or terrain style.

| Area | Required evidence on web, Android, iOS, macOS |
|---|---|
| Generation | Golden terrain/material hashes and generation metadata match for the same body and seed. |
| Simulation | Command/event/state traces match after each fixed tick; save/restore continues identically. |
| Controls | Equivalent keyboard, touch, pointer, and controller intents map to the same command semantics where supported. |
| Terrain visuals | Same projection, camera rotation/zoom rules, material palette, lighting response, edge treatment, entities, overlays, and animation phase for equivalent scene input. |
| Responsiveness | Each target passes the same reference virtual viewport set and adapts controls/layout to native safe areas without changing the scene rules. |
| Lifecycle | Pause, resume, resize, background/foreground, and save/resume produce the same state and scene. |
| Consumer isolation | Rover and a distinct terrain game use the same terrain/world/render API while keeping their own progression and economy. |

Use fixed seeds, bodies, command tapes, virtual sizes, and animation times.
Compare exact generation and state data. Capture rendered output on each target
and compare against a shared visual baseline; any tolerated raster difference
must be measured, documented, and limited to rasterization noise. A change to
palette, camera, lighting, terrain silhouette, entity scale, or composition is
a parity regression. Building an app or passing unit tests alone is not visual
parity evidence.

## Consumer examples

### Rover mission

Landnam supplies a world seed and rover loadout, maps TakeOn commands/events to
its mission and economy, and persists the host's operation state. TakeOn
generates and presents terrain and runs the rover module. Landnam does not
replace terrain presentation with a second planetary painter.

### Star Sailors settlement survey

A settlement-survey game supplies a world definition and its own surveyor or
building entities. It uses TakeOn terrain generation, camera, material
presentation, world picking, and scene rendering, then handles permits,
settlement resources, story events, and progression itself. It does not need a
rover, battery, mining loop, or Landnam mission schema.

## Implementation sequence

1. **Contract and audit (complete).** Record the canonical-engine decision,
   host boundary, existing gaps, platform parity matrix, and consumer examples.
2. **Make the TypeScript runtime host-neutral (in progress).** The initial
   data-only scene snapshot API is in place. Next split generic world/scene
   snapshots from rover simulation dependencies; define stable command/event
   messages and a terrain renderer input that does not expose `Simulation`.
3. **Package the shared client.** Build a versioned runtime bundle with an
   explicit host bridge, deterministic fixed-step clock, resize/lifecycle
   hooks, and no host-specific account or progression logic.
4. **Connect native shells.** Mount the same bundle in iOS, macOS, and Android
   shells. Implement bridge and lifecycle adapters, then exercise identical
   command tapes and screenshots on each platform. Web consumes the same
   runtime package as the reference client, not a separate feature branch.
5. **Generalize terrain components.** Expose body/world rendering, camera,
   picking, terrain analysis, and entity/overlay extension APIs as reusable
   components independent of rover HUD and mission rules.
6. **Migrate consumers and retire duplicate rules.** Keep rover behavior behind
   its module adapter; use a second Star Sailors terrain consumer as the
   acceptance fixture. Remove or narrow duplicate Go/Swift gameplay only after
   save compatibility and golden traces are covered.

Each phase has an acceptance gate across all four targets. Do not call the
runtime cross-platform complete while a target is represented only by a Go
build, an API protocol, or a mocked renderer.

## Deferred

* Rewriting the complete engine in Go, Swift, Kotlin, Rust, or a new ECS.
* Separate terrain renderers per platform.
* Making every host use TakeOn's rover HUD, economy, identity, or persistence.
* Implementing observatory, settlement, or other host-specific gameplay in the
  generic engine.
* Declaring exact pixel parity before the four-target screenshot harness
  demonstrates it; if shared Canvas 2D fails that gate, replace the raster
  backend once for all clients.

## Related

* [Engine structure](ENGINE.md)
* [Host integration](INTEGRATION.md)
* [UI extension points](UI.md)
* [Go determinism spike](go-core-spike.md)
