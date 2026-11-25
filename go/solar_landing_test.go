package takeon

import (
	"math"
	"reflect"
	"testing"
)

func TestSolarLanding(t *testing.T) {
	for _, p := range SolarProfiles() {
		if !p.Landable {
			if _, err := PrepareSolarLanding(p.ID, 42, 0, 0, 0.1, 3, 3); err == nil {
				t.Fatalf("%s accepted landing", p.ID)
			}
			continue
		}
		a, err := PrepareSolarLanding(p.ID, 42, 10, 179.95, 0.1, 3, 3)
		if err != nil {
			t.Fatal(err)
		}
		b, err := PrepareSolarLanding(p.ID, 42, 10, 179.95, 0.1, 3, 3)
		if err != nil || !reflect.DeepEqual(a, b) {
			t.Fatalf("%s landing unstable", p.ID)
		}
		if a.Patch[4] != a.Center || a.StyleVersion != SolarStyleVersion {
			t.Fatalf("%s center mismatch", p.ID)
		}
		across, err := SampleStyledSolarBody(p.ID, 42, 10, -179.95)
		if err != nil || math.Abs(a.Patch[5].Radius-across.Radius) > 1e-12 {
			t.Fatalf("%s dateline mismatch", p.ID)
		}
		dot := func(a, b [3]float64) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
		if math.Abs(dot(a.Up, a.East)) > 1e-12 || math.Abs(dot(a.Up, a.North)) > 1e-12 || math.Abs(dot(a.Up, a.Up)-1) > 1e-12 {
			t.Fatalf("%s invalid local frame", p.ID)
		}
	}
	if _, err := PrepareSolarLanding("mars", 1, 89.99, 0, 1, 3, 3); err == nil {
		t.Fatal("cross-pole patch accepted")
	}
	if _, err := PrepareSolarLanding("mars", 1, 0, 0, 1, 2, 3); err == nil {
		t.Fatal("even patch accepted")
	}
}
