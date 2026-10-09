package takeon

import (
	"fmt"
	"math"
)

type crater struct{ cx, cy, r, depth float64 }

// GenerateTerrain mirrors world/terrain.ts generateTerrain. DEM patches are
// empty in the engine snapshot this was ported from (generated.ts is a stub),
// so the procedural fallback is the only path — same as the TS build.
func GenerateTerrain(body *Body, seed int64) (*VoxelWorld, error) {
	if len(body.Terrain.Bands) > 0 && string(body.Terrain.Bands) != "null" {
		return nil, fmt.Errorf("%w: ore bands", ErrUnsupported)
	}
	size, maxH := body.Size, body.MaxHeight
	world := NewVoxelWorld(size, maxH)
	t := body.Terrain
	rng := NewMulberry32(int64(uint32(int32(seed) ^ 0x51ab)))

	var craters []crater
	for i := 0; float64(i) < t.Craters; i++ {
		c := crater{}
		c.cx = float64(rng.Next() * float64(size))
		c.cy = float64(rng.Next() * float64(size))
		c.r = 4 + float64(rng.Next()*(float64(size)/9))
		c.depth = 2 + float64(rng.Next()*3)
		craters = append(craters, c)
	}

	freq := 0.035 + float64(t.Roughness*0.03)
	half := float64(size) / 2
	var field func(x, y float64) float64
	if t.Noise != nil {
		f, err := MakeNoise(t.Noise, seed)
		if err != nil {
			return nil, err
		}
		field = f
	}

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			fx, fy := float64(x), float64(y)
			if t.Irregular {
				dx := (fx - half) / half
				dy := (fy - half) / half
				rr := math.Sqrt(float64(dx*dx) + float64(dy*dy))
				wobble := float64(fbm2(float64(fx*0.05), float64(fy*0.05), seed+7, 3) * 0.35)
				if rr > (0.82-float64(wobble*0.5))+wobble {
					continue
				}
			}
			var n float64
			if field != nil {
				n = field(fx, fy)
			} else {
				n = fbm2(float64(fx*freq), float64(fy*freq), seed, 4)
				n = float64(n*0.65) + float64(fbm2(float64(float64(fx*freq)*0.25), float64(float64(fy*freq)*0.25), seed+55, 2)*0.35)
			}
			h := 1 + float64(float64(n*float64(maxH-3))*(0.45+float64(t.Roughness*0.55)))

			for _, c := range craters {
				d := jsHypot(fx-c.cx, fy-c.cy)
				if d < c.r {
					f := d / c.r
					bowl := float64(-c.depth * (1 - float64(f*f)))
					rim := 0.0
					if f > 0.75 {
						rim = float64(float64(float64(f-0.75)*4)*c.depth) * 0.35
					}
					h += bowl + rim
				}
			}

			height := int(math.Max(1, math.Min(float64(maxH-2), jsRound(h))))

			edge := y
			if size-1-y < edge {
				edge = size - 1 - y
			}
			edgeDist := float64(edge) / float64(size)
			icy := t.IceCaps > 0 && edgeDist < float64(float64(t.IceCaps*0.5)*(0.7+float64(fbm2(float64(fx*0.08), float64(fy*0.08), seed+91, 2)*0.6)))
			sulfurous := t.SulfurFields > 0 && fbm2(float64(fx*0.07), float64(fy*0.07), seed+313, 3) > 1-float64(t.SulfurFields*0.55)

			for z := 0; z <= height; z++ {
				world.setRaw(x, y, z, pickMaterial(body, x, y, z, height, icy, sulfurous, seed))
			}
		}
	}
	return world, nil
}

func pickMaterial(body *Body, x, y, z, surface int, icy, sulfurous bool, seed int64) int {
	depth := surface - z
	t := body.Terrain
	fx, fy, fz := float64(x), float64(y), float64(z)

	if depth >= 1 {
		v := hash3(float64(x>>1), float64(y>>1), fz, seed+17)
		rich := t.OreRichness
		if v > 1-float64(rich*0.055) && depth >= 3 {
			return Crystal
		}
		if v > 1-float64(rich*0.16) {
			iron, copper, titanium := 0.45, 0.3, 0.25
			if m := body.Minerals; m != nil {
				if m.Iron != nil {
					iron = *m.Iron
				}
				if m.Copper != nil {
					copper = *m.Copper
				}
				if m.Titanium != nil {
					titanium = *m.Titanium
				}
			}
			total := iron + copper + titanium
			if total == 0 {
				total = 1
			}
			pick := float64(hash3(fx, fy, fz, seed+23) * total)
			if pick < iron {
				return IronOre
			}
			if pick < iron+copper {
				return CopperOre
			}
			return TitaniumOre
		}
	}

	if icy && depth <= 2 {
		return Ice
	}
	if sulfurous && depth == 0 {
		return Sulfur
	}
	if depth == 0 {
		if t.Biomes {
			b := biomeAt(body, x, y, seed)
			return pickBiomeMaterial(b.surface, fbm2(float64(fx*0.055), float64(fy*0.055), seed+5, 3))
		}
		patch := fbm2(float64(fx*0.055), float64(fy*0.055), seed+5, 3)
		if patch > 0.66 {
			return Silica
		}
		if patch < 0.38 || z <= 2 {
			return Dust
		}
		return Regolith
	}
	if depth <= 2 {
		if t.Biomes {
			b := biomeAt(body, x, y, seed)
			sub := b.subsurface
			if sub == nil {
				sub = b.surface
			}
			return pickBiomeMaterial(sub, fbm2(float64(fx*0.055), float64(fy*0.055), seed+9, 3))
		}
		return Regolith
	}
	if depth <= 5 {
		return Rock
	}
	return Basalt
}

type Vec2 struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// FindLandingSite mirrors terrain.ts findLandingSite.
func FindLandingSite(w *VoxelWorld) Vec2 {
	c := w.Size / 2
	best := Vec2{c, c}
	bestScore := math.Inf(1)
	abs := func(a int) int {
		if a < 0 {
			return -a
		}
		return a
	}
	for r := 0; float64(r) < float64(w.Size)/2; r++ {
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				if max(abs(dx), abs(dy)) != r {
					continue
				}
				x, y := c+dx, c+dy
				if !w.IsSolid(x, y) {
					continue
				}
				h := w.Height(x, y)
				rough := 0
				ok := true
			neigh:
				for oy := -1; oy <= 1; oy++ {
					for ox := -1; ox <= 1; ox++ {
						hh := w.Height(x+ox, y+oy)
						if hh < 0 {
							ok = false
							break neigh
						}
						rough += abs(hh - h)
					}
				}
				if !ok {
					continue
				}
				if float64(rough) < bestScore {
					bestScore = float64(rough)
					best = Vec2{x, y}
				}
				if rough == 0 {
					return best
				}
			}
		}
		if bestScore <= 2 {
			return best
		}
	}
	return best
}
