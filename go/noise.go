package takeon

import (
	"errors"
	"math"
)

// Noise library: value, perlin, simplex, worley and the fractal/makeNoise
// stack. Every product that feeds a sum is wrapped in float64(...) to forbid
// FMA fusion (see jsmath.go). Blue noise is not ported (stub).

type sampler func(x, y float64, seed int64) float64

func smooth(t float64) float64 { return float64(t*t) * (3 - float64(2*t)) }

func valueNoise2(x, y float64, seed int64) float64 {
	xi, yi := math.Floor(x), math.Floor(y)
	xf, yf := x-xi, y-yi
	a := hash2(xi, yi, seed)
	b := hash2(xi+1, yi, seed)
	c := hash2(xi, yi+1, seed)
	d := hash2(xi+1, yi+1, seed)
	u, v := smooth(xf), smooth(yf)
	return a + float64((b-a)*u) + float64((c-a)*v) + float64(float64((a-b-c+d)*u)*v)
}

func fbm2(x, y float64, seed int64, octaves int) float64 {
	return fbm2Full(x, y, seed, octaves, 2, 0.5)
}

func fbm2Full(x, y float64, seed int64, octaves int, lacunarity, gain float64) float64 {
	amp, freq, sum, norm := 1.0, 1.0, 0.0, 0.0
	for i := 0; i < octaves; i++ {
		sum += float64(amp * valueNoise2(float64(x*freq), float64(y*freq), seed+int64(i)*101))
		norm += amp
		amp *= gain
		freq *= lacunarity
	}
	return sum / norm
}

func fade(t float64) float64 {
	return float64(float64(t*t)*t) * (float64(t*(float64(t*6)-15)) + 10)
}

func grad(ix, iy float64, seed int64) (float64, float64) {
	a := float64(hash2(ix, iy, seed)*math.Pi) * 2
	return fcos(a), fsin(a)
}

func perlin2(x, y float64, seed int64) float64 {
	x0, y0 := math.Floor(x), math.Floor(y)
	xf, yf := x-x0, y-y0
	dot := func(ix, iy float64) float64 {
		gx, gy := grad(ix, iy, seed)
		return float64(gx*(x-ix)) + float64(gy*(y-iy))
	}
	u, v := fade(xf), fade(yf)
	n00 := dot(x0, y0)
	n10 := dot(x0+1, y0)
	n01 := dot(x0, y0+1)
	n11 := dot(x0+1, y0+1)
	nx0 := n00 + float64((n10-n00)*u)
	nx1 := n01 + float64((n11-n01)*u)
	n := nx0 + float64((nx1-nx0)*v)
	return fmax(0, fmin(1, float64(n*0.7071)+0.5))
}

var (
	simplexF2 = 0.5 * (math.Sqrt(3) - 1)
	simplexG2 = (3 - math.Sqrt(3)) / 6
)

func simplex2(x, y float64, seed int64) float64 {
	F2, G2 := simplexF2, simplexG2
	s := float64((x + y) * F2)
	i := math.Floor(x + s)
	j := math.Floor(y + s)
	t := float64((i + j) * G2)
	x0 := x - (i - t)
	y0 := y - (j - t)
	var i1, j1 float64
	if x0 > y0 {
		i1, j1 = 1, 0
	} else {
		i1, j1 = 0, 1
	}
	x1 := x0 - i1 + G2
	y1 := y0 - j1 + G2
	x2 := x0 - 1 + float64(2*G2)
	y2 := y0 - 1 + float64(2*G2)
	corner := func(cx, cy, ii, jj float64) float64 {
		t0 := 0.5 - float64(cx*cx) - float64(cy*cy)
		if t0 < 0 {
			return 0
		}
		gx, gy := grad(ii, jj, seed)
		t2 := float64(t0 * t0)
		return float64(t2*t2) * (float64(gx*cx) + float64(gy*cy))
	}
	n := corner(x0, y0, i, j) + corner(x1, y1, i+i1, j+j1) + corner(x2, y2, i+1, j+1)
	return fmax(0, fmin(1, float64(n*35)+0.5))
}

type worleyMode int

const (
	worleyF1 worleyMode = iota
	worleyF2F1
	worleyCells
)

