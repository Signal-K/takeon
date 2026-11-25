package bridge

import (
	"encoding/json"
	takeon "github.com/Signal-K/takeon-go"
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

func TestLandingVersionCompatibility(t *testing.T) {
	var s Session
	q := &SolarRequest{ID: "mars", Seed: 42, Latitude: 10, Longitude: 20, Step: .1, Width: 3, Height: 3}
	legacy := success(t, &s, Request{Op: "solarLanding", Solar: q})
	v := 1
	q.StyleVersion = &v
	if encoded(legacy) != encoded(success(t, &s, Request{Op: "solarLanding", Solar: q})) {
		t.Fatal("versioned landing differs from existing call")
	}
	landing := success(t, &s, Request{Op: "solarLanding", Solar: q}).(map[string]any)
	if encoded(landing["center"]) != encoded(success(t, &s, Request{Op: "styledSolarSample", Solar: q})) {
		t.Fatal("saved orbital sample differs from landing center")
	}
	v = 0
	if request(t, &s, Request{Op: "solarLanding", Solar: q}).OK {
		t.Fatal("explicit unsupported version accepted")
	}
	if request(t, &s, Request{Op: "styledSolarSample", Solar: q}).OK {
		t.Fatal("orbital sample accepted unsupported version")
	}
}

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

func TestLocationBridge(t *testing.T) {
	var s Session
	spec := takeon.LocationSpec{Version: 1, ID: "site-1", ParentID: "system-1", BodyID: "mars", Seed: 42}
	want, err := takeon.GenerateLocation(spec)
	if err != nil {
		t.Fatal(err)
	}
	got := success(t, &s, Request{Op: "location", Location: &spec})
	var actual takeon.Location
	if err := json.Unmarshal([]byte(encoded(got)), &actual); err != nil || actual != want {
		t.Fatalf("bridge differs from core: %+v != %+v (%v)", actual, want, err)
	}
	if request(t, &s, Request{Op: "location"}).OK {
		t.Fatal("missing location accepted")
	}
}

func TestSolarBridge(t *testing.T) {
	var s Session
	spec := &SolarRequest{ID: "mars", Seed: 42, Latitude: 10, Longitude: 20, Step: 1, Width: 2, Height: 2}
	sample := success(t, &s, Request{Op: "solarSample", Solar: spec})
	patch := success(t, &s, Request{Op: "solarPatch", Solar: spec}).([]any)
	if encoded(sample) != encoded(patch[0]) {
		t.Fatal("patch and globe bridge samples differ")
	}
	styled := success(t, &s, Request{Op: "styledSolarSample", Solar: spec})
	styledPatch := success(t, &s, Request{Op: "styledSolarPatch", Solar: spec}).([]any)
	if encoded(styled) != encoded(styledPatch[0]) {
		t.Fatal("styled patch and globe bridge samples differ")
	}
	landingSpec := &SolarRequest{ID: "mars", Seed: 42, Latitude: 10, Longitude: 20, Step: 1, Width: 3, Height: 3}
	landing := success(t, &s, Request{Op: "solarLanding", Solar: landingSpec}).(map[string]any)
	if encoded(landing["center"]) != encoded(styled) {
		t.Fatal("landing center differs from globe")
	}
	if request(t, &s, Request{Op: "solarSample"}).OK {
		t.Fatal("missing solar request accepted")
	}
}

func TestGasOrbitBridgeDoesNotAllowLanding(t *testing.T) {
	var s Session
	version := 1
	q := &SolarRequest{ID: "jupiter", Seed: 42, Step: 3, Width: 3, Height: 3, StyleVersion: &version}
	orbit := success(t, &s, Request{Op: "solarOrbit", Solar: q}).(map[string]any)
	if orbit["bodyId"] != "jupiter" || len(orbit["patch"].([]any)) != 9 {
		t.Fatal("invalid gas orbit")
	}
	if request(t, &s, Request{Op: "solarLanding", Solar: q}).OK {
		t.Fatal("gas landing was accepted")
	}
	version = 99
	if request(t, &s, Request{Op: "solarOrbit", Solar: q}).OK {
		t.Fatal("unsupported orbit version was accepted")
	}
}
