package takeon

import (
	"encoding/json"
	"fmt"
	"math"
)

// Space flight and in-orbit rules. A flight is a craft on a fixed course
// between two bodies. Control is limited on purpose: the craft keeps its
// course and speed, the player only nudges it inside a corridor, spends boost
// and, once in orbit, marks the sites it passes over. Rendering is host-owned.

const (
	flightTick        = 1.0 / 60
	flightSegment     = 60.0 // corridor units per generated segment
	flightSlots       = 3    // objects a segment can hold
	flightCraftRadius = 0.09
	flightBoostTime   = 1.6
	flightBoostGain   = 0.34
	flightHitSlowTime = 1.2
	flightSnapshotFmt = "takeon-flight/v1"
)

// Flight phases, in order. A host may start a flight in any of them.
const (
	FlightDeparture = "departure"
	FlightCruise    = "cruise"
	FlightApproach  = "approach"
	FlightOrbit     = "orbit"
)

// FlightSite is a place on the destination the craft passes over in orbit.
type FlightSite struct {
	ID    string  `json:"id"`
	Label string  `json:"label,omitempty"`
	Angle float64 `json:"angle"` // radians around the orbit
}

// FlightConfig is everything that decides a flight. The same config and the
// same inputs always give the same flight.
type FlightConfig struct {
	Seed uint32 `json:"seed"`
	// Duration is the nominal seconds from departure to orbit when the sim
	// paces the flight itself. Ignored when HostPaced.
	Duration float64 `json:"duration,omitempty"`
	// HostPaced: the host owns course progress (a persisted trip clock) and
	// reports it with SetProgress; boost and hits come back as events.
	HostPaced bool `json:"hostPaced,omitempty"`
	// Debris and Pickups are the chance, 0..1, that a corridor slot holds one.
	Debris  float64 `json:"debris"`
	Pickups float64 `json:"pickups"`
	// Agility scales how quickly the craft answers a nudge (1 = standard).
	Agility float64 `json:"agility,omitempty"`
	// BoostCharges the craft starts with, 0..3.
	BoostCharges float64 `json:"boostCharges,omitempty"`
	// StartPhase lets a host mount only part of a flight (an orbit scene).
	StartPhase  string       `json:"startPhase,omitempty"`
	OrbitPeriod float64      `json:"orbitPeriod,omitempty"` // seconds per lap
	Sites       []FlightSite `json:"sites,omitempty"`
}

// FlightObject is something in the corridor ahead of the craft.
type FlightObject struct {
	ID   int     `json:"id"`
	Kind string  `json:"kind"` // "debris" | "boost" | "sample"
	Z    float64 `json:"z"`    // corridor units ahead of the craft (negative = passed)
	X    float64 `json:"x"`    // corridor position, -1..1
	Y    float64 `json:"y"`
	R    float64 `json:"r"`
	Spin float64 `json:"spin"`
	Done bool    `json:"done,omitempty"` // hit or collected
}

type FlightEvent struct {
	Kind   string  `json:"kind"` // phase | hit | pickup | sample | boost | lap | site | overhead
	Detail string  `json:"detail,omitempty"`
	Amount float64 `json:"amount,omitempty"`
}

// FlightState is the renderer-free view of one moment of a flight.
type FlightState struct {
	Phase    string  `json:"phase"`
	Time     float64 `json:"time"`
	Progress float64 `json:"progress"` // 0..1 along the course
	Scroll   float64 `json:"scroll"`   // corridor units travelled
	Speed    float64 `json:"speed"`    // corridor units per second right now
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	VX       float64 `json:"vx"`
	VY       float64 `json:"vy"`
	Boost    float64 `json:"boost"` // charges held
	Boosting bool    `json:"boosting"`
	Slowed   bool    `json:"slowed"`
	Hull     float64 `json:"hull"` // 1 = untouched
	Hits     int     `json:"hits"`
	Pickups  int     `json:"pickups"`
	Samples  int     `json:"samples"`
	// Orbit.
	Angle    float64  `json:"angle"`
	Altitude float64  `json:"altitude"` // 0.75..1.35 of the nominal orbit
	Laps     int      `json:"laps"`
	Overhead string   `json:"overhead,omitempty"` // site under the craft now
	Marked   []string `json:"marked"`

	Objects []FlightObject `json:"objects"`
}

