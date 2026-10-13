package takeon

import "testing"

func BenchmarkGenerateTerrainTerra(b *testing.B) {
	body, _ := GetBody("terra")
	for i := 0; i < b.N; i++ {
		GenerateTerrain(body, body.Seed)
	}
}

func BenchmarkTick(b *testing.B) {
	g, _ := NewGame(4212, "mars")
	for i := 0; i < b.N; i++ {
		g.Tick()
	}
}
