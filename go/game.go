package takeon

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

const (
	TickRate             = 10
	TickDT               = 1.0 / TickRate
	DriveSpeedMultiplier = 1.35
	snapshotVersion      = 1
)

// dirs: 0=SE(+x) 1=SW(+y) 2=NW(-x) 3=NE(-y).
var dirs = [4]Vec2{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}

type Mining struct {
	Pos       Vec2    `json:"pos"`
	Remaining float64 `json:"remaining"`
	Total     float64 `json:"total"`
}

type Rover struct {
	Pos        Vec2               `json:"pos"`
	MoveFrom   *Vec2              `json:"moveFrom"`
	MoveT      float64            `json:"moveT"`
	Facing     int                `json:"facing"`
	Battery    float64            `json:"battery"`
	Fuel       float64            `json:"fuel"`
	Durability float64            `json:"durability"`
	Cargo      map[string]float64 `json:"cargo"`
	CargoUsed  float64            `json:"cargoUsed"`
	Mining     *Mining            `json:"mining"`
}

type Weather struct {
	Type      string  `json:"type"`
	Intensity float64 `json:"intensity"`
	Duration  float64 `json:"duration"`
	Remaining float64 `json:"remaining"`
	Pos       *Vec2   `json:"pos,omitempty"`
}

// Event mirrors the shape of TakeonKit's TakeonEvent (depositMined etc.),
// extended with the engine's lower-level moved/blocked/weather events.
type Event struct {
	Kind   string  `json:"kind"`
	X      int     `json:"x,omitempty"`
	Y      int     `json:"y,omitempty"`
	Detail string  `json:"detail,omitempty"`
	Amount float64 `json:"amount,omitempty"`
}

// Game is the v0 core: one rover on one generated body.
type Game struct {
	body    *Body
	seed    int64
	world   *VoxelWorld
	stats   RoverStats
	spec    RoverSpec
	rover   Rover
	time    float64
	status  string
	weather *Weather
	landing Vec2
	anoms   []Anomaly

	weatherRng      *Mulberry32
	weatherCooldown float64
	impactTimer     float64
	devilDrift      [2]float64

	events []Event
	acc    float64

	mission     WorldState // mission/module hooks (runtime.go)
	missionDone bool
	mineOrder   *mineOrder // easy-mining autopilot (runtime.go) // fractional dt carried between Step calls
}

// NewGame generates the world for (bodyID, seed) and lands the default rover.
func NewGame(seed int64, bodyID string) (*Game, error) {
	g := &Game{}
	if err := g.LoadWorld(bodyID, seed); err != nil {
		return nil, err
	}
	return g, nil
}

// LoadWorld regenerates the world deterministically (TakeonEngine.loadWorld).
func (g *Game) LoadWorld(bodyID string, seed int64) error {
	body, err := GetBody(bodyID)
	if err != nil {
		return err
	}
	w, err := GenerateTerrain(body, seed)
	if err != nil {
		return err
	}
	*g = Game{body: body, seed: seed, world: w, spec: DefaultSpec(), status: "active"}
	g.anoms = GenerateAnomalies(body, w, seed)
	g.weatherRng = NewMulberry32(int64(uint32(int32(seed) ^ 0x77ea)))
	g.weatherCooldown = 20
	g.devilDrift = [2]float64{1, 0}
	g.landing = FindLandingSite(w)
	g.initMission()
	g.stats = ComputeStats(g.spec)
	g.rover = Rover{
		Pos:        g.landing,
		Battery:    g.stats.BatteryCapacity,
		Fuel:       fmax(0, g.stats.FuelCapacity-body.DeltaV),
		Durability: g.stats.DurabilityMax,
		Cargo:      map[string]float64{},
	}
	return nil
}

func (g *Game) emit(e Event) { g.events = append(g.events, e) }

