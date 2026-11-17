package takeon

import (
	"encoding/json"
	"math"
	"testing"
)

func runFlight(t *testing.T, f *Flight, seconds float64, steer func(s FlightState) (float64, float64)) (FlightState, []FlightEvent) {
	t.Helper()
	var all []FlightEvent
	var st FlightState
	for i := 0; i < int(seconds*60); i++ {
		if steer != nil {
			f.Steer(steer(f.State()))
		}
		frame, err := f.Step(1.0 / 60)
		if err != nil {
			t.Fatal(err)
		}
		st = frame.State
		all = append(all, frame.Events...)
	}
	return st, all
}

func TestFlightIsDeterministicAndReachesOrbit(t *testing.T) {
	cfg := FlightConfig{Seed: 7, Duration: 30, Debris: 0.5, Pickups: 0.4, BoostCharges: 1}
	a, _ := NewFlight(cfg)
	b, _ := NewFlight(cfg)
	wobble := func(s FlightState) (float64, float64) { return math.Sin(s.Time), math.Cos(s.Time * 0.7) }
	sa, ea := runFlight(t, a, 50, wobble)
	sb, eb := runFlight(t, b, 50, wobble)
	ja, _ := json.Marshal([]any{sa, ea})
	jb, _ := json.Marshal([]any{sb, eb})
	if string(ja) != string(jb) {
		t.Fatal("same config and inputs gave different flights")
	}
	if sa.Phase != FlightOrbit || sa.Progress != 1 {
		t.Fatalf("flight did not reach orbit: %s %.2f", sa.Phase, sa.Progress)
	}
	phases := []string{}
	for _, e := range ea {
		if e.Kind == "phase" {
			phases = append(phases, e.Detail)
		}
	}
	if len(phases) != 3 || phases[0] != FlightCruise || phases[1] != FlightApproach || phases[2] != FlightOrbit {
		t.Fatalf("phases out of order: %v", phases)
	}
}

func TestFlightControlIsLimitedToTheCorridor(t *testing.T) {
	f, _ := NewFlight(FlightConfig{Seed: 1, Duration: 60})
	st, _ := runFlight(t, f, 8, func(FlightState) (float64, float64) { return 1, -1 })
	if st.X != 1 || st.Y != -1 || st.VX != 0 {
		t.Fatalf("craft left the corridor or kept pushing the wall: %+v", st)
	}
	if st.Progress <= 0 || st.Progress >= 0.2 {
		t.Fatalf("steering changed the course progress: %.3f", st.Progress)
	}
}

// A pilot who steers at what is ahead should do better than one who sits still.
func TestFlightSteeringAvoidsDebrisAndCollects(t *testing.T) {
	cfg := FlightConfig{Seed: 42, Duration: 60, Debris: 0.5, Pickups: 0.5}
	idle, _ := NewFlight(cfg)
	pilot, _ := NewFlight(cfg)
	si, _ := runFlight(t, idle, 55, nil)
	sp, _ := runFlight(t, pilot, 55, func(s FlightState) (float64, float64) {
		for _, o := range s.Objects {
			if o.Done || o.Z < 0 || o.Z > 60 {
				continue
			}
			if o.Kind == "debris" {
				if math.Hypot(o.X-s.X, o.Y-s.Y) < o.R+0.35 {
					return -math.Copysign(1, o.X-s.X+1e-9), -math.Copysign(1, o.Y-s.Y+1e-9)
				}
				continue
			}
			return clampF((o.X-s.X)*6, -1, 1), clampF((o.Y-s.Y)*6, -1, 1)
		}
		return 0, 0
	})
	if sp.Hits > si.Hits || sp.Pickups+sp.Samples <= si.Pickups+si.Samples {
		t.Fatalf("steering did not help: idle hits %d got %d, pilot hits %d got %d", si.Hits, si.Pickups+si.Samples, sp.Hits, sp.Pickups+sp.Samples)
	}
	if sp.Pickups+sp.Samples < 5 {
		t.Fatalf("a steering pilot collected only %d", sp.Pickups+sp.Samples)
	}
}

