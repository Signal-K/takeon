package mobile

import (
	"encoding/json"
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