func (g *Game) daylight() float64 {
	if g.body.DayLength <= 0 {
		return 1
	}
	phase := math.Mod(g.time, g.body.DayLength) / g.body.DayLength
	switch {
	case phase < 0.5:
		return 1
	case phase < 0.6:
		return 1 - float64((phase-0.5)*10)
	case phase < 0.9:
		return 0
	}
	return float64((phase - 0.9) * 10)
}

func (g *Game) weatherSolarMult() float64 {
	w := g.weather
	if w == nil {
		return 1
	}
	switch w.Type {
	case "dust-storm":
		return 1 - float64(0.65*w.Intensity)
	case "cryo-fog":
		return 1 - float64(0.55*w.Intensity)
	case "dust-devil":
		if w.Pos != nil && jsHypot(float64(w.Pos.X-g.rover.Pos.X), float64(w.Pos.Y-g.rover.Pos.Y)) <= 4 {
			return 0.5
		}
	}
	return 1
}

func (g *Game) weatherMoveMult() float64 {
	if w := g.weather; w != nil && w.Type == "dust-storm" {
		return 1 + float64(0.3*w.Intensity)
	}
	return 1
}

var weatherDur = map[string][2]float64{
	"dust-devil": {28, 50}, "dust-storm": {45, 90}, "solar-storm": {30, 60},
	"meteor-shower": {18, 34}, "cryo-fog": {45, 95},
}

// StartWeather begins an event; negative intensity/duration mean "roll them".
func (g *Game) StartWeather(typ string, intensity, duration float64) error {
	dur, ok := weatherDur[typ]
	if !ok {
		return fmt.Errorf("takeon: unknown weather %q", typ)
	}
	i := intensity
	if i < 0 {
		i = 0.5 + float64(g.weatherRng.Next()*0.5)
	}
	d := duration
	if d < 0 {
		d = dur[0] + float64(g.weatherRng.Next()*(dur[1]-dur[0]))
	}
	w := &Weather{Type: typ, Intensity: i, Duration: d, Remaining: d}
	if typ == "dust-devil" {
		ang := float64(g.weatherRng.Next()*math.Pi) * 2
		dist := 8 + float64(g.weatherRng.Next()*6)
		w.Pos = &Vec2{
			int(jsRound(float64(g.rover.Pos.X) + float64(fcos(ang)*dist))),
			int(jsRound(float64(g.rover.Pos.Y) + float64(fsin(ang)*dist))),
		}
		g.devilDrift = [2]float64{-fcos(ang), -fsin(ang)}
	}
	g.weather = w
	g.impactTimer = 0
	g.emit(Event{Kind: "weather", Detail: typ + ":start"})
	return nil
}

func (g *Game) damage(amount float64) {
	if amount <= 0.01 {
		return
	}
	r := &g.rover
	r.Durability = fmax(0, r.Durability-amount)
	if r.Durability <= 0 {
		g.status = "lost"
		g.emit(Event{Kind: "roverLost", Detail: "Chassis destroyed."})
	}
}