func worley2(x, y float64, seed int64, mode worleyMode) float64 {
	xi, yi := math.Floor(x), math.Floor(y)
	f1, f2 := math.Inf(1), math.Inf(1)
	for dy := -1.0; dy <= 1; dy++ {
		for dx := -1.0; dx <= 1; dx++ {
			cx, cy := xi+dx, yi+dy
			px := cx + hash2(cx, cy, seed)
			py := cy + hash2(cx, cy, seed+8191)
			d := jsHypot(px-x, py-y)
			if d < f1 {
				f2 = f1
				f1 = d
			} else if d < f2 {
				f2 = d
			}
		}
	}
	switch mode {
	case worleyF2F1:
		return clamp01(f2 - f1)
	case worleyCells:
		return clamp01(1 - f1)
	}
	return clamp01(f1)
}

// NoiseConfig mirrors util/noise/config.ts. Nil pointers take the defaults.
type NoiseConfig struct {
	Type       string   `json:"type"`
	Frequency  *float64 `json:"frequency"`
	Octaves    *int     `json:"octaves"`
	Lacunarity *float64 `json:"lacunarity"`
	Gain       *float64 `json:"gain"`
	Fractal    string   `json:"fractal"`
	Warp       *float64 `json:"warp"`
	SeedOffset *int64   `json:"seedOffset"`
}

// ErrUnsupported marks engine features the Go spike does not port.
var ErrUnsupported = errors.New("takeon: not ported in the go spike")

func baseSampler(typ string) (sampler, error) {
	switch typ {
	case "perlin":
		return perlin2, nil
	case "simplex":
		return simplex2, nil
	case "worley":
		return func(x, y float64, s int64) float64 { return worley2(x, y, s, worleyF1) }, nil
	case "worley-cracks":
		return func(x, y float64, s int64) float64 { return worley2(x, y, s, worleyF2F1) }, nil
	case "blue":
		return nil, ErrUnsupported
	case "white":
		return func(x, y float64, s int64) float64 { return hash2(math.Floor(x), math.Floor(y), s) }, nil
	}
	return valueNoise2, nil
}

func fractal2(sample sampler, x, y float64, seed int64, octaves int, lacunarity, gain float64, kind string) float64 {
	amp, freq, sum, norm := 1.0, 1.0, 0.0, 0.0
	n := octaves
	if n < 1 {
		n = 1
	}
	for i := 0; i < n; i++ {
		raw := sample(float64(x*freq), float64(y*freq), seed+int64(i)*101)
		v := raw
		if kind == "ridged" {
			v = 1 - math.Abs(float64(raw*2)-1)
		} else if kind == "billow" {
			v = math.Abs(float64(raw*2) - 1)
		}
		sum += float64(amp * v)
		norm += amp
		amp *= gain
		freq *= lacunarity
	}
	if norm > 0 {
		return sum / norm
	}
	return 0
}

// MakeNoise mirrors makeNoise: tile coordinates in, [0,1] out.
func MakeNoise(cfg *NoiseConfig, seed int64) (func(x, y float64) float64, error) {
	c := NoiseConfig{}
	if cfg != nil {
		c = *cfg
	}
	typ, fractal := c.Type, c.Fractal
	if typ == "" {
		typ = "value"
	}
	if fractal == "" {
		fractal = "fbm"
	}
	f, warp, lac, gain, oct := 0.05, 0.0, 2.0, 0.5, 4
	if c.Frequency != nil {
		f = *c.Frequency
	}
	if c.Warp != nil {
		warp = *c.Warp
	}
	if c.Lacunarity != nil {
		lac = *c.Lacunarity
	}
	if c.Gain != nil {
		gain = *c.Gain
	}
	if c.Octaves != nil {
		oct = *c.Octaves
	}
	s := seed
	if c.SeedOffset != nil {
		s += *c.SeedOffset
	}
	base, err := baseSampler(typ)
	if err != nil {
		return nil, err
	}
	if warp > 0 {
		return func(x, y float64) float64 {
			wx := float64(float64(float64(valueNoise2(float64(float64(x*f)*0.5), float64(float64(y*f)*0.5), s+771)-0.5)*2) * warp)
			wy := float64(float64(float64(valueNoise2(float64(float64(x*f)*0.5)+31.7, float64(float64(y*f)*0.5)-11.3, s+913)-0.5)*2) * warp)
			return fractal2(base, float64((x+wx)*f), float64((y+wy)*f), s, oct, lac, gain, fractal)
		}, nil
	}
	return func(x, y float64) float64 {
		return fractal2(base, float64(x*f), float64(y*f), s, oct, lac, gain, fractal)
	}, nil
}
