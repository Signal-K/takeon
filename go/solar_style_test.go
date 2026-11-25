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
