package takeon

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

type StructureDef struct {
	Type      string             `json:"type"`
	Name      string             `json:"name"`
	Cost      map[string]float64 `json:"cost"`
	Category  string             `json:"category"`
	Buildable *bool              `json:"buildable"`
}
type Structure struct {
	ID            string             `json:"id"`
	Type          string             `json:"type"`
	Pos           Vec2               `json:"pos"`
	Buffer        map[string]float64 `json:"buffer"`
	Facing        int                `json:"facing"`
	CooldownUntil *float64           `json:"cooldownUntil,omitempty"`
	Progress      *float64           `json:"progress,omitempty"`
}
type Recipe struct {
	ID     string             `json:"id"`
	Input  map[string]float64 `json:"input"`
	Output struct {
		Resource string  `json:"resource"`
		Amount   float64 `json:"amount"`
	} `json:"output"`
	Energy float64 `json:"energy"`
	Near   string  `json:"near"`
}
type RuleCatalog struct {
	DefaultSpec   RoverSpec               `json:"defaultSpec"`
	Structures    map[string]StructureDef `json:"structures"`
	Recipes       []Recipe                `json:"recipes"`
	MobilityCosts []map[string]float64    `json:"mobilityCosts"`
}

//go:embed data/rules.json
var rulesJSON []byte
var defaultRules RuleCatalog

func init() {
	if err := json.Unmarshal(rulesJSON, &defaultRules); err != nil {
		panic(err)
	}
}

type Photo struct {
	ID        string  `json:"id"`
	BodyID    string  `json:"bodyId"`
	Pos       Vec2    `json:"pos"`
	Quality   float64 `json:"quality"`
	Timestamp float64 `json:"timestamp"`
	AnomalyID string  `json:"anomalyId,omitempty"`
	Caption   string  `json:"caption"`
}
type Marker struct {
	Pos Vec2    `json:"pos"`
	T   float64 `json:"t"`
}

