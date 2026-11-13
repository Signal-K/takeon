package takeon

import (
	"encoding/json"
	"testing"
)

func TestSeededDropoff(t *testing.T) {
	g, err := NewGame(4212, "moon")
	if err != nil {
		t.Fatal(err)
	}
	g.SeedCache()
	g.SeedCache()
	if len(g.caches) != 1 || g.caches[0] != (Vec2{X: g.rover.Pos.X + 1, Y: g.rover.Pos.Y}) {
		t.Fatalf("one cache beside the rover, got %v", g.caches)
	}
	g.SeedCargo(map[string]float64{"iron": 3, "stone": 2, "ice": 0})
	if g.rover.CargoUsed != 5 || len(g.rover.Cargo) != 2 {
		t.Fatalf("seeded hold: %v used %v", g.rover.Cargo, g.rover.CargoUsed)
	}

	snap, err := g.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	r, _ := NewGame(1, "mars")
	if err := r.Restore(snap); err != nil {
		t.Fatal(err)
	}
	if len(r.caches) != 1 || r.rover.CargoUsed != 5 {
		t.Fatalf("restore lost the drop-off: %v %v", r.caches, r.rover.CargoUsed)
	}

	// Out of reach: two tiles from the cache.
	g.rover.Pos.X -= 1
	if moved := g.Deposit(); moved != 0 {
		t.Fatalf("deposited from two tiles away: %v", moved)
	}
	g.rover.Pos.X += 1
	if moved := g.Deposit(); moved != 5 {
		t.Fatalf("moved %v, want 5", moved)
	}
	if g.rover.CargoUsed != 0 || len(g.rover.Cargo) != 0 || g.banked["iron"] != 3 || g.banked["stone"] != 2 {
		t.Fatalf("hold %v banked %v", g.rover.Cargo, g.banked)
	}
	var events []Event
	raw, _ := g.DrainEvents()
	if err := json.Unmarshal([]byte(raw), &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Kind != "cargoDeposited" || events[0].Amount != 5 || events[1].Kind != "stateChanged" {
		t.Fatalf("events %s", raw)
	}

	if g.Deposit() != 0 {
		t.Fatal("an empty hold moves nothing")
	}
}
