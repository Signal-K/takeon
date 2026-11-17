// Package mobile is the gomobile-bindable facade over the takeon core. It
// exposes only types gobind supports (string, []byte, int, int64, float64,
// bool, error, and this one opaque struct), mirroring Landnam's
// native/TakeonKit TakeonEngine protocol: loadWorld / step / snapshot /
// restore, plus an Order entry for rover commands.
package mobile

import (
	"encoding/json"

	takeon "github.com/Signal-K/takeon-go"
)

// Engine wraps one Game.
type Engine struct{ g *takeon.Game }

// NewEngine generates (bodyID, seed) and lands the default rover.
func NewEngine(seed int64, bodyID string) (*Engine, error) {
	g, err := takeon.NewGame(seed, bodyID)
	if err != nil {
		return nil, err
	}
	return &Engine{g}, nil
}

// LoadWorld regenerates the world (TakeonEngine.loadWorld).
func (e *Engine) LoadWorld(bodyID string, seed int64) error { return e.g.LoadWorld(bodyID, seed) }

// Order issues "move" (arg = direction 0..3) or "drill" (arg ignored).
func (e *Engine) Order(kind string, arg int) (bool, error) { return e.g.Order(kind, arg) }

// Step advances dt seconds in fixed 0.1 s ticks and returns the raised events
// as a JSON array (TakeonEngine.step).
func (e *Engine) Step(dt float64) (string, error) { return e.g.Step(dt) }

// Snapshot returns an opaque versioned JSON save blob (TakeonEngine.snapshot).
func (e *Engine) Snapshot() ([]byte, error) { return e.g.Snapshot() }

// Restore loads a Snapshot blob (TakeonEngine.restore).
func (e *Engine) Restore(b []byte) error { return e.g.Restore(b) }

// StateJSON is a read-only view of rover/world state for rendering.
func (e *Engine) StateJSON() (string, error) {
	b, err := json.Marshal(e.g.State())
	return string(b), err
}

// OrderMine drives to (x,y), faces it and mines it down (autopilot, handled in Step).
func (e *Engine) OrderMine(x, y int) bool { ok, _ := e.g.Order("mine", x|y<<16); return ok }

// CancelOrder stops the autopilot.
func (e *Engine) CancelOrder() { _, _ = e.g.Order("cancel", 0) }

// Bank banks held mission yield when near the landing site.
func (e *Engine) Bank() bool { return e.g.Bank() }

// MissionJSON returns {"state": WorldState, "progress": MissionProgress}.
func (e *Engine) MissionJSON() (string, error) {
	st, p := e.g.Mission()
	b, err := json.Marshal(map[string]any{"state": st, "progress": p})
	return string(b), err
}

// SetMissionJSON replaces the mission (JSON Mission object) and resets progress.
func (e *Engine) SetMissionJSON(js string) error {
	var m takeon.Mission
	if err := json.Unmarshal([]byte(js), &m); err != nil {
		return err
	}
	e.g.SetMission(m)
	return nil
}

// WindowJSON returns the terrain window [x,x+w) x [y,y+h) (top height and top
// material per column) for renderers; see takeon.WindowView.
func (e *Engine) WindowJSON(x, y, w, h int) (string, error) { return e.g.Window(x, y, w, h) }

// SeedCache places one drop-off cache beside the rover (takeon.Game.SeedCache).
func (e *Engine) SeedCache() { e.g.SeedCache() }

// SeedCargoJSON loads host cargo ({"iron": 3, ...}) into the rover hold.
func (e *Engine) SeedCargoJSON(js string) error {
	var c map[string]float64
	if err := json.Unmarshal([]byte(js), &c); err != nil {
		return err
	}
	e.g.SeedCargo(c)
	return nil
}

// Deposit empties the hold into an adjacent cache; returns units moved (0 when none is in reach).
func (e *Engine) Deposit() float64 { return e.g.Deposit() }

// CapabilitiesJSON describes the shared core contract for any mobile host.
func CapabilitiesJSON() string {
	b, _ := json.Marshal(takeon.Capabilities())
	return string(b)
}

// CommandJSON invokes a shared construction/refining/survey command with a text argument.
func (e *Engine) CommandJSON(kind, argument string) (string, error) {
	result, err := e.g.Command(kind, argument)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(result)
	return string(b), err
}

// ConfigureJSON replaces the world from validated, host-authored core content.
func (e *Engine) ConfigureJSON(configuration string, seed int64) error {
	var config takeon.HostData
	if err := json.Unmarshal([]byte(configuration), &config); err != nil {
		return err
	}
	game, err := takeon.NewConfiguredGame(seed, config)
	if err != nil {
		return err
	}
	e.g = game
	return nil
}

// Flight wraps one space flight (takeon.Flight) for Swift and Kotlin hosts.
type Flight struct{ f *takeon.Flight }

// NewFlight starts a flight from a FlightConfig JSON object.
func NewFlight(configJSON string) (*Flight, error) {
	var cfg takeon.FlightConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, err
	}
	f, err := takeon.NewFlight(cfg)
	if err != nil {
		return nil, err
	}
	return &Flight{f}, nil
}

// RestoreFlight rebuilds a flight from a Snapshot blob.
func RestoreFlight(b []byte) (*Flight, error) {
	f, err := takeon.RestoreFlight(b)
	if err != nil {
		return nil, err
	}
	return &Flight{f}, nil
}

// Steer holds a nudge, each axis -1..1.
func (f *Flight) Steer(x, y float64) { f.f.Steer(x, y) }

// SetProgress reports the trip clock (0..1) to a host-paced flight.
func (f *Flight) SetProgress(p float64) { f.f.SetProgress(p) }

// Boost spends one boost charge.
func (f *Flight) Boost() bool { return f.f.Boost() }

// Mark records the orbit site under the craft.
func (f *Flight) Mark() bool { return f.f.Mark() }

// Step advances dt seconds and returns {"state":…, "events":[…]} as JSON.
func (f *Flight) Step(dt float64) (string, error) {
	frame, err := f.f.Step(dt)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(frame)
	return string(b), err
}

// Snapshot returns an opaque versioned save blob.
func (f *Flight) Snapshot() ([]byte, error) { return f.f.Snapshot() }
