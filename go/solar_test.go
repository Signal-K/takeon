package takeon

import (
	"math"
	"reflect"
	"testing"
)

func TestSolarProfilesAndSampling(t *testing.T) {
	profiles := SolarProfiles()
	if len(profiles) < 26 {
		t.Fatalf("expected at least 26 profiles, got %d", len(profiles))
	}
	seen := map[string]bool{}
	for _, p := range profiles {
		if seen[p.ID] {
			t.Fatalf("duplicate %s", p.ID)
		}
		seen[p.ID] = true
		a, err := SampleSolarBody(p.ID, 42, 15, 70)
		if err != nil {
			t.Fatal(err)
		}
		b, err := SampleSolarBody(p.ID, 42, 15, 70)
		if err != nil || a != b {
			t.Fatalf("%s is not deterministic", p.ID)
		}
		if a.Biome == "" || math.IsNaN(a.Elevation) || math.IsNaN(a.Temperature) {
			t.Fatalf("invalid %s: %+v", p.ID, a)
		}
		if p.Landable {
			if _, err := SampleSolarPatch(p.ID, 42, 15, 70, 0.25, 2, 2); err != nil {
				t.Fatalf("%s: %v", p.ID, err)
			}
		} else if _, err := SampleSolarPatch(p.ID, 42, 15, 70, 0.25, 2, 2); err == nil {
			t.Fatalf("%s has land", p.ID)
		}
	}
	profiles[0].Name = "changed"
	fresh, _ := SolarProfileByID(profiles[0].ID)
	if fresh.Name == "changed" {
		t.Fatal("profile registry was mutable")
	}
}
func TestSolarPatchMatchesGlobe(t *testing.T) {
	for _, id := range []string{"earth", "mars", "europa", "eros", "psyche"} {
		patch, err := SampleSolarPatch(id, 123, -40, 35, 0.5, 4, 3)
		if err != nil {
			t.Fatal(err)
		}
		for y := 0; y < 3; y++ {
			for x := 0; x < 4; x++ {
				sample, err := SampleSolarBody(id, 123, -40+float64(y)*0.5, 35+float64(x)*0.5)
				if err != nil || !reflect.DeepEqual(patch[y*4+x], sample) {
					t.Fatalf("%s patch differs from globe", id)
				}
			}
		}
	}
}
func TestSolarBodyIdentityChangesTerrain(t *testing.T) {
	a, _ := SampleSolarBody("moon", 42, 20, 40)
	b, _ := SampleSolarBody("phobos", 42, 20, 40)
	if a.Elevation/0.65 == b.Elevation/0.8 {
		t.Fatal("bodies shared a terrain field")
	}
}
func TestSolarSeamsAndTemperature(t *testing.T) {
	a, _ := SampleSolarBody("earth", 42, 30, -180)
	b, _ := SampleSolarBody("earth", 42, 30, 180)
	if math.Abs(a.Elevation-b.Elevation) > 1e-12 || a.Biome != b.Biome {
		t.Fatalf("dateline discontinuity: %+v %+v", a, b)
	}
	north, _ := SampleSolarBody("earth", 42, 90, 0)
	north2, _ := SampleSolarBody("earth", 42, 90, 150)
	if math.Abs(north.Elevation-north2.Elevation) > 1e-12 {
		t.Fatal("pole discontinuity")
	}
	equator, _ := SampleSolarBody("earth", 42, 0, 0)
	if north.Temperature >= equator.Temperature {
		t.Fatal("latitude did not cool pole")
	}
}
func TestSolarInvalidInput(t *testing.T) {
	for _, args := range [][2]float64{{91, 0}, {0, 181}, {math.NaN(), 0}, {0, math.Inf(1)}} {
		if _, err := SampleSolarBody("mars", 0, args[0], args[1]); err == nil {
			t.Fatal("invalid coordinate accepted")
		}
	}
	if _, err := SampleSolarBody("unknown", 0, 0, 0); err == nil {
		t.Fatal("unknown body accepted")
	}
	for _, size := range [][2]int{{0, 1}, {257, 1}, {1, -1}} {
		if _, err := SampleSolarPatch("mars", 0, 0, 0, 1, size[0], size[1]); err == nil {
			t.Fatal("invalid patch accepted")
		}
	}
	if _, err := SampleSolarPatch("mars", 0, 89, 0, 2, 1, 2); err == nil {
		t.Fatal("patch crosses pole")
	}
}
