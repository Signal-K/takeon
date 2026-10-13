package mobile

import "testing"

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
