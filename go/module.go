package takeon

import (
	"encoding/json"
	"math"
	"strconv"
)

// Mission/module contract: a port of packages/engine/src/module/{types,state}.ts.
// Pure and deterministic; JSON output is byte-identical to TS JSON.stringify.

const SchemaVersion = 2

type Vec2f struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Objective struct {
	Kind   string  `json:"kind"`
	Label  string  `json:"label"`
	Target float64 `json:"target"`
}

type Mission struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Objectives []Objective `json:"objectives"`
}

type WorldState struct {
	SchemaVersion int      `json:"schemaVersion"`
	Base          Vec2f    `json:"base"`
	Rover         Vec2f    `json:"rover"`
	Explored      []string `json:"explored"`
	HeldData      float64  `json:"heldData"`
	HeldSamples   float64  `json:"heldSamples"`
	BankedData    float64  `json:"bankedData"`
	BankedSamples float64  `json:"bankedSamples"`
	Mission       Mission  `json:"mission"`
}

type ObjectiveProgress struct {
	Objective
	Current  float64 `json:"current"`
	Complete bool    `json:"complete"`
}

type MissionProgress struct {
	MissionID  string              `json:"missionId"`
	Name       string              `json:"name"`
	Objectives []ObjectiveProgress `json:"objectives"`
	Complete   bool                `json:"complete"`
}

// Gain is the field yield picked up when entering a tile.
type Gain struct{ Data, Samples float64 }

func TileKey(x, y float64) string {
	return strconv.FormatFloat(x, 'f', -1, 64) + "," + strconv.FormatFloat(y, 'f', -1, 64)
}

func DemoMission() Mission {
	return Mission{ID: "demo-survey", Name: "Field Survey", Objectives: []Objective{
		{"explore", "Survey sites", 3}, {"data", "Bank data", 8}, {"samples", "Bank samples", 3},
	}}
}

func cloneMission(m Mission) Mission {
	o := make([]Objective, len(m.Objectives))
	copy(o, m.Objectives)
	return Mission{m.ID, m.Name, o}
}

func NewWorldState(base Vec2f, m Mission) WorldState {
	return WorldState{
		SchemaVersion: SchemaVersion, Base: base, Rover: base,
		Explored: []string{TileKey(base.X, base.Y)}, Mission: cloneMission(m),
	}
}

// Explore moves the rover to tile, marks it explored and pockets held yield.
func (s WorldState) Explore(tile Vec2f, g Gain) WorldState {
	key := TileKey(tile.X, tile.Y)
	ex := s.Explored
	has := false
	for _, k := range ex {
		if k == key {
			has = true
			break
		}
	}
	if !has {
		ex = append(append([]string{}, ex...), key)
	}
	s.Rover, s.Explored = tile, ex
	s.HeldData += g.Data
	s.HeldSamples += g.Samples
	return s
}

// ReturnToBase banks everything held.
func (s WorldState) ReturnToBase() WorldState {
	s.Rover = s.Base
	s.BankedData += s.HeldData
	s.BankedSamples += s.HeldSamples
	s.HeldData, s.HeldSamples = 0, 0
	return s
}

func (s WorldState) Reset() WorldState { return NewWorldState(s.Base, s.Mission) }

func (s WorldState) value(kind string) float64 {
	switch kind {
	case "explore":
		return float64(len(s.Explored))
	case "data":
		return s.BankedData
	case "samples":
		return s.BankedSamples
	}
	return 0
}

func (s WorldState) Progress() MissionProgress {
	p := MissionProgress{MissionID: s.Mission.ID, Name: s.Mission.Name, Objectives: []ObjectiveProgress{}}
	all := true
	for _, o := range s.Mission.Objectives {
		cur := s.value(o.Kind)
		done := cur >= o.Target
		all = all && done
		p.Objectives = append(p.Objectives, ObjectiveProgress{o, math.Min(cur, o.Target), done})
	}
	p.Complete = len(p.Objectives) > 0 && all
	return p
}

func (s WorldState) Serialize() (string, error) {
	b, err := json.Marshal(s)
	return string(b), err
}

// ParseWorldState mirrors parseWorldState: tolerant, never fails, migrates v1.
func ParseWorldState(raw []byte, base Vec2f) WorldState {
	var obj map[string]any
	if json.Unmarshal(raw, &obj) != nil || obj == nil {
		return NewWorldState(base, DemoMission())
	}
	readVec := func(v any) (Vec2f, bool) {
		if m, ok := v.(map[string]any); ok {
			x, okx := m["x"].(float64)
			y, oky := m["y"].(float64)
			if okx && oky {
				return Vec2f{x, y}, true
			}
		}
		return Vec2f{}, false
	}
	num := func(v any, fb float64) float64 {
		if f, ok := v.(float64); ok && !math.IsInf(f, 0) && !math.IsNaN(f) {
			return f
		}
		return fb
	}
	b0, hasBase := readVec(obj["base"])
	fbBase := base
	if hasBase {
		fbBase = b0
	}
	fallback := NewWorldState(fbBase, DemoMission())
	version := 1.0
	if v, ok := obj["schemaVersion"].(float64); ok {
		version = v
	}
	explored := fallback.Explored
	if arr, ok := obj["explored"].([]any); ok {
		explored = []string{}
		for _, k := range arr {
			if s, ok := k.(string); ok {
				explored = append(explored, s)
			}
		}
	}
	if len(explored) == 0 {
		explored = fallback.Explored
	}
	bd, bs := 0.0, 0.0
	if version < 2 {
		bd, bs = num(obj["data"], 0), num(obj["samples"], 0)
	}
	mission := fallback.Mission
	if m, ok := obj["mission"].(map[string]any); ok {
		if id, ok := m["id"].(string); ok {
			if objs, ok := m["objectives"].([]any); ok {
				mm := Mission{ID: id, Objectives: []Objective{}}
				mm.Name, _ = m["name"].(string)
				for _, o := range objs {
					om, _ := o.(map[string]any)
					ob := Objective{}
					ob.Kind, _ = om["kind"].(string)
					ob.Label, _ = om["label"].(string)
					ob.Target, _ = om["target"].(float64)
					mm.Objectives = append(mm.Objectives, ob)
				}
				mission = mm
			}
		}
	}
	rover := fbBase
	if r, ok := readVec(obj["rover"]); ok {
		rover = r
	} else if hasBase {
		rover = b0
	}
	return WorldState{
		SchemaVersion: SchemaVersion, Base: fbBase, Rover: rover, Explored: explored,
		HeldData: num(obj["heldData"], 0), HeldSamples: num(obj["heldSamples"], 0),
		BankedData: num(obj["bankedData"], bd), BankedSamples: num(obj["bankedSamples"], bs),
		Mission: mission,
	}
}