func (g *Game) rules() *RuleCatalog {
	if g.ruleCatalog != nil {
		return g.ruleCatalog
	}
	return &defaultRules
}
func (g *Game) hostEvent(kind string, payload any) {
	b, _ := json.Marshal(payload)
	event := Event{Kind: kind, Payload: b}
	if kind == "built" {
		if object, ok := payload.(map[string]any); ok {
			if structure, ok := object["structure"].(*Structure); ok {
				event.Detail = structure.Type
			}
		}
	}
	g.emit(event)
}
func (g *Game) failure(kind, reason string) { g.hostEvent(kind, map[string]any{"reason": reason}) }
func near(a, b Vec2, r int) bool            { return absInt(a.X-b.X) <= r && absInt(a.Y-b.Y) <= r }
func (g *Game) nextID(prefix string) string {
	g.entitySeq++
	return fmt.Sprintf("%s_%d_%d", prefix, g.seed, g.entitySeq)
}
func (g *Game) removeCargo(res string, amount float64) {
	r := &g.rover
	take := fmin(r.Cargo[res], amount)
	r.Cargo[res] -= take
	if r.Cargo[res] == 0 {
		delete(r.Cargo, res)
	}
	r.CargoUsed = fmax(0, r.CargoUsed-take)
}
func (g *Game) idle() bool {
	return g.status == "active" && g.rover.MoveFrom == nil && g.rover.Mining == nil
}
func (g *Game) facingTile() Vec2 {
	d := dirs[g.rover.Facing]
	return Vec2{g.rover.Pos.X + d.X, g.rover.Pos.Y + d.Y}
}
func (g *Game) sensorMult() float64 {
	if g.weather != nil && g.weather.Type == "solar-storm" {
		return 2
	}
	return 1
}
func (g *Game) Scan() []Anomaly {
	found := []Anomaly{}
	r := &g.rover
	if g.status != "active" || g.stats.ScanRadius <= 0 {
		return found
	}
	cost := g.stats.ScanEnergy * g.sensorMult()
	if r.Battery < cost {
		g.failure("blocked", "battery")
		return found
	}
	r.Battery -= cost
	for i := range g.anoms {
		a := &g.anoms[i]
		if !a.Scanned && jsHypot(float64(a.Pos.X-r.Pos.X), float64(a.Pos.Y-r.Pos.Y)) <= g.stats.ScanRadius {
			a.Scanned = true
			found = append(found, *a)
		}
	}
	g.hostEvent("scan", map[string]any{"found": found, "energyUsed": cost})
	return found
}
func (g *Game) Photo() *Photo {
	r := &g.rover
	if g.status != "active" || g.stats.PhotoQuality <= 0 {
		return nil
	}
	cost := g.stats.PhotoEnergy * g.sensorMult()
	if r.Battery < cost {
		g.failure("blocked", "battery")
		return nil
	}
	r.Battery -= cost
	var captured *Anomaly
	for i := range g.anoms {
		a := &g.anoms[i]
		if jsHypot(float64(a.Pos.X-r.Pos.X), float64(a.Pos.Y-r.Pos.Y)) <= 6 {
			captured = a
			break
		}
	}
	p := Photo{ID: g.nextID("pho"), BodyID: g.body.ID, Pos: r.Pos, Quality: g.stats.PhotoQuality, Timestamp: g.time, Caption: "Surface survey — " + g.body.Name}
	if captured != nil {
		p.AnomalyID = captured.ID
		p.Caption = captured.Name + " — " + g.body.Name
		if !captured.Documented {
			captured.Documented = true
			captured.Scanned = true
			g.hostEvent("anomalyDocumented", map[string]any{"anomaly": captured})
		}
	}
	g.photos = append(g.photos, p)
	return &p
}
func (g *Game) Build(typ string) *Structure {
	if !g.idle() {
		return nil
	}
	def, ok := g.rules().Structures[typ]
	if !ok || (def.Buildable != nil && !*def.Buildable) {
		return nil
	}
	pos := g.facingTile()
	r := &g.rover
	if !g.world.IsSolid(pos.X, pos.Y) {
		g.failure("buildFailed", "No ground there.")
		return nil
	}
	if math.Abs(g.world.Step(r.Pos.X, r.Pos.Y, pos.X, pos.Y)) > 1 {
		g.failure("buildFailed", "Ground too uneven.")
		return nil
	}
	category := def.Category
	if category == "" {
		category = "functional"
	}
	for _, s := range g.structures {
		c := g.rules().Structures[s.Type].Category
		if c == "" {
			c = "functional"
		}
		if s.Pos == pos && c == category {
			g.failure("buildFailed", "Something is already built there.")
			return nil
		}
	}
	for _, res := range sortedKeys(def.Cost) {
		qty := def.Cost[res]
		if r.Cargo[res] < qty {
			g.failure("buildFailed", fmt.Sprintf("Needs %g %s in cargo.", qty, res))
			return nil
		}
	}
	for _, res := range sortedKeys(def.Cost) {
		qty := def.Cost[res]
		g.removeCargo(res, qty)
	}
	s := &Structure{ID: g.nextID("str"), Type: typ, Pos: pos, Buffer: map[string]float64{}, Facing: r.Facing}
	g.structures = append(g.structures, s)
	g.hostEvent("built", map[string]any{"structure": s})
	return s
}
func (g *Game) RotateStructure(id string) bool {
	for _, s := range g.structures {
		if s.ID == id {
			if !near(s.Pos, g.rover.Pos, 1) {
				g.failure("rotateFailed", "Too far away.")
				return false
			}
			s.Facing = (s.Facing + 1) % 4
			g.hostEvent("rotated", map[string]any{"id": id, "facing": s.Facing})
			return true
		}
	}
	g.failure("rotateFailed", "No such structure.")
	return false
}
func (g *Game) Demolish(id string) bool {
	for i, s := range g.structures {
		if s.ID == id {
			if !near(s.Pos, g.rover.Pos, 1) {
				g.failure("demolishFailed", "Too far away.")
				return false
			}
			g.structures = append(g.structures[:i], g.structures[i+1:]...)
			g.hostEvent("demolished", map[string]any{"id": id, "type": s.Type, "pos": s.Pos})
			return true
		}
	}
	g.failure("demolishFailed", "No such structure.")
	return false
}
func (g *Game) Craft(id string) bool {
	if g.status != "active" {
		return false
	}
	var rec *Recipe
	for i := range g.rules().Recipes {
		if g.rules().Recipes[i].ID == id {
			rec = &g.rules().Recipes[i]
			break
		}
	}
	if rec == nil {
		return false
	}
	r := &g.rover
	if rec.Near != "" {
		found := false
		for _, s := range g.structures {
			if s.Type == rec.Near && near(s.Pos, r.Pos, 1) {
				found = true
				break
			}
		}
		if !found {
			g.failure("craftFailed", "Needs an adjacent "+rec.Near+".")
			return false
		}
	}
	if r.Battery < rec.Energy {
		g.failure("craftFailed", "Not enough battery.")
		return false
	}
	for _, res := range sortedKeys(rec.Input) {
		qty := rec.Input[res]
		if r.Cargo[res] < qty {
			g.failure("craftFailed", fmt.Sprintf("Needs %g %s in cargo.", qty, res))
			return false
		}
	}
	r.Battery -= rec.Energy
	for _, res := range sortedKeys(rec.Input) {
		qty := rec.Input[res]
		g.removeCargo(res, qty)
	}
	g.addCargo(rec.Output.Resource, rec.Output.Amount)
	g.hostEvent("crafted", map[string]any{"recipe": id, "resource": rec.Output.Resource, "amount": rec.Output.Amount})
	return true
}
func (g *Game) UpgradeMobility() bool {
	if g.status != "active" {
		return false
	}
	if g.mobility >= 3 {
		g.failure("upgradeFailed", "Mobility is already maxed out.")
		return false
	}
	cost := g.rules().MobilityCosts[g.mobility]
	for _, res := range sortedKeys(cost) {
		qty := cost[res]
		if g.rover.Cargo[res] < qty {
			g.failure("upgradeFailed", fmt.Sprintf("Needs %g %s in cargo.", qty, res))
			return false
		}
	}
	for _, res := range sortedKeys(cost) {
		qty := cost[res]
		g.removeCargo(res, qty)
	}
	g.mobility++
	g.stats = g.baseStats
	g.stats.MaxClimb += float64(g.mobility)
	g.stats.Grip = fmin(.95, g.stats.Grip+.12*float64(g.mobility))
	g.stats.Speed = jsRound(g.stats.Speed*(1+.08*float64(g.mobility))*100) / 100
	g.hostEvent("upgraded", map[string]any{"kind": "mobility", "level": g.mobility})
	g.hostEvent("stateChanged", map[string]any{})
	return true
}
func (g *Game) PlaceBlock() bool {
	if !g.idle() {
		return false
	}
	pos := g.facingTile()
	if !g.world.IsSolid(pos.X, pos.Y) {
		return false
	}
	for _, s := range g.structures {
		if s.Pos == pos {
			g.failure("buildFailed", "Something is already built there.")
			return false
		}
	}
	if g.rover.Cargo["stone"] < 1 {
		g.failure("buildFailed", "Needs 1 stone in cargo.")
		return false
	}
	if g.rover.Battery < 2 {
		g.failure("blocked", "battery")
		return false
	}
	h := g.world.Height(pos.X, pos.Y)
	if h+1 >= g.world.MaxHeight {
		g.failure("buildFailed", "Column is at max height.")
		return false
	}
	g.world.Set(pos.X, pos.Y, h+1, Rock)
	g.rover.Battery -= 2
	g.removeCargo("stone", 1)
	g.hostEvent("blockPlaced", map[string]any{"pos": pos})
	return true
}
func (g *Game) Repair() bool {
	r := &g.rover
	if r.Cargo["stone"] < 2 || r.Cargo["iron"] < 1 || r.Durability >= g.stats.DurabilityMax {
		return false
	}
	g.removeCargo("stone", 2)
	g.removeCargo("iron", 1)
	amount := fmin(25, g.stats.DurabilityMax-r.Durability)
	r.Durability += amount
	g.hostEvent("repaired", map[string]any{"amount": amount})
	return true
}
func (g *Game) computePower() {
	g.powered = map[string]bool{}
	emitters := []Vec2{}
	for _, s := range g.structures {
		if s.Type == "generator" || (s.Type == "solar-array" && g.daylight() > 0) {
			emitters = append(emitters, s.Pos)
		}
	}
	active := map[string]bool{}
	for changed := true; changed; {
		changed = false
		for _, s := range g.structures {
			if s.Type != "pylon" || active[s.ID] {
				continue
			}
			for _, e := range emitters {
				if near(e, s.Pos, 5) {
					active[s.ID] = true
					emitters = append(emitters, s.Pos)
					changed = true
					break
				}
			}
		}
	}
	for _, s := range g.structures {
		for _, e := range emitters {
			if near(e, s.Pos, 5) {
				g.powered[s.ID] = true
				break
			}
		}
	}
}
func (g *Game) collectDrills() {
	for _, s := range g.structures {
		if s.Type != "drill-rig" || !near(s.Pos, g.rover.Pos, 1) {
			continue
		}
		for _, res := range sortedKeys(s.Buffer) {
			qty := s.Buffer[res]
			take := fmin(g.stats.CargoCapacity-g.rover.CargoUsed, qty)
			if take <= 0 {
				break
			}
			g.addCargo(res, take)
			s.Buffer[res] -= take
			if s.Buffer[res] == 0 {
				delete(s.Buffer, res)
			}
		}
	}
}
func (g *Game) shipManifest(pad *Structure, manifest map[string]float64, auto bool) float64 {
	total := 0.0
	for _, res := range sortedKeys(manifest) {
		qty := manifest[res]
		if qty != 0 {
			if g.banked == nil {
				g.banked = map[string]float64{}
			}
			g.banked[res] += qty
			total += qty
		}
	}
	if total <= 0 {
		return 0
	}
	cd := 40.0
	if g.powered[pad.ID] {
		cd *= .6
	}
	until := g.time + cd
	pad.CooldownUntil = &until
	g.launches = append(g.launches, Marker{pad.Pos, g.time})
	g.hostEvent("cargoLaunched", map[string]any{"pos": pad.Pos, "manifest": manifest, "total": total, "auto": auto})
	g.hostEvent("stateChanged", map[string]any{})
	return total
}
func (g *Game) LaunchCargo() bool {
	if !g.idle() {
		return false
	}
	var pad *Structure
	for _, s := range g.structures {
		if s.Type == "launch-pad" && near(s.Pos, g.rover.Pos, 1) {
			pad = s
			break
		}
	}
	if pad == nil {
		g.failure("launchFailed", "Park beside a launch pad.")
		return false
	}
	if pad.CooldownUntil != nil && g.time < *pad.CooldownUntil {
		g.failure("launchFailed", "The pad is still refuelling.")
		return false
	}
	manifest := map[string]float64{}
	for _, res := range sortedKeys(g.rover.Cargo) {
		qty := g.rover.Cargo[res]
		manifest[res] += qty
	}
	g.rover.Cargo = map[string]float64{}
	g.rover.CargoUsed = 0
	for _, res := range sortedKeys(pad.Buffer) {
		qty := pad.Buffer[res]
		manifest[res] += qty
	}
	pad.Buffer = map[string]float64{}
	for _, s := range g.structures {
		if s.Type == "drill-rig" && near(s.Pos, pad.Pos, 1) {
			for _, res := range sortedKeys(s.Buffer) {
				qty := s.Buffer[res]
				manifest[res] += qty
			}
			s.Buffer = map[string]float64{}
		}
	}
	if g.shipManifest(pad, manifest, false) <= 0 {
		g.failure("launchFailed", "Nothing to load — fill the hold or a nearby drill rig first.")
		return false
	}
	return true
}
func (g *Game) tickStructures() {
	if g.drillTimers == nil {
		g.drillTimers = map[string]int{}
	}
	for _, s := range g.structures {
		if s.Type != "drill-rig" {
			continue
		}
		rate := 40
		if g.powered[s.ID] {
			rate = 22
		}
		g.drillTimers[s.ID]++
		if g.drillTimers[s.ID] >= rate {
			g.drillTimers[s.ID] = 0
			if mat, ok := g.world.MineTop(s.Pos.X, s.Pos.Y); ok {
				def := g.material(mat)
				if def.Resource != "" {
					s.Buffer[def.Resource] += def.Amount
				}
			}
		}
	}
	for _, s := range g.structures {
		switch s.Type {
		case "launch-pad":
			for _, rig := range g.structures {
				if rig.Type == "drill-rig" && near(rig.Pos, s.Pos, 1) {
					for _, res := range sortedKeys(rig.Buffer) {
						qty := rig.Buffer[res]
						s.Buffer[res] += qty
					}
					rig.Buffer = map[string]float64{}
				}
			}
			total := 0.0
			for _, key := range sortedKeys(s.Buffer) {
				qty := s.Buffer[key]
				total += qty
			}
			if (s.CooldownUntil == nil || g.time >= *s.CooldownUntil) && total >= 12 {
				manifest := s.Buffer
				s.Buffer = map[string]float64{}
				g.shipManifest(s, manifest, true)
			}
		case "habitat-frame":
			if g.powered[s.ID] {
				p := 0.0
				if s.Progress != nil {
					p = *s.Progress
				}
				p += (1.0 / 30) * TickDT
				s.Progress = &p
				if p >= 1 {
					s.Type = "habitat"
					s.Progress = nil
					g.hostEvent("habitatComplete", map[string]any{"pos": s.Pos})
				}
			}
		case "habitat":
			if near(s.Pos, g.rover.Pos, 2) {
				g.rover.Battery = fmin(g.stats.BatteryCapacity, g.rover.Battery+6*TickDT)
				g.rover.Durability = fmin(g.stats.DurabilityMax, g.rover.Durability+1.5*TickDT)
			}
		}
	}
}