type FlightFrame struct {
	State  FlightState   `json:"state"`
	Events []FlightEvent `json:"events"`
}

type flightCore struct {
	Config   FlightConfig `json:"config"`
	Phase    string       `json:"phase"`
	Time     float64      `json:"time"`
	Acc      float64      `json:"acc"`
	Progress float64      `json:"progress"`
	Scroll   float64      `json:"scroll"`
	X        float64      `json:"x"`
	Y        float64      `json:"y"`
	VX       float64      `json:"vx"`
	VY       float64      `json:"vy"`
	SteerX   float64      `json:"steerX"`
	SteerY   float64      `json:"steerY"`
	Boost    float64      `json:"boost"`
	BoostFor float64      `json:"boostFor"`
	SlowFor  float64      `json:"slowFor"`
	Hull     float64      `json:"hull"`
	Hits     int          `json:"hits"`
	Pickups  int          `json:"pickups"`
	Samples  int          `json:"samples"`
	Angle    float64      `json:"angle"`
	Altitude float64      `json:"altitude"`
	Laps     int          `json:"laps"`
	Overhead string       `json:"overhead"`
	Marked   []string     `json:"marked"`
	Done     map[int]bool `json:"done"`
	Format   string       `json:"format"`
}

// Flight is one running flight.
type Flight struct {
	c      flightCore
	events []FlightEvent
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func clampF(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// NewFlight validates the config and puts the craft at the start of its phase.
func NewFlight(cfg FlightConfig) (*Flight, error) {
	for _, v := range []float64{cfg.Duration, cfg.Debris, cfg.Pickups, cfg.Agility, cfg.BoostCharges, cfg.OrbitPeriod} {
		if !finite(v) || v < 0 {
			return nil, fmt.Errorf("takeon: flight config values must be finite and nonnegative")
		}
	}
	if cfg.Duration == 0 {
		cfg.Duration = 60
	}
	if cfg.Duration < 5 || cfg.Duration > 3600 {
		return nil, fmt.Errorf("takeon: flight duration must be 5..3600 seconds")
	}
	if cfg.Agility == 0 {
		cfg.Agility = 1
	}
	cfg.Agility = clampF(cfg.Agility, 0.4, 2.5)
	cfg.Debris = clampF(cfg.Debris, 0, 1)
	cfg.Pickups = clampF(cfg.Pickups, 0, 1)
	cfg.BoostCharges = clampF(cfg.BoostCharges, 0, 3)
	if cfg.OrbitPeriod == 0 {
		cfg.OrbitPeriod = 40
	}
	cfg.OrbitPeriod = clampF(cfg.OrbitPeriod, 8, 600)
	if len(cfg.Sites) > 16 {
		return nil, fmt.Errorf("takeon: a flight holds at most 16 orbit sites")
	}
	seen := map[string]bool{}
	for i, s := range cfg.Sites {
		if s.ID == "" || seen[s.ID] || !finite(s.Angle) {
			return nil, fmt.Errorf("takeon: orbit site %d needs a unique id and a finite angle", i)
		}
		seen[s.ID] = true
		cfg.Sites[i].Angle = math.Mod(math.Mod(s.Angle, 2*math.Pi)+2*math.Pi, 2*math.Pi)
	}
	f := &Flight{c: flightCore{Config: cfg, Hull: 1, Boost: cfg.BoostCharges, Altitude: 1, Marked: []string{}, Done: map[int]bool{}, Format: flightSnapshotFmt}}
	switch cfg.StartPhase {
	case "", FlightDeparture:
		f.c.Phase = FlightDeparture
	case FlightCruise:
		f.c.Phase, f.c.Progress = FlightCruise, 0.08
	case FlightApproach:
		f.c.Phase, f.c.Progress = FlightApproach, 0.86
	case FlightOrbit:
		f.c.Phase, f.c.Progress = FlightOrbit, 1
	default:
		return nil, fmt.Errorf("takeon: unknown flight phase %q", cfg.StartPhase)
	}
	return f, nil
}

// Steer holds a nudge, each axis -1..1. In flight it moves the craft inside
// the corridor; in orbit x speeds or slows the lap and y raises or lowers it.
func (f *Flight) Steer(x, y float64) {
	if !finite(x) || !finite(y) {
		return
	}
	f.c.SteerX, f.c.SteerY = clampF(x, -1, 1), clampF(y, -1, 1)
}

// Boost spends one charge. It reports whether a charge was spent.
func (f *Flight) Boost() bool {
	if f.c.Phase == FlightOrbit || f.c.Boost < 1 || f.c.BoostFor > 0 {
		return false
	}
	f.c.Boost--
	f.c.BoostFor = flightBoostTime
	f.emit("boost", "", flightBoostTime)
	return true
}

// Mark records the site under the craft. It reports whether one was recorded.
func (f *Flight) Mark() bool {
	if f.c.Phase != FlightOrbit || f.c.Overhead == "" {
		return false
	}
	for _, id := range f.c.Marked {
		if id == f.c.Overhead {
			return false
		}
	}
	f.c.Marked = append(f.c.Marked, f.c.Overhead)
	f.emit("site", f.c.Overhead, float64(len(f.c.Marked)))
	return true
}

// SetProgress is how a host-paced flight learns where the trip clock is.
func (f *Flight) SetProgress(p float64) {
	if !f.c.Config.HostPaced || !finite(p) {
		return
	}
	f.c.Progress = clampF(p, 0, 1)
}

func (f *Flight) emit(kind, detail string, amount float64) {
	f.events = append(f.events, FlightEvent{Kind: kind, Detail: detail, Amount: amount})
}

// speedFactor is the craft's speed against its cruise speed.
func (f *Flight) speedFactor() float64 {
	v := 1.0
	switch f.c.Phase {
	case FlightDeparture:
		v = 0.55 + 0.45*clampF(f.c.Progress/0.08, 0, 1)
	case FlightApproach:
		v = 1 - 0.55*clampF((f.c.Progress-0.86)/0.14, 0, 1)
	case FlightOrbit:
		v = 0.35
	}
	if f.c.BoostFor > 0 {
		v *= 2.1
	}
	if f.c.SlowFor > 0 {
		v *= 0.45
	}
	return v
}

const flightCruiseSpeed = 18.0 // corridor units per second at factor 1

func flightPhaseAt(p float64) string {
	switch {
	case p >= 1:
		return FlightOrbit
	case p >= 0.86:
		return FlightApproach
	case p >= 0.08:
		return FlightCruise
	}
	return FlightDeparture
}

// slot returns the object generated for one corridor slot, if it holds one.
// The corridor is endless and generated on demand from the seed, so nothing
// about it needs saving except which objects were already used.
func (f *Flight) slot(seg, i int) (FlightObject, bool) {
	seed := int64(f.c.Config.Seed)
	roll := hash3(float64(seg), float64(i), 1, seed)
	kind := ""
	switch {
	case roll < f.c.Config.Debris:
		kind = "debris"
	case roll < f.c.Config.Debris+f.c.Config.Pickups*(1-f.c.Config.Debris):
		kind = "boost"
		if hash3(float64(seg), float64(i), 5, seed) < 0.4 {
			kind = "sample"
		}
	default:
		return FlightObject{}, false
	}
	o := FlightObject{ID: seg*flightSlots + i, Kind: kind}
	o.Z = (float64(seg) + (float64(i)+0.15+0.7*hash3(float64(seg), float64(i), 2, seed))/flightSlots) * flightSegment
	o.X = hash3(float64(seg), float64(i), 3, seed)*1.7 - 0.85
	o.Y = hash3(float64(seg), float64(i), 4, seed)*1.5 - 0.75
	o.Spin = hash3(float64(seg), float64(i), 6, seed) * 2 * math.Pi
	if kind == "debris" {
		o.R = 0.13 + 0.14*hash3(float64(seg), float64(i), 7, seed)
	} else {
		o.R = 0.16
	}
	return o, true
}

// objectsBetween lists generated objects with corridor position in [from, to).
func (f *Flight) objectsBetween(from, to float64) []FlightObject {
	out := []FlightObject{}
	if to <= from {
		return out
	}
	// The first two segments are clear so a flight never opens on a collision.
	for seg := int(math.Max(2, math.Floor(from/flightSegment))); float64(seg)*flightSegment < to; seg++ {
		for i := 0; i < flightSlots; i++ {
			if o, ok := f.slot(seg, i); ok && o.Z >= from && o.Z < to {
				out = append(out, o)
			}
		}
	}
	return out
}

func (f *Flight) tick() {
	c := &f.c
	dt := flightTick
	c.Time += dt
	c.BoostFor = math.Max(0, c.BoostFor-dt)
	c.SlowFor = math.Max(0, c.SlowFor-dt)

	if c.Phase == FlightOrbit {
		f.tickOrbit(dt)
		return
	}

	// Limited control: a nudge accelerates the craft sideways, drag settles it,
	// and the corridor walls stop it. It never turns off its course.
	accel := 5.2 * c.Config.Agility
	c.VX += (c.SteerX*accel - c.VX*3.4) * dt
	c.VY += (c.SteerY*accel - c.VY*3.4) * dt
	c.X += c.VX * dt
	c.Y += c.VY * dt
	if c.X < -1 || c.X > 1 {
		c.X, c.VX = clampF(c.X, -1, 1), 0
	}
	if c.Y < -1 || c.Y > 1 {
		c.Y, c.VY = clampF(c.Y, -1, 1), 0
	}

	factor := f.speedFactor()
	before := c.Scroll
	c.Scroll += flightCruiseSpeed * factor * dt
	if !c.Config.HostPaced {
		c.Progress = math.Min(1, c.Progress+factor*dt/c.Config.Duration)
	}

	// The corridor is clear on the way out and on the way in.
	if c.Phase == FlightCruise {
		for _, o := range f.objectsBetween(before, c.Scroll) {
			if c.Done[o.ID] || math.Hypot(o.X-c.X, o.Y-c.Y) > o.R+flightCraftRadius {
				continue
			}
			c.Done[o.ID] = true
			switch o.Kind {
			case "debris":
				c.Hits++
				c.Hull = math.Max(0.1, c.Hull-0.15)
				c.SlowFor = flightHitSlowTime
				c.BoostFor = 0
				f.emit("hit", "", c.Hull)
			case "boost":
				c.Pickups++
				c.Boost = math.Min(3, c.Boost+flightBoostGain)
				f.emit("pickup", "", c.Boost)
			case "sample":
				c.Samples++
				f.emit("sample", "", float64(c.Samples))
			}
		}
	}

	if next := flightPhaseAt(c.Progress); next != c.Phase {
		c.Phase = next
		f.emit("phase", next, c.Progress)
		if next == FlightOrbit {
			c.VX, c.VY = 0, 0
		}
	}
}

func (f *Flight) tickOrbit(dt float64) {
	c := &f.c
	// A lower orbit is a faster one; a nudge trims the lap by up to a third.
	c.Altitude = clampF(c.Altitude+c.SteerY*0.22*dt, 0.75, 1.35)
	rate := 2 * math.Pi / c.Config.OrbitPeriod * (1 + 0.33*c.SteerX) / math.Pow(c.Altitude, 1.5)
	c.Angle += rate * dt
	c.Scroll += flightCruiseSpeed * f.speedFactor() * dt
	if c.Angle >= 2*math.Pi {
		c.Angle -= 2 * math.Pi
		c.Laps++
		f.emit("lap", "", float64(c.Laps))
	}
	over := ""
	for _, s := range c.Config.Sites {
		d := math.Abs(s.Angle - c.Angle)
		if d > math.Pi {
			d = 2*math.Pi - d
		}
		if d < 0.07 {
			over = s.ID
			break
		}
	}
	if over != c.Overhead {
		c.Overhead = over
		if over != "" {
			f.emit("overhead", over, 0)
		}
	}
}

// Step advances the flight by dt seconds in fixed 1/60 s ticks and returns
// the state with the events raised since the last step.
func (f *Flight) Step(dt float64) (FlightFrame, error) {
	if !finite(dt) || dt < 0 || dt > 60 {
		return FlightFrame{}, fmt.Errorf("takeon: dt must be between 0 and 60 seconds")
	}
	f.c.Acc += dt
	for f.c.Acc >= flightTick {
		f.c.Acc -= flightTick
		f.tick()
	}
	events := f.events
	if events == nil {
		events = []FlightEvent{}
	}
	f.events = nil
	return FlightFrame{State: f.State(), Events: events}, nil
}

// State is the current view, with the corridor objects near the craft.
func (f *Flight) State() FlightState {
	c := &f.c
	s := FlightState{Phase: c.Phase, Time: c.Time, Progress: c.Progress, Scroll: c.Scroll, Speed: flightCruiseSpeed * f.speedFactor(),
		X: c.X, Y: c.Y, VX: c.VX, VY: c.VY, Boost: c.Boost, Boosting: c.BoostFor > 0, Slowed: c.SlowFor > 0, Hull: c.Hull,
		Hits: c.Hits, Pickups: c.Pickups, Samples: c.Samples, Angle: c.Angle, Altitude: c.Altitude, Laps: c.Laps,
		Overhead: c.Overhead, Marked: append([]string{}, c.Marked...), Objects: []FlightObject{}}
	if c.Phase == FlightCruise {
		for _, o := range f.objectsBetween(c.Scroll-6, c.Scroll+240) {
			o.Done = c.Done[o.ID]
			o.Z -= c.Scroll
			s.Objects = append(s.Objects, o)
		}
	}
	return s
}

// Snapshot is an opaque versioned save of the whole flight.
func (f *Flight) Snapshot() ([]byte, error) { return json.Marshal(f.c) }

// RestoreFlight rebuilds a flight from a Snapshot.
func RestoreFlight(b []byte) (*Flight, error) {
	var c flightCore
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("takeon: invalid flight snapshot: %w", err)
	}
	if c.Format != flightSnapshotFmt {
		return nil, fmt.Errorf("takeon: unsupported flight snapshot %q", c.Format)
	}
	f, err := NewFlight(c.Config)
	if err != nil {
		return nil, err
	}
	for _, v := range []float64{c.Time, c.Acc, c.Progress, c.Scroll, c.X, c.Y, c.VX, c.VY, c.SteerX, c.SteerY, c.Boost, c.BoostFor, c.SlowFor, c.Hull, c.Angle, c.Altitude} {
		if !finite(v) {
			return nil, fmt.Errorf("takeon: invalid flight snapshot values")
		}
	}
	if flightPhaseAt(c.Progress) != c.Phase {
		return nil, fmt.Errorf("takeon: flight snapshot phase does not match its progress")
	}
	c.Config = f.c.Config
	if c.Done == nil {
		c.Done = map[int]bool{}
	}
	if c.Marked == nil {
		c.Marked = []string{}
	}
	f.c = c
	return f, nil
}
