package takeon

import (
	"math"
	"sort"
	"strconv"
)

type OreBand struct {
	From     float64            `json:"from"`
	To       float64            `json:"to"`
	Minerals map[string]float64 `json:"minerals"`
}
type DEM struct {
	Size    int       `json:"size"`
	Heights []float64 `json:"heights"`
}

func sampleDEM(p *DEM, u, v float64) float64 {
	s := p.Size
	x := fmin(float64(s)-1.001, fmax(0, u*float64(s-1)))
	y := fmin(float64(s)-1.001, fmax(0, v*float64(s-1)))
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	fx, fy := x-float64(x0), y-float64(y0)
	a, b, c, d := p.Heights[y0*s+x0], p.Heights[y0*s+x0+1], p.Heights[(y0+1)*s+x0], p.Heights[(y0+1)*s+x0+1]
	return a + float64((b-a)*fx) + float64((c-a)*fy) + float64(float64((a-b-c+d)*fx)*fy)
}
func pickOreBand(bands []OreBand, depth, surface int, x, y, z int, seed int64) (int, bool) {
	frac := float64(depth) / float64(surface)
	for _, band := range bands {
		if frac < band.From || frac > band.To {
			continue
		}
		ids := []int{}
		for id := range band.Minerals {
			i, err := strconv.Atoi(id)
			if err == nil {
				ids = append(ids, i)
			}
		}
		sort.Ints(ids)
		total := 0.0
		for _, id := range ids {
			total += band.Minerals[strconv.Itoa(id)]
		}
		if total <= 0 {
			return IronOre, true
		}
		roll := hash3(float64(x), float64(y), float64(z), seed+23) * total
		acc := 0.0
		for _, id := range ids {
			acc += band.Minerals[strconv.Itoa(id)]
			if roll < acc {
				return id, true
			}
		}
		return ids[len(ids)-1], true
	}
	return 0, false
}

// SelectBiome exposes the canonical chunk choice to host render/authoring tools.
func SelectBiome(body *Body, cx, cy int, seed int64) string { return chunkBiome(body, cx, cy, seed).ID }
