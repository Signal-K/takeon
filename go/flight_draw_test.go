package takeon

import (
	"encoding/json"
	"math"
	"testing"
)

func shapeKinds(d FlightDraw) map[string]int {
	n := map[string]int{}
	for _, s := range d.Shapes {
		n[s.K]++
	}
	return n
}

func TestFlightDrawIsDeterministicAndComplete(t *testing.T) {
	cfg := FlightConfig{Seed: 11, Duration: 30, Debris: 0.6, Pickups: 0.5}
	a, _ := NewFlight(cfg)
	b, _ := NewFlight(cfg)
	var da, db FlightDraw
	for i := 0; i < 60*8; i++ {
		a.Step(1.0 / 60)
		b.Step(1.0 / 60)
		da = a.Draw(390, 844, 1.0/60)
		db = b.Draw(390, 844, 1.0/60)
	}
	ja, _ := json.Marshal(da)
	jb, _ := json.Marshal(db)
	if string(ja) != string(jb) {
		t.Fatal("same flight drew different frames")
	}
	if da.Shapes[0].K != ShapeSky {
		t.Fatalf("the sky is painted first, got %q", da.Shapes[0].K)
	}
	k := shapeKinds(da)
	if k[ShapeGlobe] != 1 || k[ShapeEllipse] < 20 || k[ShapeGlow] < 10 || k[ShapeLine] < 20 || k[ShapePoly] == 0 {
		t.Fatalf("cruise frame is missing parts: %v", k)
	}
	if k[ShapeLimb] != 0 {
		t.Fatal("no limb before orbit")
	}
	for _, s := range da.Shapes {
		for _, v := range append([]float64{s.X, s.Y, s.X2, s.Y2, s.RX, s.RY, s.Rot, s.A}, s.Pts...) {
			if !finite(v) {
				t.Fatalf("non-finite value in %q", s.K)
			}
		}
		if s.A <= 0 || s.A > 1.0001 {
			t.Fatalf("%q alpha %.3f out of range", s.K, s.A)
		}
	}
}

func TestFlightDrawCraftFollowsTheLook(t *testing.T) {
	f, _ := NewFlight(FlightConfig{Seed: 3, Duration: 30})
	f.Step(0.5)
	plain := shapeKinds(f.Draw(926, 428, 0))
	err := f.SetCraft(FlightCraftLook{Sections: []FlightCraftSection{{ID: "body", Length: 1, R0: 0.2, R1: 0.2, Color: "#ff0000"}},
		Boosters: &FlightCraftBoosters{Count: 2, Radius: 0.08, Length: 0.6, Color: "#00ff00"}, Scale: 1})
	if err != nil {
		t.Fatal(err)
	}
	d := f.Draw(926, 428, 0)
	red, green := 0, 0
	for _, s := range d.Shapes {
		if s.K == ShapeEllipse && s.Fill == "#ff0000" {
			red++
		}
		if s.K == ShapeEllipse && s.Fill == "#00ff00" {
			green++
		}
	}
	if red == 0 || green == 0 {
		t.Fatalf("craft look not drawn: red %d green %d", red, green)
	}
	if shapeKinds(d)[ShapePoly] >= plain[ShapePoly] {
		t.Fatal("a craft without fins should draw fewer polygons")
	}
	if f.SetCraft(FlightCraftLook{}) == nil {
		t.Fatal("a craft with no sections is rejected")
	}
}

func TestFlightDrawOrbitShowsLimbSitesAndEases(t *testing.T) {
	f, _ := NewFlight(FlightConfig{Seed: 5, StartPhase: FlightOrbit, OrbitPeriod: 20, Sites: []FlightSite{{ID: "a", Label: "Crater", Angle: 0.1}}})
	d := f.Draw(926, 428, 1.0/60)
	if d.OrbitMix != 1 {
		t.Fatalf("a stage mounted in orbit starts in orbit, mix %.2f", d.OrbitMix)
	}
	k := shapeKinds(d)
	if k[ShapeLimb] != 1 || k[ShapeGlobe] != 0 || k[ShapeText] != 1 {
		t.Fatalf("orbit frame: %v", k)
	}
	// From cruise into orbit the views cross-fade over about a second.
	g, _ := NewFlight(FlightConfig{Seed: 5, Duration: 5})
	g.Draw(926, 428, 0)
	for i := 0; i < 60*60 && g.State().Phase != FlightOrbit; i++ {
		g.Step(1.0 / 60)
	}
	mid := g.Draw(926, 428, 0.4)
	if mid.OrbitMix <= 0 || mid.OrbitMix >= 1 || shapeKinds(mid)[ShapeLimb] != 1 || shapeKinds(mid)[ShapeGlobe] != 1 {
		t.Fatalf("expected a cross-fade, mix %.2f %v", mid.OrbitMix, shapeKinds(mid))
	}
}

func TestFlightDrawHitShakesAndFlashes(t *testing.T) {
	f, _ := NewFlight(FlightConfig{Seed: 2, Duration: 30, Debris: 1})
	f.Draw(390, 844, 0)
	hit := false
	for i := 0; i < 60*20 && !hit; i++ {
		frame, _ := f.Step(1.0 / 60)
		for _, e := range frame.Events {
			hit = hit || e.Kind == "hit"
		}
	}
	if !hit {
		t.Skip("no hit in this corridor")
	}
	if shapeKinds(f.Draw(390, 844, 0.01))[ShapeVignette] != 1 {
		t.Fatal("a hit flashes the edges red")
	}
	f.Draw(390, 844, 0.25)
	if shapeKinds(f.Draw(390, 844, 0.25))[ShapeVignette] != 0 {
		t.Fatal("the flash fades")
	}
}

func TestFlightHUDAndTouchSteer(t *testing.T) {
	st := FlightState{Phase: FlightOrbit, Overhead: "a", Marked: []string{}, Boost: 1.5, Progress: 1}
	h := FlightHUDOf(st, 2)
	if !h.CanMark || h.Prompt != "Over a site. Mark it." || h.Boosts != 1 || math.Abs(h.BoostCharge-0.5) > 1e-9 || h.Percent != 100 {
		t.Fatalf("hud: %+v", h)
	}
	st.Marked = []string{"a"}
	if h := FlightHUDOf(st, 2); h.CanMark || h.Prompt != "In orbit. Wait for the next site." {
		t.Fatalf("marked site: %+v", h)
	}
	if h := FlightHUDOf(FlightState{Phase: FlightCruise, Slowed: true}, 0); h.Prompt != "Hit. Steer clear of debris." || h.Overhead != nil {
		t.Fatalf("cruise: %+v", h)
	}
	x, y := FlightTouchSteer(FlightState{Phase: FlightCruise, X: 0.5}, 0.5, 0)
	if math.Abs(x-0.225) > 1e-9 || y != 0 {
		t.Fatalf("corridor touch pulls toward the finger: %.3f %.3f", x, y)
	}
	if x, y := FlightTouchSteer(FlightState{Phase: FlightOrbit}, 2, -0.4); x != 1 || y != -0.4 {
		t.Fatalf("orbit touch is the nudge itself: %.3f %.3f", x, y)
	}
	if x, y := FlightTouchSteer(FlightState{}, math.NaN(), 0); x != 0 || y != 0 {
		t.Fatal("bad touch is ignored")
	}
}
