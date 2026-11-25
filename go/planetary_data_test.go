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

func TestEarthAndMercuryImagery(t *testing.T) {
	for _, id := range []string{"earth", "mercury"} {
		a, err := SampleObservedSurface(id, 0, -180)
		if err != nil {
			t.Fatal(err)
		}
		b, err := SampleObservedSurface(id, 0, 180)
		if err != nil {
			t.Fatal(err)
		}
		if a != b {
			t.Fatalf("%s dateline does not wrap", id)
		}
		if a.ElevationMeters != nil {
			t.Fatalf("%s imagery is not elevation", id)
		}
	}
	// The Pacific should be visibly bluer than the Sahara in the Blue Marble map.
	ocean, _ := SampleObservedSurface("earth", 0, -140)
	desert, _ := SampleObservedSurface("earth", 24, 15)
	if ocean.Blue <= ocean.Red || desert.Red <= desert.Blue {
		t.Fatalf("unexpected Earth map orientation: ocean=%+v desert=%+v", ocean, desert)
	}
}
