package takeon

import (
	_ "embed"
	"encoding/json"
	"math"
	"sort"
)

const chunkSize = 16

type biome struct {
	ID         string      `json:"id"`
	Surface    []int       `json:"surface"`
	Subsurface []int       `json:"subsurface"`
	Climate    *[2]float64 `json:"climate"`
}

// biomeRegistry is in TS registration order (used only when a body has no kind).
//
//go:embed data/biomes.json
var biomesJSON []byte
var biomeRegistry []biome

func init() {
	var raw []struct {
		ID         string                      `json:"id"`
		Surface    []int                       `json:"surface"`
		Subsurface []int                       `json:"subsurface"`
		Climate    *struct{ Min, Max float64 } `json:"climate"`
	}
	if err := json.Unmarshal(biomesJSON, &raw); err != nil {
		panic(err)
	}
	for _, v := range raw {
		b := biome{ID: v.ID, Surface: v.Surface, Subsurface: v.Subsurface}
		if v.Climate != nil {
			b.Climate = &[2]float64{v.Climate.Min, v.Climate.Max}
		}
		biomeRegistry = append(biomeRegistry, b)
	}
}

// kindBiomes mirrors world/kinds.ts allowedBiomes for the built-in kinds that
// declare any (parents without one — body/planet/moon/asteroid — are unrestricted).
var kindBiomes = map[string][]string{
	"rocky-planet":    {"redrock-desert", "crater-highlands", "dust-basin", "frozen-tundra"},
	"earth-like":      {"grassland-plains", "temperate-forest", "frozen-tundra", "redrock-desert"},
	"gaseous":         {"cloud-platform"},
	"rocky-moon":      {"crater-highlands", "dust-basin", "metallic-regolith"},
	"ice-moon":        {"icefield", "cryovolcanic"},
	"c-type-asteroid": {"carbonaceous-rubble", "icefield"},
	"m-type-asteroid": {"metallic-regolith"},
	"s-type-asteroid": {"carbonaceous-rubble", "metallic-regolith"},
}

func findBiome(id string) *biome {
	for i := range biomeRegistry {
		if biomeRegistry[i].ID == id {
			return &biomeRegistry[i]
		}
	}
	return nil
}

// chunkBiome mirrors biomes.ts chunkBiome. Sorting is by byte order; the TS
// uses localeCompare, which agrees for the built-in ids (distinct leading
// letters within every pool) — the terrain parity vectors confirm it.
func chunkBiome(b *Body, cx, cy int, seed int64) *biome {
	registry := biomeRegistry
	if len(b.CoreBiomes) > 0 {
		registry = b.CoreBiomes
	}
	find := func(id string) *biome {
		for i := range registry {
			if registry[i].ID == id {
				return &registry[i]
			}
		}
		return nil
	}

	var pool []*biome
	ids, ok := kindBiomes[b.Kind]
	if b.CoreAllowedBiomes != nil {
		ids = *b.CoreAllowedBiomes
		ok = true
	}
	if ok && b.Kind != "" {
		for _, id := range ids {
			if bi := find(id); bi != nil {
				pool = append(pool, bi)
			}
		}
	} else {
		for i := range registry {
			pool = append(pool, &registry[i])
		}
	}
	if len(pool) == 0 {
		for i := range registry {
			pool = append(pool, &registry[i])
		}
	}
	if c := b.Climate; c != nil {
		variance := 0.5
		if c.TempVariance != nil {
			variance = *c.TempVariance
		}
		swing := variance * 60
		t := c.Temperature + float64(float64(hash2(float64(cx), float64(cy), seed+401)*2)-1)*swing
		var fits []*biome
		for _, bi := range pool {
			if bi.Climate == nil || (t >= bi.Climate[0] && t <= bi.Climate[1]) {
				fits = append(fits, bi)
			}
		}
		if len(fits) > 0 {
			pool = fits
		}
	}
	sorted := append([]*biome(nil), pool...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	idx := int(math.Floor(float64(hash2(float64(cx), float64(cy), seed+977) * float64(len(sorted)))))
	if idx > len(sorted)-1 {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func biomeAt(b *Body, x, y int, seed int64) *biome {
	return chunkBiome(b, int(math.Floor(float64(x)/chunkSize)), int(math.Floor(float64(y)/chunkSize)), seed)
}

func pickBiomeMaterial(mats []int, t float64) int {
	if len(mats) == 0 {
		return Regolith
	}
	idx := int(math.Floor(float64(t * float64(len(mats)))))
	if idx < 0 {
		idx = 0
	}
	if idx > len(mats)-1 {
		idx = len(mats) - 1
	}
	return mats[idx]
}
