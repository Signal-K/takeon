package takeon

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
)

// Canonical JSON content is embedded here and emitted into the TypeScript
// package during build, so hosts and native bindings share the same catalogs.

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

// Preserve JS object insertion order in snapshot content as well as initial input.
func (r Rates) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, e := range r {
		if i > 0 {
			b.WriteByte(',')
		}
		key, _ := json.Marshal(e.Type)
		v, _ := json.Marshal(e.Rate)
		b.Write(key)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
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
	Roughness    float64      `json:"roughness"`
	Craters      float64      `json:"craters"`
	IceCaps      float64      `json:"iceCaps"`
	OreRichness  float64      `json:"oreRichness"`
	Irregular    bool         `json:"irregular"`
	Biomes       bool         `json:"biomes"`
	SulfurFields float64      `json:"sulfurFields"`
	Noise        *NoiseConfig `json:"noise"`
	Bands        []OreBand    `json:"bands"`
}

type Body struct {
	CoreDEM           *DEM      `json:"coreDEM,omitempty"`
	CoreBiomes        []biome   `json:"coreBiomes,omitempty"`
	CoreAllowedBiomes *[]string `json:"coreAllowedBiomes,omitempty"`

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
	Name     string             `json:"name"`
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

// GetBody resolves built-ins; custom declarative content uses NewConfiguredGame.
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
//
//go:embed data/materials.json
var materialJSON []byte
var materials map[int]materialDef

func init() {
	var catalog map[int]HostMaterial
	if err := json.Unmarshal(materialJSON, &catalog); err != nil {
		panic(err)
	}
	materials = map[int]materialDef{}
	for id, m := range catalog {
		d := materialDef{Hardness: m.Hardness}
		if m.Yields != nil {
			d.Resource = m.Yields.Resource
			d.Amount = m.Yields.Amount
		}
		materials[id] = d
	}
}
