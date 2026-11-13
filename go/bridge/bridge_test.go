package bridge

import (
	"encoding/json"
	"testing"
)

func request(t *testing.T, s *Session, r Request) response {
	t.Helper()
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var out response
	if err := json.Unmarshal([]byte(s.Call(string(b))), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func success(t *testing.T, s *Session, r Request) any {
	t.Helper()
	out := request(t, s, r)
	if !out.OK {
		t.Fatalf("%s failed: %s", r.Op, out.Error)
	}
	return out.Value
}
func encoded(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestIsolatedEnginesAndSnapshot(t *testing.T) {
	var s Session
	a := int(success(t, &s, Request{Op: "create", BodyID: "moon", Seed: 4212}).(float64))
	b := int(success(t, &s, Request{Op: "create", BodyID: "moon", Seed: 4212}).(float64))
	original := encoded(success(t, &s, Request{Op: "state", EngineID: b}))
	success(t, &s, Request{Op: "step", EngineID: a, DT: 1})
	if encoded(success(t, &s, Request{Op: "state", EngineID: b})) != original {
		t.Fatal("engine a changed engine b")
	}
	snapshot := success(t, &s, Request{Op: "snapshot", EngineID: a}).(string)
	success(t, &s, Request{Op: "restore", EngineID: b, Snapshot: snapshot})
	for _, id := range []int{a, b} {
		success(t, &s, Request{Op: "step", EngineID: id, DT: 0.5})
	}
	if encoded(success(t, &s, Request{Op: "state", EngineID: a})) != encoded(success(t, &s, Request{Op: "state", EngineID: b})) {
		t.Fatal("snapshot continuation diverged")
	}
	success(t, &s, Request{Op: "dispose", EngineID: a})
	if request(t, &s, Request{Op: "state", EngineID: a}).OK {
		t.Fatal("disposed engine accepted a call")
	}
	success(t, &s, Request{Op: "step", EngineID: b, DT: 0.1})
}
func TestFailuresLeaveSessionUsable(t *testing.T) {
	var s Session
	if request(t, &s, Request{Op: "create", BodyID: "missing"}).OK {
		t.Fatal("unknown body accepted")
	}
	id := int(success(t, &s, Request{Op: "create", BodyID: "moon"}).(float64))
	before := success(t, &s, Request{Op: "snapshot", EngineID: id}).(string)
	for _, r := range []Request{
		{Op: "order", EngineID: id, Kind: "build"},
		{Op: "order", EngineID: id, Kind: "move", Arg: 4},
		{Op: "step", EngineID: id, DT: -1},
		{Op: "step", EngineID: id, DT: 61},
		{Op: "orderMine", EngineID: id, X: 65536},
		{Op: "window", EngineID: id, W: 65536, H: 65536},
		{Op: "seedCargo", EngineID: id, Cargo: map[string]float64{"iron": -1}},
		{Op: "restore", EngineID: id, Snapshot: `{"v":100}`},
	} {
		if request(t, &s, r).OK {
			t.Fatalf("invalid %s accepted", r.Op)
		}
	}
	if after := success(t, &s, Request{Op: "snapshot", EngineID: id}).(string); before != after {
		t.Fatal("failed commands changed state")
	}
	if out := s.Call("{"); out == "" {
		t.Fatal("malformed request got no response")
	}
}
