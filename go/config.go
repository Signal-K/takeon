package takeon

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

// HostData is declarative content. No executable callbacks cross the core.
type HostData struct {
	Body      *Body                `json:"body"`
	Spec      *RoverSpec           `json:"spec"`
	Parts     []Part               `json:"parts"`
	Rules     *RuleCatalog         `json:"rules"`
	Materials map[int]HostMaterial `json:"materials"`
}
type HostMaterial struct {
	Hardness float64 `json:"hardness"`
	Yields   *struct {
		Resource string  `json:"resource"`
		Amount   float64 `json:"amount"`
	} `json:"yields"`
}

func NewConfiguredGame(seed int64, data HostData) (*Game, error) {
	if data.Body == nil {
		return nil, fmt.Errorf("takeon: body data required")
	}
	b := data.Body
	if b.Size < 2 || b.Size > 512 || b.MaxHeight < 2 || b.MaxHeight > 127 || math.IsNaN(b.Gravity) {
		return nil, fmt.Errorf("takeon: invalid body dimensions or gravity")
	}
	if b.CoreDEM != nil && (b.CoreDEM.Size < 2 || len(b.CoreDEM.Heights) != b.CoreDEM.Size*b.CoreDEM.Size) {
		return nil, fmt.Errorf("takeon: invalid DEM grid")
	}
	if data.Rules != nil {
		resolved := *data.Rules
		if resolved.Structures == nil {
			resolved.Structures = defaultRules.Structures
		}
		if resolved.Recipes == nil {
			resolved.Recipes = defaultRules.Recipes
		}
		if resolved.MobilityCosts == nil {
			resolved.MobilityCosts = defaultRules.MobilityCosts
		}
		if len(resolved.MobilityCosts) < 3 {
			return nil, fmt.Errorf("takeon: three mobility costs required")
		}
		data.Rules = &resolved
	}
	world, err := GenerateTerrain(b, seed)
	if err != nil {
		return nil, err
	}
	spec := DefaultSpec()
	if data.Spec != nil {
		spec = *data.Spec
	}
	catalog := data.Parts
	if catalog == nil {
		catalog = Parts
	}
	g := &Game{body: b, seed: seed, world: world, spec: spec, status: "active", ruleCatalog: data.Rules, hostData: &data, partCatalog: catalog}
	g.stats = ComputeStatsWithCatalog(spec, catalog)
	g.baseStats = g.stats
	g.anoms = GenerateAnomalies(b, world, seed)
	g.weatherRng = NewMulberry32(int64(uint32(int32(seed) ^ 0x77ea)))
	g.weatherCooldown = 20
	g.devilDrift = [2]float64{1, 0}
	g.landing = FindLandingSite(world)
	g.rover = Rover{Pos: g.landing, Battery: g.stats.BatteryCapacity, Fuel: fmax(0, g.stats.FuelCapacity-b.DeltaV), Durability: g.stats.DurabilityMax, Cargo: map[string]float64{}}
	g.initMission()
	return g, nil
}
func (g *Game) material(id int) materialDef {
	if g.hostData != nil {
		if m, ok := g.hostData.Materials[id]; ok {
			d := materialDef{Hardness: m.Hardness}
			if m.Yields != nil {
				d.Resource = m.Yields.Resource
				d.Amount = m.Yields.Amount
			}
			return d
		}
	}
	if m, ok := materials[id]; ok {
		return m
	}
	return materialDef{Hardness: 1}
}

// HostView carries the mutable public TS projection. Its fields are host-editable
// for compatibility; all transitions and costs are applied only inside Go.
type HostView struct {
	Time  float64 `json:"time"`
	Rover struct {
		Rover
		Stats    RoverStats `json:"stats"`
		Upgrades struct {
			Mobility int `json:"mobility"`
		} `json:"upgrades"`
	} `json:"rover"`
	Structures []*Structure       `json:"structures"`
	Anomalies  []Anomaly          `json:"anomalies"`
	Photos     []Photo            `json:"photos"`
	Status     string             `json:"status"`
	Banked     map[string]float64 `json:"banked"`
	Weather    *Weather           `json:"weather"`
	Edits      map[string]int     `json:"edits"`
}

