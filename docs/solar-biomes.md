# Solar biome model: initial procedural foundation

This is a seeded, stylized game model, not a source of scientific observations.
It supplies a common spherical field for map/planet renderers and a lat/lon tile
grid for future surface renderers. It is independent of the older voxel terrain
simulation; it does not yet drive the playable Takeon voxel world or Landnám's
map. Neither representation is a mission scene or an asset pack.

## Coverage

Eight planets; Moon, Phobos, Deimos, Io, Europa, Ganymede, Callisto, Titan,
Enceladus and Triton; and the first six asteroids in Landnám's current target
list (Eros, Vesta, Itokawa, Ryugu, Psyche and Bennu). Several of those are
near-Earth asteroids rather than main-belt bodies. The selection is a product
catalog order, not a statement about their real orbital location. Gas giants
have atmospheric samples and reject land-surface patches. Venus is represented
as terrain for visual exploration; this does not change Landnám's mission or
construction restrictions.

Each profile contains an approximate temperature baseline, stylized climate,
relief and landability. Latitude and elevation influence the computed game
temperature; thresholds choose stylized biomes. Spherical coherent noise varies
by body and seed and wraps at the dateline. `SampleSolarBody` produces a globe
sample; `SampleSolarPatch` samples the same field in row-major tile order. The
latter rejects patches crossing the poles or dateline; split them into valid
patches. Inputs and seeds should be saved with the exact core revision: this
initial field is not yet a versioned save contract.

Go hosts can call `SolarProfiles`, `SampleSolarBody`, and `SampleSolarPatch`.
The WASM JSON bridge provides `solarProfiles`, `solarSample`, and `solarPatch`;
the latter two accept a `solar` object with `id`, `seed`, `latitude`,
`longitude`, and for patches `step`, `width`, `height`. Mobile exposes the same
operations as JSON. High-level JS and Swift wrappers, artifact repackaging,
Landnám integration and on-device verification remain future work.

Run `go run ./cmd/solar-preview /tmp/solar-preview.svg` from `go/` for a
24-body diagnostic sheet. The colours are placeholders and the circles show
biome classification rather than a displaced 3D mesh. It is a model check, not
visual approval of the requested final art style. Future work must connect this
model to the existing voxel renderer and create playable 2D/3D scenes, then
build visual mission fixtures for the location/mission combinations in the
design notes. Asset treatment, tile edges, elevation, lighting and globe
shapes are not yet production-ready.

For the interactive 3D development preview, run `go run ./cmd/solar-studio`
from `go/` and open `http://127.0.0.1:4343`. The preview triangulates the
spherical samples into a displaced, lit mesh and offers body, seed, rotation
and zoom controls. It does not yet implement the playable scene, realistic
planetary shapes, surface assets or the final art direction.
