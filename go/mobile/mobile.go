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
