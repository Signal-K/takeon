package takeon

import (
	"bytes"
	"fmt"
	"image"
	"math"
	"sync"
)

// NASA/JPL planetary image textures and the NASA PDS MOLA MEGDR topography.
// See docs/solar-biomes.md for provenance and limitations.
//
type ObservedSurfaceSample struct {
	Red             float64  `json:"red"`
	Green           float64  `json:"green"`
	Blue            float64  `json:"blue"`
	ElevationMeters *float64 `json:"elevationMeters,omitempty"`
}

var observedIDs = map[string]bool{"earth": true, "mercury": true, "mars": true, "venus": true, "jupiter": true, "saturn": true, "neptune": true}
var planetaryOnce sync.Once
var planetaryImages map[string]image.Image
var planetaryErr error

func loadPlanetary() {
	planetaryImages = make(map[string]image.Image)
	for id := range observedIDs {
		b, err := planetaryFiles.ReadFile("data/planetary/" + id + ".jpg")
		if err != nil {
			planetaryErr = err
			return
		}
		im, _, err := image.Decode(bytes.NewReader(b))
		if err != nil {
			planetaryErr = err
			return
		}
		planetaryImages[id] = im
	}
	b, err := planetaryFiles.ReadFile("data/planetary/mars_mola.png")
	if err != nil {
		planetaryErr = err
		return
	}
	planetaryImages["mars_height"], _, planetaryErr = image.Decode(bytes.NewReader(b))
}

// SampleObservedSurface returns observed imagery, and elevation where available.
// Other bodies do not have an observed map in this dataset. The gas-giant
// images depict cloud tops, not terrain. Latitude/longitude are degrees east.
func SampleObservedSurface(id string, lat, lon float64) (ObservedSurfaceSample, error) {
	if !observedIDs[id] {
		return ObservedSurfaceSample{}, fmt.Errorf("takeon: no observed surface map for %q", id)
	}
	if math.IsNaN(lat) || math.IsInf(lat, 0) || lat < -90 || lat > 90 || math.IsNaN(lon) || math.IsInf(lon, 0) || lon < -180 || lon > 180 {
		return ObservedSurfaceSample{}, fmt.Errorf("takeon: invalid latitude or longitude")
	}
	planetaryOnce.Do(loadPlanetary)
	if planetaryErr != nil {
		return ObservedSurfaceSample{}, planetaryErr
	}
	r, g, b := lunarPixel(planetaryImages[id], lat, lon)
	s := ObservedSurfaceSample{Red: r, Green: g, Blue: b}
	if id == "mars" {
		v, _, _ := lunarPixel(planetaryImages["mars_height"], lat, lon)
		meters := v*65535 - 32768
		s.ElevationMeters = &meters
	}
	return s, nil
}
