package takeon

import "math"

// SolarStyleVersion identifies the fixed parameters of the current visual field.
// Persist this with a seed when using these samples in authored content.
const SolarStyleVersion = 1

// StyledSolarSample is a visual, dimensionless radius, not scientific elevation.
// Observed indicates whether the underlying elevation is measured; the seeded
// relief is always an artistic addition on landable bodies.
type StyledSolarSample struct {
	Radius   float64 `json:"radius"`
	Biome    string  `json:"biome"`
	Observed bool    `json:"observedElevation"`
}

// SampleStyledSolarBody combines the same seeded field used by surface patches
// with observed topography where available. Gas giants retain spherical clouds.
func SampleStyledSolarBody(id string, seed uint32, lat, lon float64) (StyledSolarSample, error) {
	s, err := SampleSolarBody(id, seed, lat, lon)
	if err != nil {
		return StyledSolarSample{}, err
	}
	p, _ := SolarProfileByID(id)
	out := StyledSolarSample{Radius: 1, Biome: s.Biome}
	if !p.Landable {
		return out, nil
	}
	// Approximate irregular bodies with a body-specific ellipsoid. These are
	// artistic proportions, not measured shape models.
	axes := map[string][3]float64{
		"phobos": {1.18, 0.91, 0.91}, "deimos": {1.12, 0.95, 0.94},
		"eros": {1.32, 0.86, 0.80}, "itokawa": {1.36, 0.85, 0.78},
		"vesta": {1.08, 1.02, 0.91}, "ryugu": {1.03, 0.94, 1.03},
		"psyche": {1.19, 0.95, 0.89}, "bennu": {1.03, 0.94, 1.03},
	}
	if a, ok := axes[id]; ok {
		phi, theta := lat*math.Pi/180, lon*math.Pi/180
		x, y, z := math.Cos(phi)*math.Cos(theta), math.Sin(phi), math.Cos(phi)*math.Sin(theta)
		out.Radius = 1 / math.Sqrt(x*x/(a[0]*a[0])+y*y/(a[1]*a[1])+z*z/(a[2]*a[2]))
	}
	// Broad procedural forms are intentionally visible at planet scale.
	out.Radius += s.Elevation * 0.42
	switch id {
	case "moon":
		observed, err := SampleLunarSurface(lat, lon)
		if err != nil {
			return out, err
		}
		out.Radius += 7 * observed.ElevationMeters / 1737400
		out.Observed = true
	case "mars":
		observed, err := SampleObservedSurface(id, lat, lon)
		if err != nil {
			return out, err
		}
		if observed.ElevationMeters != nil {
			out.Radius += 7 * *observed.ElevationMeters / 3389500
			out.Observed = true
		}
	}
	out.Radius = math.Max(0.75, out.Radius)
	return out, nil
}

// SampleStyledSolarPatch uses precisely the globe's visual radius, including
// observed topography and artistic relief. Coordinates follow SampleSolarPatch.
func SampleStyledSolarPatch(id string, seed uint32, south, west, step float64, width, height int) ([]StyledSolarSample, error) {
	base, err := SampleSolarPatch(id, seed, south, west, step, width, height)
	if err != nil {
		return nil, err
	}
	out := make([]StyledSolarSample, len(base))
	for i, point := range base {
		out[i], err = SampleStyledSolarBody(id, seed, point.Latitude, point.Longitude)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
