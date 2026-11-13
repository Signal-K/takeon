package takeon

import (
	"encoding/json"
	"os"
	"testing"
)

func TestWorldExtensionsMatchTypeScript(t *testing.T) {
	data, err := os.ReadFile("../golden/world-extensions.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name   string
			Body   Body
			Seed   int64
			Voxels []int
		}
		Masks []struct {
			Seed   int64
			Size   int
			Values []float32
		}
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			w, err := GenerateTerrain(&c.Body, c.Seed)
			if err != nil {
				t.Fatal(err)
			}
			for i, v := range c.Voxels {
				if int(w.voxels[i]) != v {
					t.Fatalf("voxel %d: got %d want %d", i, w.voxels[i], v)
				}
			}
		})
	}
	for _, m := range fixture.Masks {
		got := blueNoiseMask(m.Size, m.Seed)
		for i, v := range m.Values {
			if got[i] != v {
				t.Fatalf("blue mask seed %d cell %d: got %v want %v", m.Seed, i, got[i], v)
			}
		}
	}
}