func (g *Game) tickWeather() {
	r := &g.rover
	w := g.weather
	if w == nil {
		if g.weatherCooldown > 0 {
			g.weatherCooldown -= TickDT
			return
		}
		for _, e := range g.body.Weather {
			if g.weatherRng.Next() < float64(e.Rate*TickDT)/600 {
				_ = g.StartWeather(e.Type, -1, -1)
				return
			}
		}
		return
	}
	w.Remaining -= TickDT
	if w.Remaining <= 0 {
		g.emit(Event{Kind: "weather", Detail: w.Type + ":end"})
		g.weather = nil
		g.weatherCooldown = 15 + float64(g.weatherRng.Next()*30)
		return
	}
	switch w.Type {
	case "dust-devil":
		if w.Pos == nil {
			break
		}
		if g.weatherRng.Next() < 0.06 {
			a := float64(g.weatherRng.Next()*math.Pi) * 2
			g.devilDrift = [2]float64{fcos(a), fsin(a)}
		}
		if g.weatherRng.Next() < 0.35 {
			nx := w.Pos.X + int(jsRound(g.devilDrift[0]+(g.weatherRng.Next()-0.5)))
			ny := w.Pos.Y + int(jsRound(g.devilDrift[1]+(g.weatherRng.Next()-0.5)))
			if g.world.IsSolid(nx, ny) {
				w.Pos = &Vec2{nx, ny}
			}
		}
		if jsHypot(float64(w.Pos.X-r.Pos.X), float64(w.Pos.Y-r.Pos.Y)) <= 1.6 {
			g.damage(float64(0.35 * w.Intensity))
		}
	case "solar-storm":
		r.Battery = fmax(0, r.Battery-float64(float64(float64(0.18*w.Intensity)*TickDT)*10))
	case "meteor-shower":
		g.impactTimer += TickDT
		interval := 2.6 - w.Intensity
		if g.impactTimer >= interval {
			g.impactTimer = 0
			ang := float64(g.weatherRng.Next()*math.Pi) * 2
			dist := 2 + float64(g.weatherRng.Next()*16)
			ix := int(jsRound(float64(r.Pos.X) + float64(fcos(ang)*dist)))
			iy := int(jsRound(float64(r.Pos.Y) + float64(fsin(ang)*dist)))
			if g.world.IsSolid(ix, iy) && !(ix == r.Pos.X && iy == r.Pos.Y) {
				if g.world.Height(ix, iy) > 1 {
					g.world.MineTop(ix, iy)
				}
				d := jsHypot(float64(ix-r.Pos.X), float64(iy-r.Pos.Y))
				g.emit(Event{Kind: "meteorImpact", X: ix, Y: iy})
				if d <= 2.5 {
					g.damage(4 + float64(6*w.Intensity))
				}
			}
		}
	}
}

func (g *Game) addCargo(res string, amount float64) {
	r := &g.rover
	take := fmin(g.stats.CargoCapacity-r.CargoUsed, amount)
	if take <= 0 {
		g.emit(Event{Kind: "cargoFull"})
		return
	}
	r.Cargo[res] += take
	r.CargoUsed += take
}

// Tick advances exactly one fixed 0.1 s step. Structures, crafting, scanning,
// photos, launches and habitats are NOT ported (see docs/go-core-spike.md).
func (g *Game) Tick() {
	if g.status != "active" {
		return
	}
	g.autopilot()
	g.time += TickDT
	r := &g.rover
	daylight := g.daylight()
	g.tickWeather()

	charge := g.stats.RtgRate + float64(float64(float64(g.stats.SolarRate*daylight)*g.body.SolarFlux)*g.weatherSolarMult())
	r.Battery = fmin(g.stats.BatteryCapacity, r.Battery+float64(charge*TickDT))

	if r.MoveFrom != nil {
		r.MoveT += float64(float64(g.stats.Speed*DriveSpeedMultiplier) * TickDT)
		if r.MoveT >= 1 {
			r.MoveT = 0
			r.MoveFrom = nil
			g.onArrive()
		}
	}

	if r.Mining != nil {
		r.Mining.Remaining -= float64(float64(g.stats.MiningPower*TickDT) * TickRate)
		if r.Mining.Remaining <= 0 {
			pos := r.Mining.Pos
			r.Mining = nil
			if mat, ok := g.world.MineTop(pos.X, pos.Y); ok {
				def := materials[mat]
				if def.Resource != "" {
					g.addCargo(def.Resource, def.Amount)
					g.emit(Event{Kind: "depositMined", X: pos.X, Y: pos.Y, Detail: def.Resource, Amount: def.Amount})
					g.onMined(def.Amount)
				}
			}
		}
	}

	if r.Battery <= 0.01 && g.stats.RtgRate == 0 && g.stats.SolarRate == 0 {
		g.status = "lost"
		g.emit(Event{Kind: "roverLost", Detail: "Battery depleted with no way to recharge."})
	}
}

