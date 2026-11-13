package takeon

import (
	"encoding/json"
	"strings"
	"testing"
)

func findMinable(g *Game) (int, int) {
	for d := 2; d < 12; d++ {
		for dx := -d; dx <= d; dx++ {
			for dy := -d; dy <= d; dy++ {
				x, y := g.rover.Pos.X+dx, g.rover.Pos.Y+dy
				if g.world.InBounds(x, y) && g.world.IsSolid(x, y) && g.world.Height(x, y) > g.world.Height(g.rover.Pos.X, g.rover.Pos.Y) {
					if _, ok := g.plan(x, y); ok {
						return x, y
					}
				}
			}
		}
	}
	return -1, -1
}

func TestEasyMiningAndMission(t *testing.T) {
	run := func() (string, string) {
		g, err := NewGame(4212, "terra")
		if err != nil {
			t.Fatal(err)
		}
		x, y := findMinable(g)
		if x < 0 || !g.OrderMine(x, y) {
			t.Fatal("no minable target")
		}
		var evs []string
		for i := 0; i < 1500 && g.HasOrder(); i++ {
			g.Tick()
		}
		e, _ := g.DrainEvents()
		evs = append(evs, e)
		if g.HasOrder() {
			t.Fatal("order did not finish")
		}
		if !strings.Contains(e, `"mineOrder"`) || !strings.Contains(e, `"done"`) {
			t.Fatalf("expected mineOrder done, got %s", e)
		}
		if !strings.Contains(e, "depositMined") && g.rover.CargoUsed == 0 {
			t.Log("no deposit yield (plain regolith column)")
		}
		st, _ := g.Mission()
		if len(st.Explored) < 2 || st.HeldData < 1 {
			t.Fatalf("mission hooks did not fire: %+v", st)
		}
		snap, _ := g.Snapshot()
		g2, _ := NewGame(1, "moon")
		if err := g2.Restore(snap); err != nil {
			t.Fatal(err)
		}
		a, _ := json.Marshal(g.State())
		b, _ := json.Marshal(g2.State())
		if string(a) != string(b) {
			t.Fatal("snapshot restore mismatch incl. mission")
		}
		return strings.Join(evs, "|"), string(a)
	}
	e1, s1 := run()
	e2, s2 := run()
	if e1 != e2 || s1 != s2 {
		t.Fatal("non-deterministic runtime")
	}
}

func TestBankMissionComplete(t *testing.T) {
	g, _ := NewGame(1, "terra")
	g.SetMission(Mission{ID: "t", Name: "T", Objectives: []Objective{{"data", "d", 2}}})
	g.mission.HeldData = 2
	if !g.Bank() {
		t.Fatal("bank at landing failed")
	}
	_, p := g.Mission()
	if !p.Complete {
		t.Fatal("mission should complete")
	}
	ev, _ := g.DrainEvents()
	if !strings.Contains(ev, "missionComplete") {
		t.Fatal(ev)
	}
}
