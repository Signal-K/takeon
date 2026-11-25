package takeon

import (
	"math"
	"testing"
)

func TestLunarElevationAndWrap(t *testing.T) {
	a, err := SampleLunarSurface(0, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := SampleLunarSurface(20, 90)
	if err != nil {
		t.Fatal(err)
	}
	if a == b || a.ElevationMeters < -10000 || a.ElevationMeters > 22000 || a.Red < 0 || a.Red > 1 {
		t.Fatalf("invalid lunar data: %+v %+v", a, b)
	}
	w, _ := SampleLunarSurface(13, -180)
	e, _ := SampleLunarSurface(13, 180)
	if math.Abs(w.ElevationMeters-e.ElevationMeters) > 1e-6 {
		t.Fatal("lunar map seam")
	}
	if _, err := SampleLunarSurface(91, 0); err == nil {
		t.Fatal("invalid latitude accepted")
	}
}
