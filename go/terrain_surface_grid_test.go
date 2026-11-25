package takeon

import "testing"

func TestSurfaceGridDrivesTerrainAndLeavesLegacyBodiesAlone(t *testing.T) {
	body, err := GetBody("moon")
	if err != nil {
		t.Fatal(err)
	}
	body.CoreDEM = &DEM{Size: 2, Heights: []float64{.5, .5, .5, .5}, SurfaceMaterials: []int{4, 2, 3, 1}}
	w, err := GenerateTerrain(body, 42)
	if err != nil {
		t.Fatal(err)
	}
	for _, point := range []struct{ x, y, want int }{{0, 0, 4}, {body.Size - 1, 0, 2}, {0, body.Size - 1, 3}, {body.Size - 1, body.Size - 1, 1}} {
		if got := w.SurfaceMaterial(point.x, point.y); got != point.want {
			t.Fatalf("(%d,%d): got %d want %d", point.x, point.y, got, point.want)
		}
	}
	legacy := *body
	legacy.CoreDEM = &DEM{Size: 2, Heights: []float64{.5, .5, .5, .5}}
	if _, ok := sampleSurfaceMaterial(legacy.CoreDEM, 0, 0); ok {
		t.Fatal("legacy DEM supplied a surface material")
	}
	if _, err := GenerateTerrain(&legacy, 42); err != nil {
		t.Fatal(err)
	}
}

func TestConfiguredGameRejectsInvalidSurfaceGrid(t *testing.T) {
	body, _ := GetBody("moon")
	for _, materials := range [][]int{{1}, {1, 1, 1, 256}, {1, 1, 1, 0}} {
		body.CoreDEM = &DEM{Size: 2, Heights: []float64{.5, .5, .5, .5}, SurfaceMaterials: materials}
		if _, err := NewConfiguredGame(1, HostData{Body: body}); err == nil {
			t.Fatalf("accepted invalid grid %v", materials)
		}
	}
}
