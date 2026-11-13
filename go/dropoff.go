package takeon

import "fmt"

// Seeded drop-off (TS TakeOnMount seedCache/seedCargo + Simulation.depositCargo): a host that already tracks
// cargo (Landnam's transport lesson delivery) loads it into the rover, places one cache beside the landing
// tile, and the player drives up and deposits. Deposited cargo is banked by resource.

// SeedCache places one cache at the rover's tile +1 x (TS `pos: { x: x + 1, y }`). No-op when one exists.
func (g *Game) SeedCache() {
	if len(g.caches) > 0 {
		return
	}
	pos := Vec2{X: g.rover.Pos.X + 1, Y: g.rover.Pos.Y}
	g.caches = append(g.caches, pos)
	g.structures = append(g.structures, &Structure{ID: fmt.Sprintf("seed-cache-%d-%d", pos.X, pos.Y), Type: "cache", Pos: pos, Buffer: map[string]float64{}})
}

// SeedCargo puts host cargo straight into the hold, replacing what is there (TS sets rover.cargo directly,
// ignoring capacity).
func (g *Game) SeedCargo(cargo map[string]float64) {
	g.rover.Cargo = map[string]float64{}
	g.rover.CargoUsed = 0
	for _, res := range sortedKeys(cargo) {
		qty := cargo[res]
		if qty <= 0 {
			continue
		}
		g.rover.Cargo[res] = qty
		g.rover.CargoUsed += qty
	}
}

// Deposit empties the hold into a cache within one tile (any direction) and returns the units moved.
func (g *Game) Deposit() float64 {
	r := &g.rover
	near := false
	for _, c := range g.caches {
		if absInt(c.X-r.Pos.X) <= 1 && absInt(c.Y-r.Pos.Y) <= 1 {
			near = true
			break
		}
	}
	if !near {
		for _, s := range g.structures {
			if s.Type == "cache" && absInt(s.Pos.X-r.Pos.X) <= 1 && absInt(s.Pos.Y-r.Pos.Y) <= 1 {
				near = true
				break
			}
		}
	}
	if !near {
		return 0
	}
	moved := 0.0
	for _, res := range sortedKeys(r.Cargo) {
		qty := r.Cargo[res]
		if qty == 0 {
			continue
		}
		if g.banked == nil {
			g.banked = map[string]float64{}
		}
		g.banked[res] += qty
		moved += qty
		delete(r.Cargo, res)
	}
	r.CargoUsed = 0
	if moved > 0 {
		g.emit(Event{Kind: "cargoDeposited", Amount: moved})
		g.hostEvent("stateChanged", map[string]any{})
	}
	return moved
}
