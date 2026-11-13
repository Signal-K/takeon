package takeon

import (
	"fmt"
	"math"
)

type RoverStats struct {
	Valid           bool     `json:"valid"`
	Problems        []string `json:"problems"`
	Mass            float64  `json:"mass"`
	BatteryCapacity float64  `json:"batteryCapacity"`
	SolarRate       float64  `json:"solarRate"`
	RtgRate         float64  `json:"rtgRate"`
	Speed           float64  `json:"speed"`
	MaxClimb        float64  `json:"maxClimb"`
	Grip            float64  `json:"grip"`
	MiningPower     float64  `json:"miningPower"`
	MiningEnergy    float64  `json:"miningEnergy"`
	PhotoQuality    float64  `json:"photoQuality"`
	PhotoEnergy     float64  `json:"photoEnergy"`
	ScanRadius      float64  `json:"scanRadius"`
	ScanEnergy      float64  `json:"scanEnergy"`
	CargoCapacity   float64  `json:"cargoCapacity"`
	FuelCapacity    float64  `json:"fuelCapacity"`
	DurabilityMax   float64  `json:"durabilityMax"`
	MoveEnergy      float64  `json:"moveEnergy"`
	Cost            float64  `json:"cost"`
}

// RoverSpec is the part list; DefaultSpec matches parts/assembly.ts defaultSpec.
type RoverSpec struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Color   string   `json:"color"`
	Chassis string   `json:"chassis"`
	Wheels  string   `json:"wheels"`
	Power   string   `json:"power"`
	Battery string   `json:"battery"`
	Modules []string `json:"modules"`
}

func DefaultSpec() RoverSpec {
	out := defaultRules.DefaultSpec
	out.Modules = append([]string(nil), out.Modules...)
	return out
}

func findPart(id string) *Part {
	for i := range Parts {
		if Parts[i].ID == id {
			return &Parts[i]
		}
	}
	return nil
}

// ComputeStats mirrors parts/assembly.ts computeStats (validity problems are
// not reported; unknown parts simply contribute nothing).
func ComputeStats(spec RoverSpec) RoverStats { return ComputeStatsWithCatalog(spec, Parts) }
func ComputeStatsWithCatalog(spec RoverSpec, catalog []Part) RoverStats {
	findPart := func(id string) *Part {
		for i := range catalog {
			if catalog[i].ID == id {
				return &catalog[i]
			}
		}
		return nil
	}

	problems := []string{}
	find := func(id, category string) *Part {
		p := findPart(id)
		if p == nil {
			problems = append(problems, fmt.Sprintf("Missing %s part %q", category, id))
			return nil
		}
		if p.Category != category {
			problems = append(problems, fmt.Sprintf("Part %q is not a %s", id, category))
			return nil
		}
		return p
	}
	chassisPart, wheelsPart, powerPart, batteryPart := find(spec.Chassis, "chassis"), find(spec.Wheels, "wheels"), find(spec.Power, "power"), find(spec.Battery, "battery")
	var all []*Part
	for _, p := range []*Part{chassisPart, wheelsPart, powerPart, batteryPart} {
		if p != nil {
			all = append(all, p)
		}
	}
	modules := []*Part{}
	seen := map[string]bool{}
	for _, id := range spec.Modules {
		p := findPart(id)
		if p == nil {
			problems = append(problems, fmt.Sprintf("Unknown module %q", id))
			continue
		}
		switch p.Category {
		case "tool", "camera", "scanner", "cargo", "fuel":
			modules = append(modules, p)
		default:
			problems = append(problems, fmt.Sprintf("%q cannot be fitted as a module", p.Name))
			continue
		}
		all = append(all, p)
	}
	slots := 0.0
	if chassisPart != nil {
		slots = chassisPart.Stats["slots"]
	}
	if float64(len(modules)) > slots {
		problems = append(problems, fmt.Sprintf("Chassis has %g slots but %d modules fitted", slots, len(modules)))
	}
	for _, p := range modules {
		if seen[p.Category] {
			problems = append(problems, "Duplicate "+p.Category+" module")
		}
		seen[p.Category] = true
	}

	mass, cost := 0.0, 0.0
	for _, p := range all {
		mass += p.Mass
		cost += p.Cost
	}
	sum := func(k string) float64 {
		s := 0.0
		for _, p := range all {
			s += p.Stats[k]
		}
		return s
	}
	var chassis, wheels *Part
	chassis, wheels = chassisPart, wheelsPart
	var baseSpeed, maxClimb, grip, durability float64
	if wheels != nil {
		baseSpeed, maxClimb, grip = wheels.Stats["speed"], wheels.Stats["maxClimb"], wheels.Stats["grip"]
	}
	if chassis != nil {
		durability = chassis.Stats["durability"]
	}
	massFactor := 1 + fmax(0, mass-80)/220
	speed := baseSpeed / massFactor
	moveEnergy := float64(0.55 * massFactor)
	if chassisPart == nil {
		problems = append(problems, "A chassis is required")
	}
	if wheelsPart == nil {
		problems = append(problems, "Wheels are required")
	}
	if powerPart == nil {
		problems = append(problems, "A power source is required")
	}
	if batteryPart == nil {
		problems = append(problems, "A battery is required")
	}
	if sum("solarRate") == 0 && sum("rtgRate") == 0 && powerPart != nil {
		problems = append(problems, "Power source produces nothing")
	}
	return RoverStats{Valid: len(problems) == 0, Problems: problems,
		Mass: mass, BatteryCapacity: sum("batteryCapacity"), SolarRate: sum("solarRate"), RtgRate: sum("rtgRate"),
		Speed: jsRound(float64(speed*100)) / 100, MaxClimb: maxClimb, Grip: grip,
		MiningPower: sum("miningPower"), MiningEnergy: sum("miningEnergy"),
		PhotoQuality: sum("photoQuality"), PhotoEnergy: sum("photoEnergy"),
		ScanRadius: sum("scanRadius"), ScanEnergy: sum("scanEnergy"),
		CargoCapacity: sum("cargoCapacity"), FuelCapacity: 30 + sum("fuelCapacity"),
		DurabilityMax: durability, MoveEnergy: jsRound(float64(moveEnergy*100)) / 100, Cost: cost,
	}
}

var _ = math.Pi
