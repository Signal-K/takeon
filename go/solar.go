package takeon

import (
	"fmt"
	"hash/fnv"
	"math"
)

// SolarProfile is an art-directed game model, not observational science data.
// Temperature is an approximate baseline in degrees Celsius for biome selection.
type SolarProfile struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Parent      string  `json:"parent"`
	Temperature float64 `json:"temperatureC"`
	Climate     string  `json:"climate"`
	Relief      float64 `json:"relief"`
	Landable    bool    `json:"landable"`
}

// Temperatures, relief, and biome categories are deliberately stylized for play.
var solarProfiles = []SolarProfile{
	{"mercury", "Mercury", "planet", "sun", 167, "barren", 0.55, true},
	{"venus", "Venus", "planet", "sun", 464, "volcanic", 0.45, true},
	{"earth", "Earth", "planet", "sun", 15, "temperate", 0.42, true},
	{"mars", "Mars", "planet", "sun", -60, "desert", 0.55, true},
	{"jupiter", "Jupiter", "planet", "sun", -110, "gas", 0.05, false},
	{"saturn", "Saturn", "planet", "sun", -140, "gas", 0.04, false},
	{"uranus", "Uranus", "planet", "sun", -195, "gas", 0.03, false},
	{"neptune", "Neptune", "planet", "sun", -200, "gas", 0.04, false},
	{"moon", "Moon", "moon", "earth", -20, "barren", 0.65, true},
	{"phobos", "Phobos", "moon", "mars", -40, "barren", 0.8, true},
	{"deimos", "Deimos", "moon", "mars", -40, "barren", 0.75, true},
	{"io", "Io", "moon", "jupiter", -130, "volcanic", 0.65, true},
	{"europa", "Europa", "moon", "jupiter", -160, "ice", 0.3, true},
	{"ganymede", "Ganymede", "moon", "jupiter", -160, "ice", 0.4, true},
	{"callisto", "Callisto", "moon", "jupiter", -140, "ice", 0.55, true},
	{"titan", "Titan", "moon", "saturn", -180, "hydrocarbon", 0.35, true},
	{"enceladus", "Enceladus", "moon", "saturn", -200, "ice", 0.3, true},
	{"triton", "Triton", "moon", "neptune", -235, "ice", 0.4, true},
	// First six asteroids in Landnam's target list, including near-Earth objects.
	{"eros", "Eros", "asteroid", "sun", -40, "stony", 0.85, true},
	{"vesta", "Vesta", "asteroid", "sun", -85, "stony", 0.65, true},
	{"itokawa", "Itokawa", "asteroid", "sun", -50, "stony", 0.9, true},
	{"ryugu", "Ryugu", "asteroid", "sun", -50, "carbon", 0.8, true},
	{"psyche", "Psyche", "asteroid", "sun", -100, "metallic", 0.7, true},
	{"bennu", "Bennu", "asteroid", "sun", -35, "carbon", 0.85, true},
	{"ceres", "Ceres", "asteroid", "sun", -105, "carbon", 0.55, true},
	{"lutetia", "Lutetia", "asteroid", "sun", -75, "stony", 0.75, true},
}

func SolarProfiles() []SolarProfile { return append([]SolarProfile(nil), solarProfiles...) }
func SolarProfileByID(id string) (SolarProfile, error) {
	for _, p := range solarProfiles {
		if p.ID == id {
			return p, nil
		}
	}
	return SolarProfile{}, fmt.Errorf("takeon: unknown solar profile %q", id)
}

// SolarSample is the common planetary and surface representation. Elevation is
// dimensionless visual relief; temperature and biomes are stylized game values.
type SolarSample struct {
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Elevation   float64 `json:"elevation"`
	Temperature float64 `json:"temperatureC"`
	Biome       string  `json:"biome"`
}

func solarNoise(x, y, z float64, seed int64) float64 {
	x0, y0, z0 := math.Floor(x), math.Floor(y), math.Floor(z)
	smooth := func(t float64) float64 { return t * t * (3 - 2*t) }
	lerp := func(a, b, t float64) float64 { return a + (b-a)*t }
	tx, ty, tz := smooth(x-x0), smooth(y-y0), smooth(z-z0)
	a := lerp(lerp(hash3(x0, y0, z0, seed), hash3(x0+1, y0, z0, seed), tx), lerp(hash3(x0, y0+1, z0, seed), hash3(x0+1, y0+1, z0, seed), tx), ty)
	b := lerp(lerp(hash3(x0, y0, z0+1, seed), hash3(x0+1, y0, z0+1, seed), tx), lerp(hash3(x0, y0+1, z0+1, seed), hash3(x0+1, y0+1, z0+1, seed), tx), ty)
	return lerp(a, b, tz)
}

