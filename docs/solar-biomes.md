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

## Moon: measured terrain

The Moon now uses NASA LRO LOLA global elevation and the LROC colour mosaic in
the studio. The maps and their limits are documented in `go/data/lunar/README.md`.
The elevation is exaggerated fourfold for visual legibility; temperature and
biomes for other bodies are still procedural and must not be presented as
measurement. The interactive studio currently keeps its 128 × 256 mesh; its
software renderer would struggle with the requested 16× mesh.

The high-resolution offline proof uses `tools/solar/render_moon.py`: a
1024 × 512 sphere (16× as many triangles as the 256 × 128 studio sphere)
with the same NASA elevation and colour data. Run from the repository root:
`blender -b -t 4 --python tools/solar/render_moon.py -- /tmp/moon.png`.
This does not yet increase the in-game renderer's resolution or connect measured
terrain to the game's tile-based surface. Data source resolution also caps the
real detail; extra triangles interpolate the data rather than invent detail.

### Observational maps: Mars and planetary imagery

The solar studio additionally uses NASA/JPL image maps for Mars, Venus, Jupiter,
Saturn, and Neptune ([NASA 3D image resources](https://science.nasa.gov/3d-resources/mars/)).
Their native JPEG sizes are 1440×720 for Mars/Venus and 720×360 for the
others; the mesh does not increase the source image's information content.
Venus uses a colour image and generated relief, not measured elevations. The
outer-planet maps represent atmospheric cloud tops, not solid surfaces. These
maps are illustrative global composites, not current weather or surface surveys.

Mars's surface displacement comes from the [NASA PDS Mars Global Surveyor
MOLA MEGDR topography](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html),
`megt90n000eb.img` (16 pixels/degree, 5760×2880, median elevations in metres
relative to the Mars areoid; unobserved cells interpolated by the dataset).
The signed big-endian values were rotated from 0–360°E into a map centered on
0° and losslessly stored as unsigned 16-bit PNG with 32768 added. The studio
and offline render exaggerate relief 4×. Image credit: NASA/JPL-Caltech; MOLA
credit: NASA/MGS MOLA science team. The renderer's 1024×512 grid produces
1,048,576 triangles, 16× the current 256×128 interactive grid; its visual
resolution is limited by the input maps and image interpolation.

`SampleObservedSurface` exposes imagery and, for Mars only, measured elevation;
its missing elevation must not be interpreted as zero. Other bodies remain
procedural, and this observational data is not yet integrated with Landnam's
scene or voxel generation. The API embeds the images, increasing binary size.
