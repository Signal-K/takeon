package takeon

import "math"

type RoverStats struct {
	Mass            float64 `json:"mass"`
	BatteryCapacity float64 `json:"batteryCapacity"`
	SolarRate       float64 `json:"solarRate"`
	RtgRate         float64 `json:"rtgRate"`
	Speed           float64 `json:"speed"`
	MaxClimb        float64 `json:"maxClimb"`
	Grip            float64 `json:"grip"`
	MiningPower     float64 `json:"miningPower"`
	MiningEnergy    float64 `json:"miningEnergy"`
	PhotoQuality    float64 `json:"photoQuality"`
	PhotoEnergy     float64 `json:"photoEnergy"`
	ScanRadius      float64 `json:"scanRadius"`
	ScanEnergy      float64 `json:"scanEnergy"`
	CargoCapacity   float64 `json:"cargoCapacity"`
	FuelCapacity    float64 `json:"fuelCapacity"`
	DurabilityMax   float64 `json:"durabilityMax"`
	MoveEnergy      float64 `json:"moveEnergy"`
	Cost            float64 `json:"cost"`
}

// RoverSpec is the part list; DefaultSpec matches parts/assembly.ts defaultSpec.
type RoverSpec struct {
	Chassis, Wheels, Power, Battery string
	Modules                         []string
}

func DefaultSpec() RoverSpec {
	return RoverSpec{"chassis-scout", "wheels-rocker", "power-solar-s", "batt-cell", []string{"tool-scoop", "cam-nav"}}
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
func ComputeStats(spec RoverSpec) RoverStats {
	var all []*Part
	ids := append([]string{spec.Chassis, spec.Wheels, spec.Power, spec.Battery}, spec.Modules...)
	for _, id := range ids {
		if p := findPart(id); p != nil {
			all = append(all, p)
		}
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
	chassis, wheels = findPart(spec.Chassis), findPart(spec.Wheels)
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
	return RoverStats{
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
