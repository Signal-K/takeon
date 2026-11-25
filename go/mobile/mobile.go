// Package mobile is the gomobile-bindable facade over the takeon core. It
// exposes only types gobind supports (string, []byte, int, int64, float64,
// bool, error, and this one opaque struct), mirroring Landnam's
// native/TakeonKit TakeonEngine protocol: loadWorld / step / snapshot /
// restore, plus an Order entry for rover commands.
package mobile

import (
	"encoding/json"
	"fmt"

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

// GenerateLocationJSON resolves a versioned location spec without creating a game.
func GenerateLocationJSON(specJSON string) (string, error) {
	var spec takeon.LocationSpec
	if err := json.Unmarshal([]byte(specJSON), &spec); err != nil {
		return "", err
	}
	location, err := takeon.GenerateLocation(spec)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(location)
	return string(b), err
}

// SolarProfilesJSON returns the available art-directed solar body profiles.
func SolarProfilesJSON() (string, error) {
	b, err := json.Marshal(takeon.SolarProfiles())
	return string(b), err
}

// SolarSampleJSON returns one common globe/surface sample.
func SolarSampleJSON(id string, seed int64, latitude, longitude float64) (string, error) {
	if seed < 0 || seed > 4294967295 {
		return "", fmt.Errorf("takeon: seed must be uint32")
	}
	sample, err := takeon.SampleSolarBody(id, uint32(seed), latitude, longitude)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(sample)
	return string(b), err
}

// SolarPatchJSON returns row-major surface samples.
func SolarPatchJSON(id string, seed int64, latitude, longitude, step float64, width, height int) (string, error) {
	if seed < 0 || seed > 4294967295 {
		return "", fmt.Errorf("takeon: seed must be uint32")
	}
	patch, err := takeon.SampleSolarPatch(id, uint32(seed), latitude, longitude, step, width, height)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(patch)
	return string(b), err
}

// StyledSolarSampleJSON returns the same visual radius used by the planet viewer.
func StyledSolarSampleJSON(id string, seed int64, latitude, longitude float64) (string, error) {
	if seed < 0 || seed > 4294967295 {
		return "", fmt.Errorf("takeon: seed must be uint32")
	}
	sample, err := takeon.SampleStyledSolarBody(id, uint32(seed), latitude, longitude)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(sample)
	return string(b), err
}

// StyledSolarPatchJSON returns globe-matched visual samples for a surface patch.
func StyledSolarPatchJSON(id string, seed int64, latitude, longitude, step float64, width, height int) (string, error) {
	if seed < 0 || seed > 4294967295 {
		return "", fmt.Errorf("takeon: seed must be uint32")
	}
	patch, err := takeon.SampleStyledSolarPatch(id, uint32(seed), latitude, longitude, step, width, height)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(patch)
	return string(b), err
}

// SolarLandingJSON prepares a globe-matched landing patch and local frame.
func SolarLandingJSON(id string, seed int64, latitude, longitude, step float64, width, height int) (string, error) {
	return VersionedSolarLandingJSON(takeon.SolarStyleVersion, id, seed, latitude, longitude, step, width, height)
}

// VersionedSolarLandingJSON restores a landing using its saved style version.
func VersionedSolarLandingJSON(version int, id string, seed int64, latitude, longitude, step float64, width, height int) (string, error) {
	if seed < 0 || seed > 4294967295 {
		return "", fmt.Errorf("takeon: seed must be uint32")
	}
	landing, err := takeon.PrepareVersionedSolarLanding(version, id, uint32(seed), latitude, longitude, step, width, height)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(landing)
	return string(b), err
}
