package takeon

import (
	"fmt"
	"math"
)

// SolarLanding is a renderer-independent orbit-to-surface handoff. The center
// and patch are sampled from the same field as the orbital globe; the host owns
// the camera animation, terrain streaming and playable voxel scene.
type SolarLanding struct {
	StyleVersion int                 `json:"styleVersion"`
	BodyID       string              `json:"bodyId"`
	Seed         uint32              `json:"seed"`
	Latitude     float64             `json:"latitude"`
	Longitude    float64             `json:"longitude"`
	Center       StyledSolarSample   `json:"center"`
	Up           [3]float64          `json:"up"`
	East         [3]float64          `json:"east"`
	North        [3]float64          `json:"north"`
	StepDegrees  float64             `json:"stepDegrees"`
	Width        int                 `json:"width"`
	Height       int                 `json:"height"`
	Patch        []StyledSolarSample `json:"patch"`
}

// PrepareSolarLanding samples a centered, eastward row-major patch. It wraps
// across the dateline and rejects patches crossing a pole, where a lat/lon
// grid becomes singular. It never creates a surface on a gas giant.
func PrepareSolarLanding(id string, seed uint32, lat, lon, step float64, width, height int) (SolarLanding, error) {
	p, err := SolarProfileByID(id)
	if err != nil {
		return SolarLanding{}, err
	}
	if !p.Landable {
		return SolarLanding{}, fmt.Errorf("takeon: %s has no landable surface", id)
	}
	if width < 1 || width > 255 || height < 1 || height > 255 || width%2 != 1 || height%2 != 1 || math.IsNaN(step) || math.IsInf(step, 0) || step <= 0 || step > 180 {
		return SolarLanding{}, fmt.Errorf("takeon: landing grid needs odd dimensions up to 255 and a valid step")
	}
	center, err := SampleStyledSolarBody(id, seed, lat, lon)
	if err != nil {
		return SolarLanding{}, err
	}
	if lat-step*float64(height/2) < -90 || lat+step*float64(height/2) > 90 || step*float64(width-1) >= 360 {
		return SolarLanding{}, fmt.Errorf("takeon: landing patch crosses a pole or wraps the globe")
	}
	phi, theta := lat*math.Pi/180, lon*math.Pi/180
	cp, sp, ct, st := math.Cos(phi), math.Sin(phi), math.Cos(theta), math.Sin(theta)
	out := SolarLanding{StyleVersion: SolarStyleVersion, BodyID: id, Seed: seed, Latitude: lat, Longitude: lon, Center: center,
		Up: [3]float64{cp * ct, sp, cp * st}, East: [3]float64{-st, 0, ct}, North: [3]float64{-sp * ct, cp, -sp * st},
		StepDegrees: step, Width: width, Height: height, Patch: make([]StyledSolarSample, 0, width*height)}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			plat := lat + float64(y-height/2)*step
			plon := math.Mod(lon+float64(x-width/2)*step+180, 360)
			if plon < 0 {
				plon += 360
			}
			plon -= 180
			if x == width/2 && y == height/2 {
				out.Patch = append(out.Patch, center)
				continue
			}
			point, err := SampleStyledSolarBody(id, seed, plat, plon)
			if err != nil {
				return SolarLanding{}, err
			}
			out.Patch = append(out.Patch, point)
		}
	}
	return out, nil
}