// Move starts a one-tile move in direction 0..3; false if blocked.
func (g *Game) Move(dir int) bool {
	r := &g.rover
	if g.status != "active" || dir < 0 || dir > 3 {
		return false
	}
	r.Facing = dir
	if r.MoveFrom != nil || r.Mining != nil {
		g.emit(Event{Kind: "blocked", Detail: "busy"})
		return false
	}
	d := dirs[dir]
	nx, ny := r.Pos.X+d.X, r.Pos.Y+d.Y
	if !g.world.InBounds(nx, ny) || !g.world.IsSolid(nx, ny) {
		g.emit(Event{Kind: "blocked", Detail: "edge"})
		return false
	}
	step := g.world.Step(r.Pos.X, r.Pos.Y, nx, ny)
	if step > g.stats.MaxClimb {
		g.emit(Event{Kind: "blocked", Detail: "cliff"})
		return false
	}
	slope := 1 + float64(fmax(0, step)*0.5)
	cost := float64(float64(g.stats.MoveEnergy*slope) * g.weatherMoveMult())
	if r.Battery < cost {
		g.emit(Event{Kind: "blocked", Detail: "battery"})
		return false
	}
	r.Battery -= cost
	if step < -g.stats.MaxClimb {
		fall := -step - g.stats.MaxClimb
		g.damage(float64(float64(fall*g.body.Gravity) * (1.6 - g.stats.Grip)))
	} else if math.Abs(step) >= 1 {
		g.damage(float64(0.4 * (1 - g.stats.Grip)))
	}
	from := r.Pos
	r.MoveFrom = &from
	r.Pos = Vec2{nx, ny}
	r.MoveT = 0
	g.emit(Event{Kind: "moved", X: nx, Y: ny, Amount: cost})
	return true
}

// Drill begins mining the top voxel of the tile the rover faces (the engine's mine()).
func (g *Game) Drill() bool {
	r := &g.rover
	if g.status != "active" || r.MoveFrom != nil || r.Mining != nil || g.stats.MiningPower <= 0 {
		return false
	}
	d := dirs[r.Facing]
	tx, ty := r.Pos.X+d.X, r.Pos.Y+d.Y
	if !g.world.IsSolid(tx, ty) {
		return false
	}
	h := g.world.Height(tx, ty)
	if h <= 0 {
		return false
	}
	if float64(h-g.world.Height(r.Pos.X, r.Pos.Y)) > g.stats.MaxClimb+2 {
		return false
	}
	if r.CargoUsed >= g.stats.CargoCapacity {
		g.emit(Event{Kind: "cargoFull"})
		return false
	}
	hardness := materials[g.world.Get(tx, ty, h)].Hardness
	if r.Battery < g.stats.MiningEnergy {
		g.emit(Event{Kind: "blocked", Detail: "battery"})
		return false
	}
	r.Battery -= g.stats.MiningEnergy
	r.Mining = &Mining{Pos: Vec2{tx, ty}, Remaining: hardness, Total: hardness}
	return true
}

// Order is the single host-facing command entry: kind "move" (arg = dir 0..3)
// or "drill" (arg ignored). Unported kinds return ErrUnsupported.
func (g *Game) Order(kind string, arg int) (bool, error) {
	switch kind {
	case "move":
		return g.Move(arg), nil
	case "drill":
		return g.Drill(), nil
	case "mine":
		// arg packs the target tile: x | y<<16.
		return g.OrderMine(arg&0xffff, arg>>16), nil
	case "cancel":
		g.mineOrder = nil
		return true, nil
	case "bank":
		return g.Bank(), nil
	case "build", "scan", "photo", "craft", "launch", "deposit":
		return false, fmt.Errorf("%w: order %q", ErrUnsupported, kind)
	}
	return false, fmt.Errorf("takeon: unknown order %q", kind)
}

