package takeon

// Gameplay runtime layered on the parity core: mission hooks and the
// "easy mining" autopilot. Both are inert unless used, so the golden
// tick/sim vectors are unaffected. NOT part of the TS parity contract for
// the sim itself (the TS autopilot lives in the renderer-coupled RoverGame).
//
// Mission conventions (Go-runtime choices; the TS module leaves yield to the host):
//   - entering a never-visited tile explores it and yields 1 held data;
//   - each mined deposit yields round(amount) held samples (min 1);
//   - Bank (within BankRadius tiles of the landing site) banks held yield.

import "math"

const BankRadius = 2

type mineOrder struct {
	x, y  int
	path  []int // remaining move directions
	fails int
}

func (g *Game) initMission() {
	g.mission = NewWorldState(Vec2f{float64(g.landing.X), float64(g.landing.Y)}, DemoMission())
	g.missionDone = false
}

// SetMission replaces the active mission (objectives) and resets progress.
func (g *Game) SetMission(m Mission) {
	g.mission = NewWorldState(Vec2f{float64(g.landing.X), float64(g.landing.Y)}, m)
	g.missionDone = false
}

// Mission returns the current mission world state and derived progress.
func (g *Game) Mission() (WorldState, MissionProgress) { return g.mission, g.mission.Progress() }

func (g *Game) checkMission() {
	if p := g.mission.Progress(); p.Complete && !g.missionDone {
		g.missionDone = true
		g.emit(Event{Kind: "missionComplete", Detail: p.MissionID})
	}
}

func (g *Game) onArrive() {
	p := g.rover.Pos
	key := TileKey(float64(p.X), float64(p.Y))
	gain := Gain{}
	known := false
	for _, k := range g.mission.Explored {
		if k == key {
			known = true
			break
		}
	}
	if !known {
		gain.Data = 1
		g.emit(Event{Kind: "tileExplored", X: p.X, Y: p.Y})
	}
	base := g.mission.Base
	g.mission = g.mission.Explore(Vec2f{float64(p.X), float64(p.Y)}, gain)
	g.mission.Rover = Vec2f{float64(p.X), float64(p.Y)}
	_ = base
	g.checkMission()
}

func (g *Game) onMined(amount float64) {
	n := math.Round(amount)
	if n < 1 {
		n = 1
	}
	g.mission.HeldSamples += n
}

// Bank banks held yield when the rover is within BankRadius of the landing site.
func (g *Game) Bank() bool {
	r := g.rover.Pos
	if g.status != "active" || absInt(r.X-g.landing.X) > BankRadius || absInt(r.Y-g.landing.Y) > BankRadius {
		g.emit(Event{Kind: "blocked", Detail: "not-at-base"})
		return false
	}
	held := g.mission.HeldData + g.mission.HeldSamples
	rover := g.mission.Rover
	g.mission = g.mission.ReturnToBase()
	g.mission.Rover = rover // physical rover stays put
	g.emit(Event{Kind: "banked", Amount: held})
	g.checkMission()
	return true
}

func absInt(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

// OrderMine is the one-call "go mine that": drive next to (x,y), face it and
// drill it down until level with the rover's ground, handled by Tick.
func (g *Game) OrderMine(x, y int) bool {
	if g.status != "active" || !g.world.InBounds(x, y) || !g.world.IsSolid(x, y) {
		return false
	}
	g.mineOrder = &mineOrder{x: x, y: y}
	return true
}

// HasOrder reports whether an autopilot mine order is active.
func (g *Game) HasOrder() bool { return g.mineOrder != nil }

func (g *Game) finishOrder(detail string) {
	g.emit(Event{Kind: "mineOrder", X: g.mineOrder.x, Y: g.mineOrder.y, Detail: detail})
	g.mineOrder = nil
}

// plan finds a shortest drivable path (BFS, climb-limited) to any tile
// 4-adjacent to the target.
func (g *Game) plan(tx, ty int) ([]int, bool) {
	start := g.rover.Pos
	adj := func(p Vec2) bool { return absInt(p.X-tx)+absInt(p.Y-ty) == 1 }
	if adj(start) {
		return nil, true
	}
	type node struct {
		p      Vec2
		parent int
		dir    int
	}
	seen := map[Vec2]bool{start: true}
	q := []node{{start, -1, 0}}
	for i := 0; i < len(q); i++ {
		cur := q[i]
		for d := 0; d < 4; d++ {
			np := Vec2{cur.p.X + dirs[d].X, cur.p.Y + dirs[d].Y}
			if seen[np] || !g.world.InBounds(np.X, np.Y) || !g.world.IsSolid(np.X, np.Y) || (np.X == tx && np.Y == ty) {
				continue
			}
			if g.world.Step(cur.p.X, cur.p.Y, np.X, np.Y) > g.stats.MaxClimb {
				continue
			}
			seen[np] = true
			q = append(q, node{np, i, d})
			if adj(np) {
				var path []int
				for j := len(q) - 1; q[j].parent >= 0; j = q[j].parent {
					path = append([]int{q[j].dir}, path...)
				}
				return path, true
			}
		}
	}
	return nil, false
}

// autopilot runs at the start of every Tick when a mine order is active.
func (g *Game) autopilot() {
	o := g.mineOrder
	r := &g.rover
	if o == nil || g.status != "active" || r.MoveFrom != nil || r.Mining != nil {
		return
	}
	h := g.world.Height(o.x, o.y)
	if h < 0 || h <= g.world.Height(r.Pos.X, r.Pos.Y) {
		g.finishOrder("done")
		return
	}
	if len(o.path) == 0 {
		p, ok := g.plan(o.x, o.y)
		if !ok {
			g.finishOrder("failed:no-route")
			return
		}
		o.path = p
	}
	if len(o.path) > 0 {
		if !g.Move(o.path[0]) {
			o.fails++
			o.path = nil
			if o.fails > 3 {
				g.finishOrder("failed:blocked")
			}
			return
		}
		o.path = o.path[1:]
		return
	}
	// adjacent: face and drill
	for d := 0; d < 4; d++ {
		if r.Pos.X+dirs[d].X == o.x && r.Pos.Y+dirs[d].Y == o.y {
			r.Facing = d
		}
	}
	if !g.Drill() {
		switch {
		case r.CargoUsed >= g.stats.CargoCapacity:
			g.finishOrder("failed:cargo-full")
		case r.Battery < g.stats.MiningEnergy:
			g.finishOrder("failed:battery")
		default:
			g.finishOrder("failed:cannot-drill")
		}
	}
}
