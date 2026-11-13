// Package bridge is the versioned, renderer-free JSON boundary shared by web
// and Node. Mobile binds the same Game through mobile.Engine.
package bridge

import (
	"encoding/json"
	"fmt"
	"math"

	takeon "github.com/Signal-K/takeon-go"
	"github.com/Signal-K/takeon-go/mobile"
)

type Request struct {
	Op       string             `json:"op"`
	EngineID int                `json:"engineId"`
	Seed     uint32             `json:"seed"`
	BodyID   string             `json:"bodyId"`
	DT       float64            `json:"dt"`
	Kind     string             `json:"kind"`
	Arg      int                `json:"arg"`
	X        int                `json:"x"`
	Y        int                `json:"y"`
	W        int                `json:"w"`
	H        int                `json:"h"`
	Snapshot string             `json:"snapshot"`
	Cargo    map[string]float64 `json:"cargo"`
}

type response struct {
	OK    bool   `json:"ok"`
	Value any    `json:"value,omitempty"`
	Error string `json:"error,omitempty"`
}

// Session must be accessed serially, like the simulation itself. Engine IDs
// are monotonically increasing so a disposed handle cannot address a new game.
type Session struct {
	engines map[int]*mobile.Engine
	next    int
}

func (s *Session) Call(input string) string {
	var req Request
	var result response
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		result.Error = "invalid request: " + err.Error()
	} else {
		value, err := s.dispatch(req)
		if err != nil {
			result.Error = err.Error()
		} else {
			result.OK = true
			result.Value = value
		}
	}
	b, err := json.Marshal(result)
	if err != nil {
		return `{"ok":false,"error":"could not encode response"}`
	}
	return string(b)
}

func (s *Session) dispatch(r Request) (any, error) {
	if r.Op == "capabilities" {
		return takeon.Capabilities(), nil
	}
	if r.Op == "create" {
		engine, err := mobile.NewEngine(int64(r.Seed), r.BodyID)
		if err != nil {
			return nil, err
		}
		if s.engines == nil {
			s.engines = map[int]*mobile.Engine{}
		}
		s.next++
		s.engines[s.next] = engine
		return s.next, nil
	}
	engine := s.engines[r.EngineID]
	if engine == nil {
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
		value, err := engine.Step(r.DT)
		return json.RawMessage(value), err
	case "order":
		if r.Kind == "move" && (r.Arg < 0 || r.Arg > 3) {
			return nil, fmt.Errorf("takeon: direction must be 0..3")
		}
		return engine.Order(r.Kind, r.Arg)
	case "orderMine":
		if r.X < 0 || r.Y < 0 || r.X > 65535 || r.Y > 65535 {
			return nil, fmt.Errorf("takeon: mining coordinates must be 0..65535")
		}
		return engine.OrderMine(r.X, r.Y), nil
	case "bank":
		return engine.Bank(), nil
	case "seedCache":
		engine.SeedCache()
		return true, nil
	case "seedCargo":
		for _, amount := range r.Cargo {
			if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
				return nil, fmt.Errorf("takeon: cargo must be finite and nonnegative")
			}
		}
		b, err := json.Marshal(r.Cargo)
		if err != nil {
			return nil, err
		}
		return true, engine.SeedCargoJSON(string(b))
	case "deposit":
		return engine.Deposit(), nil
	case "state":
		value, err := engine.StateJSON()
		return json.RawMessage(value), err
	case "mission":
		value, err := engine.MissionJSON()
		return json.RawMessage(value), err
	case "window":
		if r.W < 0 || r.H < 0 || r.W > 65536 || r.H > 65536 || int64(r.W)*int64(r.H) > 65536 {
			return nil, fmt.Errorf("takeon: window exceeds 65536 cells")
		}
		value, err := engine.WindowJSON(r.X, r.Y, r.W, r.H)
		return json.RawMessage(value), err
	case "snapshot":
		value, err := engine.Snapshot()
		return string(value), err
	case "restore":
		// Restore into a fresh engine so malformed snapshots cannot corrupt a live session.
		replacement, err := mobile.NewEngine(0, "moon")
		if err != nil {
			return nil, err
		}
		if err = replacement.Restore([]byte(r.Snapshot)); err != nil {
			return nil, err
		}
		s.engines[r.EngineID] = replacement
		return true, nil
	default:
		return nil, fmt.Errorf("takeon: unsupported operation %q", r.Op)
	}
}
