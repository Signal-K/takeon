package takeon

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
)

// bodies.json and parts.json are dumped from the TS engine's BODIES / PARTS by
// packages/engine/scripts/golden.ts, so the catalog is single-sourced.

//go:embed data/bodies.json
var bodiesJSON []byte

//go:embed data/parts.json
var partsJSON []byte

// RateEntry is one weather type with its expected-events rate. Order matters:
// the sim rolls them in object-insertion order and each roll consumes RNG.
type RateEntry struct {
	Type string
	Rate float64
}

type Rates []RateEntry

func (r *Rates) UnmarshalJSON(b []byte) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	if _, err := dec.Token(); err != nil { // {
		return err
	}
	for dec.More() {
		k, err := dec.Token()
		if err != nil {
			return err
		}
		var v float64
		if err := dec.Decode(&v); err != nil {
			return err
		}
		*r = append(*r, RateEntry{k.(string), v})
	}
	return nil
}

type Minerals struct {
	Iron     *float64 `json:"iron"`
	Copper   *float64 `json:"copper"`
	Titanium *float64 `json:"titanium"`
}

type Climate struct {
	Temperature  float64  `json:"temperature"`
	TempVariance *float64 `json:"tempVariance"`
}

type TerrainDef struct {
	Roughness    float64         `json:"roughness"`
	Craters      float64         `json:"craters"`
	IceCaps      float64         `json:"iceCaps"`
	OreRichness  float64         `json:"oreRichness"`
	Irregular    bool            `json:"irregular"`
	Biomes       bool            `json:"biomes"`
	SulfurFields float64         `json:"sulfurFields"`
	Noise        *NoiseConfig    `json:"noise"`
	Bands        json.RawMessage `json:"bands"`
}

type Body struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Kind      string     `json:"kind"`
	Gravity   float64    `json:"gravity"`
	SolarFlux float64    `json:"solarFlux"`
	DayLength float64    `json:"dayLength"`
	DeltaV    float64    `json:"deltaV"`
	Size      int        `json:"size"`
	MaxHeight int        `json:"maxHeight"`
	Seed      int64      `json:"seed"`
	DEM       string     `json:"dem"`
	Minerals  *Minerals  `json:"minerals"`
	Climate   *Climate   `json:"climate"`
	Terrain   TerrainDef `json:"terrain"`
	Weather   Rates      `json:"weather"`
}

type Part struct {
	ID       string             `json:"id"`
	Category string             `json:"category"`
	Mass     float64            `json:"mass"`
	Cost     float64            `json:"cost"`
	Stats    map[string]float64 `json:"stats"`
}

var (
	Bodies []Body
	Parts  []Part
)

func init() {
	if err := json.Unmarshal(bodiesJSON, &Bodies); err != nil {
		panic(err)
	}
	if err := json.Unmarshal(partsJSON, &Parts); err != nil {
		panic(err)
	}
}

// GetBody resolves a built-in body id (runtime registration is not ported).
func GetBody(id string) (*Body, error) {
	for i := range Bodies {
		if Bodies[i].ID == id {
			return &Bodies[i], nil
		}
	}
	return nil, fmt.Errorf("takeon: unknown body %q", id)
}

// Material ids (types.ts).
const (
	Air = iota
	Regolith
	Rock
	Basalt
	Ice
	IronOre
	Silica
	CopperOre
	TitaniumOre
	Crystal
	Dust
	Sulfur
	Grass
	Sand
	Snow
)

type materialDef struct {
	Hardness float64
	Resource string
	Amount   float64
}

// materials mirrors world/materials.ts (hardness + yield only).
var materials = [...]materialDef{
	Air:         {0, "", 0},
	Regolith:    {2, "regolith", 1},
	Rock:        {4, "stone", 1},
	Basalt:      {6, "stone", 2},
	Ice:         {3, "ice", 2},
	IronOre:     {5, "iron", 2},
	Silica:      {2, "silica", 2},
	CopperOre:   {5, "copper", 2},
	TitaniumOre: {7, "titanium", 1},
	Crystal:     {8, "crystal", 1},
	Dust:        {1, "regolith", 1},
	Sulfur:      {3, "sulfur", 2},
	Grass:       {1, "regolith", 1},
	Sand:        {1, "silica", 1},
	Snow:        {1, "ice", 1},
}
