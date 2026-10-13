package takeon

import (
	"math"
	"sort"
)

const chunkSize = 16

type biome struct {
	id         string
	surface    []int
	subsurface []int // nil = same as surface
	climate    *[2]float64
}

// biomeRegistry is in TS registration order (used only when a body has no kind).
var biomeRegistry = []biome{
	{id: "dust-basin", surface: []int{Dust}, subsurface: []int{Regolith}},
	{id: "redrock-desert", surface: []int{Regolith, Dust}},
	{id: "crater-highlands", surface: []int{Rock, Regolith}},
	{id: "frozen-tundra", surface: []int{Snow, Regolith}, subsurface: []int{Ice, Regolith}, climate: &[2]float64{-999, -10}},
	{id: "grassland-plains", surface: []int{Grass}, climate: &[2]float64{0, 32}},
	{id: "temperate-forest", surface: []int{Grass, Rock}, climate: &[2]float64{-5, 26}},
	{id: "icefield", surface: []int{Ice, Snow}},
	{id: "cryovolcanic", surface: []int{Ice, Sulfur}},
	{id: "carbonaceous-rubble", surface: []int{Basalt, Dust}},
	{id: "metallic-regolith", surface: []int{Regolith, Rock}},
	{id: "cloud-platform", surface: []int{Basalt, Rock}},
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
		if biomeRegistry[i].id == id {
			return &biomeRegistry[i]
		}
	}
	return nil
}

// chunkBiome mirrors biomes.ts chunkBiome. Sorting is by byte order; the TS
// uses localeCompare, which agrees for the built-in ids (distinct leading
// letters within every pool) — the terrain parity vectors confirm it.
func chunkBiome(b *Body, cx, cy int, seed int64) *biome {
	var pool []*biome
	if ids, ok := kindBiomes[b.Kind]; ok && b.Kind != "" {
		for _, id := range ids {
			if bi := findBiome(id); bi != nil {
				pool = append(pool, bi)
			}
		}
	} else {
		for i := range biomeRegistry {
			pool = append(pool, &biomeRegistry[i])
		}
	}
	if len(pool) == 0 {
		for i := range biomeRegistry {
			pool = append(pool, &biomeRegistry[i])
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
			if bi.climate == nil || (t >= bi.climate[0] && t <= bi.climate[1]) {
				fits = append(fits, bi)
			}
		}
		if len(fits) > 0 {
			pool = fits
		}
	}
	sorted := append([]*biome(nil), pool...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].id < sorted[j].id })
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
