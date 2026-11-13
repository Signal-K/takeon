// Package bridge is the versioned renderer-free JSON boundary for all JS hosts.
package bridge

import (
	"encoding/json"
	"fmt"
	takeon "github.com/Signal-K/takeon-go"
	"math"
)

type Request struct {
	Module  *takeon.WorldState `json:"module"`
	Mission *takeon.Mission    `json:"mission"`
	Base    takeon.Vec2f       `json:"base"`
	Tile    takeon.Vec2f       `json:"tile"`
	Gain    takeon.Gain        `json:"gain"`
	Raw     json.RawMessage    `json:"raw"`

	Voxels   []int              `json:"voxels"`
	Op       string             `json:"op"`
	EngineID int                `json:"engineId"`
	Seed     uint32             `json:"seed"`
	BodyID   string             `json:"bodyId"`
	DT       float64            `json:"dt"`
	Kind     string             `json:"kind"`
	Arg      int                `json:"arg"`
	Text     string             `json:"text"`
	X        int                `json:"x"`
	Y        int                `json:"y"`
	W        int                `json:"w"`
	H        int                `json:"h"`
	Snapshot string             `json:"snapshot"`
	Cargo    map[string]float64 `json:"cargo"`
	Config   *takeon.HostData   `json:"config"`
	Host     *takeon.HostView   `json:"host"`
}
type response struct {
	OK    bool   `json:"ok"`
	Value any    `json:"value,omitempty"`
	Error string `json:"error,omitempty"`
}
type Session struct {
	engines map[int]*takeon.Game
	next    int
}

