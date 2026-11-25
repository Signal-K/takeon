package takeon

import "testing"

func TestObservedPatchCoverage(t *testing.T) {
	for _, id := range []string{"moon", "mars", "earth", "mercury", "venus", "jupiter", "saturn", "neptune"} {
		p, err := SampleObservedPatch(id, 0, 0, 1, 3, 3)
		if err != nil || len(p.Samples) != 9 {
			t.Fatalf("%s: %v", id, err)
		}
		if (p.Samples[4].ElevationMeters != nil) != (id == "moon" || id == "mars") {
			t.Fatalf("%s: wrong elevation coverage", id)
		}
	}
	if _, err := SampleObservedPatch("europa", 0, 0, 1, 3, 3); err == nil {
		t.Fatal("unknown coverage must fail")
	}
	if _, err := SampleObservedPatch("mars", 90, 0, 1, 3, 3); err == nil {
		t.Fatal("cross-pole patch must fail")
	}
}
