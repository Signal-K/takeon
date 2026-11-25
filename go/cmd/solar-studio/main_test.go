package main

import (
	"math"
	"testing"
)

func TestGeneratedMesh(t *testing.T) {
	m, err := makeMesh("mars", 42, 16, 32)
	if err != nil {
		t.Fatal(err)
	}
	if m.Count != 16*32*6 || len(m.Positions) != m.Count*3 || len(m.Normals) != m.Count*3 || len(m.Colors) != m.Count*3 {
		t.Fatal("invalid mesh lengths")
	}
	low, high := math.MaxFloat64, 0.0
	for i := 0; i < len(m.Positions); i += 3 {
		x, y, z := float64(m.Positions[i]), float64(m.Positions[i+1]), float64(m.Positions[i+2])
		r := math.Sqrt(x*x + y*y + z*z)
		if r < low {
			low = r
		}
		if r > high {
			high = r
		}
		for j := 0; j < 3; j++ {
			if math.IsNaN(float64(m.Normals[i+j])) {
				t.Fatal("invalid normal")
			}
		}
	}
	if high-low < 0.005 {
		t.Fatalf("surface not displaced: %f %f", low, high)
	}
	if _, err := makeMesh("unknown", 0, 8, 16); err == nil {
		t.Fatal("unknown body accepted")
	}
}