// Step advances by dt seconds in fixed ticks (TakeonEngine.step) and returns
// the events raised, JSON-encoded.
func (g *Game) Step(dt float64) (string, error) {
	g.acc += dt
	for g.acc >= TickDT-1e-9 {
		g.acc -= TickDT
		g.Tick()
	}
	return g.DrainEvents()
}

// DrainEvents returns and clears the pending events as a JSON array.
func (g *Game) DrainEvents() (string, error) {
	ev := g.events
	if ev == nil {
		ev = []Event{}
	}
	g.events = nil
	b, err := json.Marshal(ev)
	return string(b), err
}

// State is a read-only JSON view used by the parity tests and hosts.
type State struct {
	Time      float64        `json:"time"`
	Rover     Rover          `json:"rover"`
	Edits     map[string]int `json:"edits"`
	Status    string         `json:"status"`
	Weather   *Weather       `json:"weather"`
	Landing   Vec2           `json:"landing"`
	Stats     RoverStats     `json:"stats"`
	Anomalies []Anomaly      `json:"anomalies"`
	Mission   WorldState     `json:"mission"`
}

func (g *Game) State() State {
	return State{g.time, g.rover, g.world.Edits, g.status, g.weather, g.landing, g.stats, g.anoms, g.mission}
}

type snapshotDoc struct {
	V               int            `json:"v"`
	BodyID          string         `json:"bodyId"`
	Seed            int64          `json:"seed"`
	Time            float64        `json:"time"`
	Status          string         `json:"status"`
	Rover           Rover          `json:"rover"`
	Edits           map[string]int `json:"edits"`
	Weather         *Weather       `json:"weather"`
	WeatherRng      uint32         `json:"weatherRng"`
	WeatherCooldown float64        `json:"weatherCooldown"`
	ImpactTimer     float64        `json:"impactTimer"`
	DevilDrift      [2]float64     `json:"devilDrift"`
	Anomalies       []Anomaly      `json:"anomalies"`
	Acc             float64        `json:"acc"`
	Mission         *WorldState    `json:"mission,omitempty"`
	MissionDone     bool           `json:"missionDone,omitempty"`
}

// Snapshot serialises the mission. Unlike the TS MissionState it also carries
// the weather RNG state, so restore + continue is bit-identical to an
// uninterrupted run.
func (g *Game) Snapshot() ([]byte, error) {
	return json.Marshal(snapshotDoc{
		V: snapshotVersion, BodyID: g.body.ID, Seed: g.seed, Time: g.time, Status: g.status,
		Rover: g.rover, Edits: g.world.Edits, Weather: g.weather, WeatherRng: g.weatherRng.a,
		WeatherCooldown: g.weatherCooldown, ImpactTimer: g.impactTimer, DevilDrift: g.devilDrift,
		Anomalies: g.anoms, Acc: g.acc, Mission: &g.mission, MissionDone: g.missionDone,
	})
}

// Restore regenerates the world from (body, seed), then re-applies the edits and state.
func (g *Game) Restore(b []byte) error {
	var s snapshotDoc
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	if s.V != snapshotVersion {
		return errors.New("takeon: unsupported snapshot version")
	}
	if err := g.LoadWorld(s.BodyID, s.Seed); err != nil {
		return err
	}
	g.world.applyEdits(s.Edits)
	g.time, g.status, g.rover, g.weather = s.Time, s.Status, s.Rover, s.Weather
	if g.rover.Cargo == nil {
		g.rover.Cargo = map[string]float64{}
	}
	g.weatherRng.a = s.WeatherRng
	g.weatherCooldown, g.impactTimer, g.devilDrift, g.acc = s.WeatherCooldown, s.ImpactTimer, s.DevilDrift, s.Acc
	if s.Anomalies != nil {
		g.anoms = s.Anomalies
	}
	if s.Mission != nil {
		g.mission, g.missionDone = *s.Mission, s.MissionDone
	}
	return nil
}
