package takeon

import (
	"math"
	"testing"
)

func TestConfiguredContentDefaultsAndValidation(t *testing.T) {
	body, _ := GetBody("moon")
	g, err := NewConfiguredGame(4212, HostData{Body: body, Rules: &RuleCatalog{Structures: map[string]StructureDef{}}})
	if err != nil {
		t.Fatal(err)
	}
	g.SeedCargo(map[string]float64{"iron-plate": 2, "alloy": 1})
	if !g.UpgradeMobility() {
		t.Fatal("partial rule catalog did not retain portable upgrade costs")
	}
	for _, dt := range []float64{-1, math.Inf(1), math.NaN(), 61} {
		if _, err := g.Step(dt); err == nil {
			t.Fatal("invalid step accepted")
		}
	}
	invalid := *body
	invalid.CoreDEM = &DEM{Size: 2, Heights: []float64{0}}
	if _, err := NewConfiguredGame(1, HostData{Body: &invalid}); err == nil {
		t.Fatal("invalid DEM accepted")
	}
}
