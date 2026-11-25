package takeon

import (
	"fmt"
	"math"
)

// ObservedPatch is a sampled global image, not a complete physical model.
// Elevation is nil where no registered elevation data is bundled.
type ObservedPatch struct {
	BodyID  string                  `json:"bodyId"`
	Width   int                     `json:"width"`
	Height  int                     `json:"height"`
	Samples []ObservedSurfaceSample `json:"samples"`
}

func SampleObservedPatch(id string, lat, lon, step float64, width, height int) (ObservedPatch, error) {
	if width < 1 || width > 255 || height < 1 || height > 255 || width%2 != 1 || height%2 != 1 || math.IsNaN(step) || math.IsInf(step, 0) || step <= 0 || step > 180 || math.IsNaN(lat) || math.IsInf(lat, 0) || math.IsNaN(lon) || math.IsInf(lon, 0) || lon < -180 || lon > 180 || lat-step*float64(height/2) < -90 || lat+step*float64(height/2) > 90 || step*float64(width-1) >= 360 {
		return ObservedPatch{}, fmt.Errorf("takeon: invalid observed patch")
	}
	out := ObservedPatch{BodyID: id, Width: width, Height: height, Samples: make([]ObservedSurfaceSample, 0, width*height)}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			plat := lat + float64(y-height/2)*step
			plon := math.Mod(lon+float64(x-width/2)*step+180, 360)
			if plon < 0 {
				plon += 360
			}
			plon -= 180
			var s ObservedSurfaceSample
			if id == "moon" {
				lunar, err := SampleLunarSurface(plat, plon)
				if err != nil {
					return ObservedPatch{}, err
				}
				elevation := lunar.ElevationMeters
				s = ObservedSurfaceSample{Red: lunar.Red, Green: lunar.Green, Blue: lunar.Blue, ElevationMeters: &elevation}
			} else {
				var err error
				s, err = SampleObservedSurface(id, plat, plon)
				if err != nil {
					return ObservedPatch{}, err
				}
			}
			out.Samples = append(out.Samples, s)
		}
	}
	return out, nil
}
