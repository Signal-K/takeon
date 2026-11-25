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
its missing elevation must not be interpreted as zero. Other bodies may still use procedural terrain or imagery only, and this observational data is not yet integrated with Landnam's
scene or voxel generation. The API embeds the images, increasing binary size.

### Earth and Mercury imagery

Earth now uses the 2048×1024 NASA SVS [Blue Marble global mosaic](https://svs.gsfc.nasa.gov/2915/), a composite of satellite observations with topographic shading baked into the image. Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble data courtesy Reto Stöckli (NASA/GSFC) and NASA's Earth Observatory. It is not a current observation or a height map.

Mercury uses the 6132×3066 NASA SVS [MESSENGER global monochrome mosaic](https://svs.gsfc.nasa.gov/11197/), converted to JPEG. The corresponding [PDS catalog](https://pds-rings.seti.org/press_releases/pages/PIA15xxx/PIA15063.html) describes a simple cylindrical projection centered at 0° longitude, with coverage over 99.9%; remaining gaps and inconsistent illumination are visible in the composite. Credit: NASA/Johns Hopkins University Applied Physics Laboratory/Carnegie Institution of Washington. Its brightness is imagery, not measured elevation.

The studio displays both images on smooth spheres, because we do not yet have registered elevation maps for them. `SampleObservedSurface` supplies their image colours but no elevation. The interactive renderer still samples colour at the vertices of its 256×128 grid; it does not display the full source image resolution. For a higher-density offline image, run `blender -b -t 4 --python tools/solar/render_observed.py -- earth /tmp/earth.png` (or replace `earth` with `mercury`); this uses 1024×512 quads, 16× the interactive triangle count, without fabricating relief. The true image detail remains limited to the source maps.

### Stylised terrain experiment

`SampleStyledSolarBody` combines the existing seeded `SampleSolarBody` field
with measured Moon or Mars elevation, exaggerated sevenfold. The result is a
visual radius, not an elevation measurement: the additional broad forms are
invented and vary with the seed. Other landable worlds use generated shape;
observed imagery, where available, does not imply measured height. Gas giants
stay spherical. The studio blends observed colour into the game's biome palette.
The visual field is shared with the offline proof; `SampleStyledSolarPatch`
provides registered samples for future surface scenes.

For a high-density Mars art proof, from `go/` run `go run ./cmd/solar-style-grid
-body mars -seed 11 -out /tmp/landnam-style-mars.bin`, then from the repository
root run `blender -b -t 4 --python tools/solar/render_styled_mars.py --
/tmp/styled-mars.png`. The render uses the same Go shape at 1024×512 quads;
its illustrative warm material differs from the studio's biome-colour blend.
The interactive viewer retains its 256×128 grid.

### Complete location pass and stability

All 24 registered bodies use the same deterministic globe sampler. Phobos,
Deimos and the six listed asteroids have approximate art-directed ellipsoids;
these are not spacecraft shape models. The list includes near-Earth asteroids,
not only main-belt objects. Gas giants represent clouds and have no surface.
Moon and Mars alone currently include measured elevation; other relief is
seeded and generated, even when observed colour imagery exists. The existing
noise shares Takeon's `hash3` primitive, but the voxel engine's `GenerateTerrain`
uses its own 2D field and is not yet generated from these globe samples.

`SampleStyledSolarPatch` evaluates the same version-1 visual radius as the
globe, including observed elevation and stylisation. It is available through the
`styledSolarSample` and `styledSolarPatch` bridge operations and mobile JSON
functions. Save the body ID, unsigned 32-bit seed and `SolarStyleVersion` with
content; version 1 is the current contract. Future styles must retain the version
1 implementation before persisted content can safely depend on future changes.
This API is a sampling foundation, not yet a voxel-world or playable-scene
integration. The viewer and these samples have not been wired into Landnam.

Run `python3 tools/solar/contact_sheet.py /tmp/locations.png` while the studio
is running to make an overview from its meshes. Set `SOLAR_STUDIO_URL` if the
studio uses a different local address; this image is a simplified offline
rasterisation and uses the interactive mesh resolution.

### Orbit-to-surface handoff

`PrepareSolarLanding` accepts a body, seed, coordinates and an odd-sized grid.
It returns a center sample, a matching row-major landing patch, the style
version and a local up/east/north frame for orienting the camera and scene.
Longitude wraps at the dateline; patches crossing a pole are rejected, as are
landings on gas giants. This is available as the `solarLanding` bridge operation
and mobile `SolarLandingJSON`. A host can select a point in orbit, prepare the
patch, transition its camera towards the returned local frame, and return to
the retained orbit view. Streaming, animation, playable terrain conversion,
mission placement and actual Landnam navigation are not implemented yet.

For a saved landing, retain the body ID, seed, coordinates, grid parameters and
`styleVersion` alongside the existing mission/run identity; restore with
`PrepareVersionedSolarLanding`, bridge `solarLanding` with `styleVersion`, or
mobile `VersionedSolarLandingJSON`. An omitted bridge version keeps the old
current-version behavior; an explicitly unsupported version returns an error.
Version 1 has regression fixtures, but future styles must keep its sampling
implementation and underlying data available. A host must retain its existing
mission state and provide a fallback for old saves without landing metadata;
these APIs do not migrate, modify or save Landnam progress.
