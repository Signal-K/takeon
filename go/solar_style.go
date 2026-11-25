package takeon

import "math"

// StyledSolarSample is a visual, dimensionless radius, not scientific elevation.
// Observed indicates whether the underlying elevation is measured; the seeded
// relief is always an artistic addition on landable bodies.
type StyledSolarSample struct {
	Radius   float64
	Biome    string
	Observed bool
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
