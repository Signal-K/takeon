# Procedural locations (v1 foundation)

Takeon can derive a stable game location from a host-owned ID, parent ID,
seed and built-in surface body template. The host owns naming, map grouping,
mission rules and the choice of template. Save the complete input and the
Takeon core/content version: changing the template or core can change terrain.
The v1 descriptor algorithm is frozen; later algorithms must use a new version.

`GenerateLocation` returns normalized map layout coordinates (0–10000) and a
32-bit `terrainSeed`. They are deterministic game content, not physical
coordinates, geological measurements, survey evidence or real-world findings.
The points do not prevent overlaps; layout, reachability and presentation are
the host's responsibility. Templates are existing built-in planets, moons and
asteroids; gas bodies and unknown templates are rejected.

Create a scene with the returned `spec.bodyId` and `terrainSeed` through the
existing engine API. Both a top-down/2D renderer and a 3D renderer can consume
its world/window data; neither gets its own terrain generator. World edits and
snapshots belong to the existing engine persistence system. A location seed is
not a save of edits. The generator does not yet provide a map UI, scene adapters,
user-authored templates, surface feature placement or observation data.

The Go API is `GenerateLocation(LocationSpec)`. The web/WASM JSON bridge accepts
`{"op":"location","location":{"version":1,"id":"site-1","parentId":"system-1","bodyId":"mars","seed":42}}`.
The mobile facade exposes `GenerateLocationJSON` with the same `location`
object as its input. The response includes the spec, type, map coordinates and
terrain seed. The browser's higher-level TypeScript wrapper and native app do
not yet expose or consume this operation; building the WASM/mobile artifacts and
updating host packages is required before use there.