func (s *Session) Call(input string) string {
	var req Request
	var out response
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		out.Error = "invalid request: " + err.Error()
	} else {
		v, err := s.dispatch(req)
		if err != nil {
			out.Error = err.Error()
		} else {
			out.OK = true
			out.Value = v
		}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return `{"ok":false,"error":"could not encode response"}`
	}
	return string(b)
}
func (s *Session) dispatch(r Request) (any, error) {
	if r.Op == "module" {
		switch r.Kind {
		case "demo":
			return takeon.DemoMission(), nil
		case "create":
			m := takeon.DemoMission()
			if r.Mission != nil {
				m = *r.Mission
			}
			return takeon.NewWorldState(r.Base, m), nil
		case "parse":
			raw := r.Raw
			var str string
			if json.Unmarshal(raw, &str) == nil {
				raw = []byte(str)
			}
			return takeon.ParseWorldState(raw, r.Base), nil
		}
		if r.Module == nil {
			return nil, fmt.Errorf("takeon: module state required")
		}
		switch r.Kind {
		case "explore":
			return r.Module.Explore(r.Tile, r.Gain), nil
		case "bank":
			return r.Module.ReturnToBase(), nil
		case "reset":
			return r.Module.Reset(), nil
		case "progress":
			return r.Module.Progress(), nil
		case "serialize":
			return r.Module.Serialize()
		}
		return nil, fmt.Errorf("takeon: unknown module operation")
	}
	if r.Op == "capabilities" {
		return takeon.Capabilities(), nil
	}
	if r.Op == "create" {
		var e *takeon.Game
		var err error
		if r.Config != nil {
			e, err = takeon.NewConfiguredGame(int64(r.Seed), *r.Config)
		} else {
			e, err = takeon.NewGame(int64(r.Seed), r.BodyID)
		}
		if err != nil {
			return nil, err
		}
		if s.engines == nil {
			s.engines = map[int]*takeon.Game{}
		}
		s.next++
		s.engines[s.next] = e
		return s.next, nil
	}
	if r.Op == "biome" {
		if r.Config == nil || r.Config.Body == nil {
			return nil, fmt.Errorf("takeon: body required")
		}
		return takeon.SelectBiome(r.Config.Body, r.X, r.Y, int64(r.Seed)), nil
	}
	if r.Op == "anomalies" {
		if r.Config == nil || r.Config.Body == nil {
			return nil, fmt.Errorf("takeon: body required")
		}
		b := r.Config.Body
		w := takeon.NewVoxelWorld(b.Size, b.MaxHeight)
		if len(r.Voxels) != b.Size*b.Size*b.MaxHeight {
			return nil, fmt.Errorf("takeon: invalid world data")
		}
		if err := w.ImportVoxels(r.Voxels); err != nil {
			return nil, err
		}

		return takeon.GenerateAnomalies(b, w, int64(r.Seed)), nil
	}
	if r.Op == "terrain" {
		if r.Config == nil || r.Config.Body == nil {
			return nil, fmt.Errorf("takeon: body data required")
		}
		e, err := takeon.NewConfiguredGame(int64(r.Seed), *r.Config)
		if err != nil {
			return nil, err
		}
		return e.WorldData(), nil
	}
	if r.Op == "stats" {
		if r.Config == nil || r.Config.Spec == nil {
			return nil, fmt.Errorf("takeon: spec required")
		}
		return takeon.ComputeStatsWithCatalog(*r.Config.Spec, r.Config.Parts), nil
	}
	e := s.engines[r.EngineID]
	if e == nil {
		return nil, fmt.Errorf("takeon: unknown or disposed engine %d", r.EngineID)
	}
	switch r.Op {
	case "dispose":
		delete(s.engines, r.EngineID)
		return true, nil
	case "step":
		if math.IsNaN(r.DT) || math.IsInf(r.DT, 0) || r.DT < 0 || r.DT > 60 {
			return nil, fmt.Errorf("takeon: dt must be between 0 and 60 seconds")
		}
		v, err := e.Step(r.DT)
		return json.RawMessage(v), err
	case "order":
		if r.Kind == "move" && (r.Arg < 0 || r.Arg > 3) {
			return nil, fmt.Errorf("takeon: direction must be 0..3")
		}
		return e.Order(r.Kind, r.Arg)
	case "orderMine":
		if r.X < 0 || r.Y < 0 || r.X > 65535 || r.Y > 65535 {
			return nil, fmt.Errorf("takeon: mining coordinates must be 0..65535")
		}
		return e.OrderMine(r.X, r.Y), nil
	case "bank":
		return e.Bank(), nil
	case "seedCache":
		e.SeedCache()
		return true, nil
	case "seedCargo":
		for _, v := range r.Cargo {
			if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
				return nil, fmt.Errorf("takeon: cargo must be finite and nonnegative")
			}
		}
		e.SeedCargo(r.Cargo)
		return true, nil
	case "deposit":
		return e.Deposit(), nil
	case "state":
		return e.State(), nil
	case "hostState":
		return e.HostState(), nil
	case "world":
		return e.WorldData(), nil
	case "mission":
		st, p := e.Mission()
		return map[string]any{"state": st, "progress": p}, nil
	case "window":
		if r.W < 0 || r.H < 0 || r.W > 65536 || r.H > 65536 || int64(r.W)*int64(r.H) > 65536 {
			return nil, fmt.Errorf("takeon: window exceeds 65536 cells")
		}
		v, err := e.Window(r.X, r.Y, r.W, r.H)
		return json.RawMessage(v), err
	case "snapshot":
		v, err := e.Snapshot()
		return string(v), err
	case "restore":
		replacement, err := takeon.NewGame(0, "moon")
		if err != nil {
			return nil, err
		}
		if err = replacement.Restore([]byte(r.Snapshot)); err != nil {
			return nil, err
		}
		s.engines[r.EngineID] = replacement
		return true, nil
	case "command":
		return e.Command(r.Kind, r.Text)
	case "sim":
		if r.Host != nil {
			e.ApplyHost(*r.Host)
		}
		value, err := e.HostCommand(r.Kind, r.Text, r.Arg, r.DT)
		if err != nil {
			return nil, err
		}
		events, err := e.DrainEvents()
		if err != nil {
			return nil, err
		}
		return map[string]any{"result": value, "state": e.HostState(), "events": json.RawMessage(events)}, nil
	default:
		return nil, fmt.Errorf("takeon: unsupported operation %q", r.Op)
	}
}
