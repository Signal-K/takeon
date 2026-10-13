package takeon

import (
	"fmt"
	"math"
)

type Anomaly struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Name       string `json:"name"`
	Pos        Vec2   `json:"pos"`
	Scanned    bool   `json:"scanned"`
	Documented bool   `json:"documented"`
}

var anomalyNames = map[string][]string{
	"wreckage":          {"Downed probe", "Impactor debris", "Lost lander stage"},
	"crystal-formation": {"Crystal spires", "Geode field", "Prismatic outcrop"},
	"magnetic-anomaly":  {"Magnetic mascon", "Compass sink", "Iron whisper"},
	"fossil-traces":     {"Layered sediments", "Microfossil bed", "Ancient shoreline"},
	"ice-vent":          {"Cryo-geyser", "Vapor plume vent", "Brine seep"},
	"monolith":          {"The Monolith", "Anomalous slab", "Silent marker"},
}

// GenerateAnomalies mirrors world/anomalies.ts.
func GenerateAnomalies(body *Body, w *VoxelWorld, seed int64) []Anomaly {
	rng := NewMulberry32(int64(uint32(int32(seed) ^ 0xa11e5)))
	count := 3 + int(math.Floor(rng.Next()*3))
	pool := []string{"wreckage", "magnetic-anomaly", "crystal-formation"}
	if body.Terrain.IceCaps > 0.1 {
		pool = append(pool, "ice-vent", "ice-vent")
	}
	if body.Type == "planet" || body.ID == "ceres" {
		pool = append(pool, "fossil-traces", "fossil-traces")
	}
	pool = append(pool, "monolith")

	placed := []Anomaly{}
	c := float64(w.Size) / 2
	size := float64(w.Size)
	for attempts := 0; len(placed) < count && attempts < 400; attempts++ {
		x := int(math.Floor(rng.Next() * size))
		y := int(math.Floor(rng.Next() * size))
		if !w.IsSolid(x, y) {
			continue
		}
		if jsHypot(float64(x)-c, float64(y)-c) < float64(size*0.12) {
			continue
		}
		clustered := false
		for _, a := range placed {
			if jsHypot(float64(a.Pos.X-x), float64(a.Pos.Y-y)) < float64(size*0.18) {
				clustered = true
				break
			}
		}
		if clustered {
			continue
		}
		typ := pool[int(math.Floor(rng.Next()*float64(len(pool))))]
		names := anomalyNames[typ]
		placed = append(placed, Anomaly{
			ID:   fmt.Sprintf("anom_%s_%d", body.ID, len(placed)),
			Type: typ,
			Name: names[int(math.Floor(rng.Next()*float64(len(names))))],
			Pos:  Vec2{x, y},
		})
	}
	return placed
}