func (g *Game) ApplyHost(data HostView) {
	g.time = data.Time
	g.rover = data.Rover.Rover
	g.stats = data.Rover.Stats
	g.mobility = data.Rover.Upgrades.Mobility
	if g.mobility < 0 {
		g.mobility = 0
	}
	if g.mobility > 3 {
		g.mobility = 3
	}
	if g.rover.Facing < 0 || g.rover.Facing > 3 {
		g.rover.Facing = 0
	}
	g.structures = data.Structures
	g.anoms = data.Anomalies
	g.photos = data.Photos
	g.status = data.Status
	g.banked = data.Banked
	g.weather = data.Weather
	if g.rover.Cargo == nil {
		g.rover.Cargo = map[string]float64{}
	}
	for _, s := range g.structures {
		if s.Buffer == nil {
			s.Buffer = map[string]float64{}
		}
	}
	g.world.applyEdits(data.Edits)
}
func (g *Game) HostState() map[string]any {
	r := map[string]any{}
	b, _ := json.Marshal(g.rover)
	_ = json.Unmarshal(b, &r)
	r["stats"] = g.stats
	r["spec"] = g.spec
	r["upgrades"] = map[string]int{"mobility": g.mobility}
	powered := []string{}
	for _, s := range g.structures {
		if g.powered[s.ID] {
			powered = append(powered, s.ID)
		}
	}
	structures := g.structures
	if structures == nil {
		structures = []*Structure{}
	}
	photos := g.photos
	if photos == nil {
		photos = []Photo{}
	}
	launches := g.launches
	if launches == nil {
		launches = []Marker{}
	}
	return map[string]any{"time": g.time, "rover": r, "structures": structures, "anomalies": g.anoms, "photos": photos, "status": g.status, "banked": g.banked, "weather": g.weather, "edits": g.world.Edits, "powered": powered, "launches": launches, "landingSite": g.landing}
}
func (g *Game) WorldData() map[string]any {
	data := make([]int, len(g.world.voxels))
	for i, v := range g.world.voxels {
		data[i] = int(v)
	}
	return map[string]any{"size": g.world.Size, "maxHeight": g.world.MaxHeight, "voxels": data}
}
func (g *Game) Command(kind, arg string) (any, error) {
	switch kind {
	case "build":
		return g.Build(arg), nil
	case "craft":
		return g.Craft(arg), nil
	case "rotateStructure":
		return g.RotateStructure(arg), nil
	case "demolish":
		return g.Demolish(arg), nil
	case "scan":
		return g.Scan(), nil
	case "photo":
		return g.Photo(), nil
	}
	return nil, fmt.Errorf("takeon: unsupported command %q", kind)
}

func (g *Game) HostCommand(kind, text string, arg int, dt float64) (any, error) {
	switch kind {
	case "tick":
		g.Tick()
		return nil, nil
	case "move":
		return g.Move(arg), nil
	case "mine":
		return g.Drill(), nil
	case "daylight":
		return g.daylight(), nil
	case "weatherSolarMult":
		return g.weatherSolarMult(), nil
	case "weatherMoveMult":
		return g.weatherMoveMult(), nil
	case "weatherSensorMult":
		return g.sensorMult(), nil
	case "startWeather":
		var weather struct {
			Type      string  `json:"type"`
			Intensity float64 `json:"intensity"`
			Duration  float64 `json:"duration"`
		}
		if err := json.Unmarshal([]byte(text), &weather); err != nil {
			return nil, err
		}
		return nil, g.StartWeather(weather.Type, weather.Intensity, weather.Duration)
	case "depositCargo":
		return g.DepositCargo(), nil
	case "launchCargo":
		return g.LaunchCargo(), nil
	case "upgradeMobility":
		return g.UpgradeMobility(), nil
	case "placeBlock":
		return g.PlaceBlock(), nil
	case "repair":
		return g.Repair(), nil
	case "refreshStats":
		g.refreshStats()
		return nil, nil
	case "sync":
		return nil, nil
	}
	return g.Command(kind, text)
}
func (g *Game) DepositCargo() float64 { return g.Deposit() }

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (g *Game) refreshStats() {
	catalog := g.partCatalog
	if catalog == nil {
		catalog = Parts
	}
	g.baseStats = ComputeStatsWithCatalog(g.spec, catalog)
	g.stats = g.baseStats
	g.stats.MaxClimb += float64(g.mobility)
	g.stats.Grip = fmin(.95, g.stats.Grip+.12*float64(g.mobility))
	g.stats.Speed = jsRound(g.stats.Speed*(1+.08*float64(g.mobility))*100) / 100
}