// SampleSolarBody samples a continuous seeded spherical field; it wraps at the
// dateline and converges at the poles. Latitude and longitude are in degrees.
func SampleSolarBody(id string, seed uint32, latitude, longitude float64) (SolarSample, error) {
	p, err := SolarProfileByID(id)
	if err != nil {
		return SolarSample{}, err
	}
	if math.IsNaN(latitude) || math.IsInf(latitude, 0) || latitude < -90 || latitude > 90 || math.IsNaN(longitude) || math.IsInf(longitude, 0) || longitude < -180 || longitude > 180 {
		return SolarSample{}, fmt.Errorf("takeon: invalid latitude or longitude")
	}
	lat, lon := latitude*math.Pi/180, longitude*math.Pi/180
	x, y, z := math.Cos(lat)*math.Cos(lon), math.Sin(lat), math.Cos(lat)*math.Sin(lon)
	// Domain-separate each body so a shared campaign seed never clones terrain.
	h := fnv.New32a()
	_, _ = h.Write([]byte(p.ID))
	bodySeed := seed ^ h.Sum32()
	n, amp, total := 0.0, 1.0, 0.0
	for octave := 0; octave < 4; octave++ {
		freq := float64(uint(1)<<octave) * 2
		n += solarNoise(x*freq+7, y*freq+7, z*freq+7, int64(bodySeed)+int64(octave)*101) * amp
		total += amp
		amp *= 0.5
	}
	n /= total
	elevation := (n - 0.5) * p.Relief
	temperature := p.Temperature - 35*math.Abs(y) - 20*math.Max(0, elevation)
	biome := solarBiome(p, temperature, n, y)
	return SolarSample{Latitude: latitude, Longitude: longitude, Elevation: elevation, Temperature: temperature, Biome: biome}, nil
}
func solarBiome(p SolarProfile, temp, n, latitude float64) string {
	switch p.Climate {
	case "gas":
		if math.Sin(latitude*22) > 0 {
			return "cloud-band"
		}
		return "storm-band"
	case "temperate":
		if n < 0.43 {
			return "ocean"
		}
		if temp < -10 {
			return "ice"
		}
		if temp < 2 {
			return "tundra"
		}
		if n > 0.67 {
			return "highlands"
		}
		if temp > 24 {
			return "drylands"
		}
		return "grassland"
	case "desert":
		if temp < -70 && n > 0.62 {
			return "ice"
		}
		if n > 0.62 {
			return "highlands"
		}
		return "red-desert"
	case "volcanic":
		if n > 0.64 {
			return "volcanic-highlands"
		}
		return "sulfur-plains"
	case "ice":
		if n > 0.62 {
			return "ice-ridges"
		}
		return "icefield"
	case "hydrocarbon":
		if n < 0.42 {
			return "methane-lakes"
		}
		if n > 0.62 {
			return "ice-ridges"
		}
		return "dunes"
	case "carbon":
		if n > 0.62 {
			return "rubble-highlands"
		}
		return "dark-regolith"
	case "metallic":
		if n > 0.62 {
			return "metal-ridges"
		}
		return "metal-regolith"
	default:
		if n > 0.62 {
			return "crater-highlands"
		}
		return "regolith"
	}
}

// SampleSolarPatch returns row-major samples on an evenly spaced lat/lon grid.
// All points use the same field as the globe. Patches do not wrap across poles.
func SampleSolarPatch(id string, seed uint32, south, west, step float64, width, height int) ([]SolarSample, error) {
	if width < 1 || height < 1 || width > 256 || height > 256 || math.IsNaN(step) || math.IsInf(step, 0) || step <= 0 {
		return nil, fmt.Errorf("takeon: invalid patch dimensions or step")
	}
	p, err := SolarProfileByID(id)
	if err != nil {
		return nil, err
	}
	if !p.Landable {
		return nil, fmt.Errorf("takeon: %s has no landable surface", id)
	}
	out := make([]SolarSample, 0, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			lat, lon := south+float64(y)*step, west+float64(x)*step
			if math.IsNaN(lon) || math.IsInf(lon, 0) || lon < -180 || lon > 180 {
				return nil, fmt.Errorf("takeon: patch longitude out of range")
			}
			s, e := SampleSolarBody(id, seed, lat, lon)
			if e != nil {
				return nil, e
			}
			out = append(out, s)
		}
	}
	return out, nil
}
