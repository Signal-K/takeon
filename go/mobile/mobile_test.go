package mobile

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFacadeRoundTrip(t *testing.T) {
	e, err := NewEngine(4212, "mars")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := e.Order("move", 0); err != nil || !ok {
		t.Fatalf("move: %v %v", ok, err)
	}
	if _, err := e.Step(1.0); err != nil {
		t.Fatal(err)
	}
	snap, err := e.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	e2, _ := NewEngine(1, "moon")
	if err := e2.Restore(snap); err != nil {
		t.Fatal(err)
	}
	a, _ := e.StateJSON()
	b, _ := e2.StateJSON()
	if a != b {
		t.Fatalf("state differs after restore:\n%s\n%s", a, b)
	}
}

func TestWindowJSON(t *testing.T) {
	e, err := NewEngine(4212, "moon")
	if err != nil {
		t.Fatal(err)
	}
	js, err := e.WindowJSON(10, 10, 4, 3)
	if err != nil || len(js) == 0 {
		t.Fatalf("window: %q %v", js, err)
	}
	var win struct{ Ore, Mats, Heights []int }
	if err := json.Unmarshal([]byte(js), &win); err != nil || len(win.Ore) != 12 || len(win.Mats) != 12 || len(win.Heights) != 12 {
		t.Fatalf("window arrays: %+v %v", win, err)
	}
	if _, err := e.WindowJSON(0, 0, 1000, 1000); err == nil {
		t.Fatal("oversize window must error")
	}
}

func TestFlightDrawAndHUDJSON(t *testing.T) {
	f, err := NewFlight(`{"seed":4,"duration":20,"debris":0.4,"pickups":0.4}`)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.SetCraftJSON(`{"sections":[{"id":"b","length":1,"r0":0.2,"r1":0.1,"color":"#ddccbb"}],"scale":1.2}`); err != nil {
		t.Fatal(err)
	}
	if f.SetCraftJSON(`{"sections":[]}`) == nil {
		t.Fatal("empty craft accepted")
	}
	f.SteerToward(0.8, 0)
	if _, err := f.Step(1); err != nil {
		t.Fatal(err)
	}
	draw, err := f.DrawJSON(390, 844, 1.0/60)
	if err != nil || !strings.Contains(draw, `"k":"sky"`) || !strings.Contains(draw, `"#ddccbb"`) {
		t.Fatalf("draw json: %v %.200s", err, draw)
	}
	hud, err := f.HudJSON()
	if err != nil || !strings.Contains(hud, `"prompt":`) {
		t.Fatalf("hud json: %v %s", err, hud)
	}
}
