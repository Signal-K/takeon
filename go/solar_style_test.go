package takeon

import (
	"math"
	"testing"
)

func TestStyledSolarBody(t *testing.T) {
	for _, id := range []string{"mars", "moon", "earth", "jupiter"} {
		a, err := SampleStyledSolarBody(id, 42, 20, -180)
		if err != nil {
			t.Fatal(err)
		}
		b, err := SampleStyledSolarBody(id, 42, 20, 180)
		if err != nil {
			t.Fatal(err)
		}
		if math.Abs(a.Radius-b.Radius) > 1e-8 {
			t.Fatalf("%s seam: %v %v", id, a.Radius, b.Radius)
		}
		if a.Observed != (id == "mars" || id == "moon") {
			t.Fatalf("%s observed flag: %v", id, a.Observed)
		}
		if id == "jupiter" && a.Radius != 1 {
			t.Fatal("gas giant acquired a solid terrain shape")
		}
	}
	a, _ := SampleStyledSolarBody("mars", 1, 20, 20)
	b, _ := SampleStyledSolarBody("mars", 2, 20, 20)
	if a.Radius == b.Radius {
		t.Fatal("seed does not affect relief")
	}
}

func TestStyledLocationsAndPatches(t *testing.T) {
	for _, p := range SolarProfiles() {
		a, err := SampleStyledSolarBody(p.ID, 8675309, 12, 34)
		if err != nil {
			t.Fatalf("%s: %v", p.ID, err)
		}
		b, err := SampleStyledSolarBody(p.ID, 8675309, 12, 34)
		if err != nil || a != b || math.IsNaN(a.Radius) || a.Radius <= 0 {
			t.Fatalf("%s: unstable or invalid sample", p.ID)
		}
		if !p.Landable {
			continue
		}
		patch, err := SampleStyledSolarPatch(p.ID, 8675309, 12, 34, 0.25, 2, 2)
		if err != nil || patch[0] != a {
			t.Fatalf("%s: patch mismatch: %v", p.ID, err)
		}
		for i, sample := range patch {
			expected, err := SampleStyledSolarBody(p.ID, 8675309, 12+float64(i/2)*0.25, 34+float64(i%2)*0.25)
			if err != nil || sample != expected {
				t.Fatalf("%s: patch point %d mismatch", p.ID, i)
			}
		}
	}
}

func TestIrregularBodyOrientation(t *testing.T) {
	long, _ := SampleStyledSolarBody("eros", 0, 0, 0)
	short, _ := SampleStyledSolarBody("eros", 0, 0, 90)
	if long.Radius-short.Radius < .25 {
		t.Fatal("Eros shape lacks elongated silhouette")
	}
}