func TestFlightBoostAndHitChangePace(t *testing.T) {
	plain, _ := NewFlight(FlightConfig{Seed: 3, Duration: 60, StartPhase: FlightCruise})
	fast, _ := NewFlight(FlightConfig{Seed: 3, Duration: 60, StartPhase: FlightCruise, BoostCharges: 1})
	if plain.Boost() {
		t.Fatal("boosted with no charge")
	}
	if !fast.Boost() || fast.Boost() {
		t.Fatal("one charge must give exactly one boost")
	}
	sp, _ := runFlight(t, plain, 2, nil)
	sf, ev := runFlight(t, fast, 2, nil)
	if sf.Progress <= sp.Progress {
		t.Fatal("boost did not shorten the trip")
	}
	if len(ev) != 0 && ev[0].Kind != "boost" {
		t.Fatalf("unexpected events %v", ev)
	}
}

func TestFlightHostChoosesSamplesAndBoostGain(t *testing.T) {
	none := 0.0
	f, _ := NewFlight(FlightConfig{Seed: 42, Duration: 60, Pickups: 1, Samples: &none, BoostGain: 0.5, StartPhase: FlightCruise})
	seen := 0
	for i := 0; i < 60*20; i++ {
		frame, _ := f.Step(1.0 / 60)
		for _, o := range frame.State.Objects {
			if o.Kind == "sample" {
				t.Fatal("a host that asked for no samples got one")
			}
			seen++
		}
	}
	if seen == 0 {
		t.Fatal("no pickups generated")
	}
	g, _ := NewFlight(FlightConfig{Seed: 42, Duration: 60, Pickups: 1, Samples: &none, BoostGain: 0.5, StartPhase: FlightCruise})
	st, _ := runFlight(t, g, 40, func(s FlightState) (float64, float64) {
		for _, o := range s.Objects {
			if !o.Done && o.Z > 0 && o.Z < 60 {
				return clampF((o.X-s.X)*6, -1, 1), clampF((o.Y-s.Y)*6, -1, 1)
			}
		}
		return 0, 0
	})
	if st.Pickups < 2 || math.Abs(st.Boost-math.Min(3, float64(st.Pickups)*0.5)) > 1e-9 {
		t.Fatalf("boost gain not applied: %d pickups, %.2f charges", st.Pickups, st.Boost)
	}
}

func TestFlightHostPacedFollowsTheTripClock(t *testing.T) {
	f, _ := NewFlight(FlightConfig{Seed: 9, HostPaced: true, Debris: 0.3})
	runFlight(t, f, 5, nil)
	if f.State().Progress != 0 {
		t.Fatal("a host-paced flight advanced on its own")
	}
	f.SetProgress(0.5)
	st, _ := runFlight(t, f, 1, nil)
	if st.Phase != FlightCruise || st.Scroll <= 0 {
		t.Fatalf("host progress not applied: %+v", st.Phase)
	}
	f.SetProgress(1)
	st, _ = runFlight(t, f, 1, nil)
	if st.Phase != FlightOrbit {
		t.Fatal("host arrival did not enter orbit")
	}
}

func TestFlightOrbitSitesAndSnapshot(t *testing.T) {
	cfg := FlightConfig{Seed: 5, StartPhase: FlightOrbit, OrbitPeriod: 10, Sites: []FlightSite{{ID: "north", Angle: 1}, {ID: "south", Angle: 4}}}
	f, err := NewFlight(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if f.Mark() {
		t.Fatal("marked with nothing overhead")
	}
	marked := 0
	for i := 0; i < 60*12; i++ {
		frame, _ := f.Step(1.0 / 60)
		if frame.State.Overhead != "" && f.Mark() {
			marked++
		}
	}
	st := f.State()
	if marked != 2 || len(st.Marked) != 2 || st.Laps != 1 {
		t.Fatalf("orbit pass: marked %d laps %d", marked, st.Laps)
	}
	// A low orbit laps faster than a high one.
	low, _ := NewFlight(cfg)
	high, _ := NewFlight(cfg)
	sl, _ := runFlight(t, low, 6, func(FlightState) (float64, float64) { return 0, -1 })
	sh, _ := runFlight(t, high, 6, func(FlightState) (float64, float64) { return 0, 1 })
	if sl.Angle <= sh.Angle {
		t.Fatal("lower orbit should be faster")
	}
	snap, err := f.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	g, err := RestoreFlight(snap)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := f.Step(3)
	b, _ := g.Step(3)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) {
		t.Fatal("restored flight diverged")
	}
	if _, err := RestoreFlight([]byte(`{"format":"nope"}`)); err == nil {
		t.Fatal("accepted a foreign snapshot")
	}
	if _, err := NewFlight(FlightConfig{Duration: math.NaN()}); err == nil {
		t.Fatal("accepted a NaN duration")
	}
}
