package takeon

import (
	"bytes"
	_ "embed"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"sync"
)

// NASA SVS CGI Moon Kit: LRO LOLA 4 pixels/degree elevation and 2K LROC
// colour mosaic. https://svs.gsfc.nasa.gov/4720/
//
//go:embed data/lunar/ldem_4_uint.png
var lunarElevationPNG []byte

//go:embed data/lunar/lroc_color_2k.jpg
var lunarColorJPG []byte
var lunarOnce sync.Once
var lunarElevation, lunarColor image.Image
var lunarErr error

// LunarSurfaceSample is a visualization of NASA LRO observations, not a game
// survey or a new research finding. Elevation is relative to 1,737,400 m.
type LunarSurfaceSample struct {
	ElevationMeters float64 `json:"elevationMeters"`
	Red             float64 `json:"red"`
	Green           float64 `json:"green"`
	Blue            float64 `json:"blue"`
}

func loadLunar() {
	lunarElevation, _, lunarErr = image.Decode(bytes.NewReader(lunarElevationPNG))
	if lunarErr != nil {
		return
	}
	lunarColor, _, lunarErr = image.Decode(bytes.NewReader(lunarColorJPG))
}
func lunarPixel(im image.Image, lat, lon float64) (float64, float64, float64) {
	bounds := im.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	// Maps are equirectangular, centered on 0°, with north at the top.
	x := (lon+180)/360*float64(w) - .5
	y := (90-lat)/180*float64(h) - .5
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	fx, fy := x-float64(x0), y-float64(y0)
	sample := func(x, y int) (float64, float64, float64) {
		x = (x%w + w) % w
		if y < 0 {
			y = 0
		}
		if y >= h {
			y = h - 1
		}
		r, g, b, _ := im.At(bounds.Min.X+x, bounds.Min.Y+y).RGBA()
		return float64(r), float64(g), float64(b)
	}
	r0, g0, b0 := sample(x0, y0)
	r1, g1, b1 := sample(x0+1, y0)
	r2, g2, b2 := sample(x0, y0+1)
	r3, g3, b3 := sample(x0+1, y0+1)
	mix := func(a, b, c, d float64) float64 { return ((a*(1-fx)+b*fx)*(1-fy) + (c*(1-fx)+d*fx)*fy) / 65535 }
	return mix(r0, r1, r2, r3), mix(g0, g1, g2, g3), mix(b0, b1, b2, b3)
}
func SampleLunarSurface(lat, lon float64) (LunarSurfaceSample, error) {
	if math.IsNaN(lat) || math.IsInf(lat, 0) || lat < -90 || lat > 90 || math.IsNaN(lon) || math.IsInf(lon, 0) || lon < -180 || lon > 180 {
		return LunarSurfaceSample{}, fmt.Errorf("takeon: invalid latitude or longitude")
	}
	lunarOnce.Do(loadLunar)
	if lunarErr != nil {
		return LunarSurfaceSample{}, lunarErr
	}
	elevation, _, _ := lunarPixel(lunarElevation, lat, lon)
	r, g, b := lunarPixel(lunarColor, lat, lon)
	return LunarSurfaceSample{elevation*65535*.5 - 10000, r, g, b}, nil
}
