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

// These saved coordinates represent persisted destinations, not a snapshot of
// implementation details: changes would move terrain underneath an active run.
func TestSavedSolarLandingsV1(t *testing.T) {
	for _, tc := range []struct {
		id                       string
		seed                     uint32
		lat, lon, center, corner float64
		biome                    string
	}{
		{"mars", 42, 18.4, 77.2, 0.963652426224116, 0.963922676933357, "red-desert"},
		{"moon", 7, -20.5, 120.25, 1.003002823479115, 1.003404101275979, "regolith"},
		{"eros", 123, 12, -40, 0.998821772128219, 0.997985240065255, "regolith"},
	} {
		got, err := PrepareVersionedSolarLanding(1, tc.id, tc.seed, tc.lat, tc.lon, 0.1, 3, 3)
		if err != nil || math.Abs(got.Center.Radius-tc.center) > 1e-10 || math.Abs(got.Patch[0].Radius-tc.corner) > 1e-10 || got.Center.Biome != tc.biome {
			t.Fatalf("saved %s landing changed: %+v, %v", tc.id, got, err)
		}
	}
	for _, version := range []int{0, 2, -1} {
		if _, err := PrepareVersionedSolarLanding(version, "mars", 42, 0, 0, .1, 3, 3); err == nil {
			t.Fatalf("unsupported version %d accepted", version)
		}
	}
}
