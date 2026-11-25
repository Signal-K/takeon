package takeon

import "testing"

func TestObservedMarsTopography(t *testing.T) {
	summit, err := SampleObservedSurface("mars", 18.65, -133.8)
	if err != nil {
		t.Fatal(err)
	}
	if summit.ElevationMeters == nil || *summit.ElevationMeters < 15000 {
		t.Fatalf("Olympus Mons height: %+v", summit.ElevationMeters)
	}
	east, err := SampleObservedSurface("mars", 0, 180)
	if err != nil {
		t.Fatal(err)
	}
	west, err := SampleObservedSurface("mars", 0, -180)
	if err != nil {
		t.Fatal(err)
	}
	if *east.ElevationMeters != *west.ElevationMeters {
		t.Fatal("dateline does not wrap")
	}
	clouds, err := SampleObservedSurface("jupiter", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if clouds.ElevationMeters != nil {
		t.Fatal("clouds presented as elevation")
	}
	if _, err := SampleObservedSurface("bennu", 0, 0); err == nil {
		t.Fatal("unknown map accepted")
	}
}
