package takeon

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
)

// LocationGeneratorVersion pins the algorithm used for persistent locations.
// Changing its output requires a new version, not an in-place change.
const LocationGeneratorVersion = 1

// LocationSpec is host-authored identity and a visual terrain template. IDs are
// stable within a host; parent groups locations into a map. Seed is a game seed,
// not a scientific measurement. The template must be a built-in surface body.
type LocationSpec struct {
	Version  int    `json:"version"`
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	BodyID   string `json:"bodyId"`
	Seed     uint32 `json:"seed"`
}

// Location is a presentation-neutral link between a map marker and a surface.
// Map coordinates are normalized integers in [0,10000], for diagram layout only;
// they do not describe physical orbital positions or discovered facts.
type Location struct {
	Spec        LocationSpec `json:"spec"`
	Type        string       `json:"type"`
	MapX        uint32       `json:"mapX"`
	MapY        uint32       `json:"mapY"`
	TerrainSeed uint32       `json:"terrainSeed"`
}

// GenerateLocation produces the same map marker and surface seed for the same
// versioned input across Go, WASM and mobile. It does not change engine state.
func GenerateLocation(spec LocationSpec) (Location, error) {
	if spec.Version != LocationGeneratorVersion {
		return Location{}, fmt.Errorf("takeon: unsupported location generator version %d", spec.Version)
	}
	if strings.TrimSpace(spec.ID) == "" || strings.TrimSpace(spec.ParentID) == "" || len(spec.ID) > 256 || len(spec.ParentID) > 256 {
		return Location{}, fmt.Errorf("takeon: location and parent IDs are required (maximum 256 bytes)")
	}
	body, err := GetBody(spec.BodyID)
	if err != nil {
		return Location{}, err
	}
	if body.Type != "planet" && body.Type != "moon" && body.Type != "asteroid" {
		return Location{}, fmt.Errorf("takeon: body %q has no supported surface", spec.BodyID)
	}
	// JSON provides unambiguous, stable field boundaries; a separate domain
	// prevents this hash from sharing a stream with other generators.
	input, err := json.Marshal(spec)
	if err != nil {
		return Location{}, err
	}
	sum := sha256.Sum256(append([]byte("takeon/location/v1\x00"), input...))
	return Location{Spec: spec, Type: body.Type,
		MapX:        binary.BigEndian.Uint32(sum[0:4]) % 10001,
		MapY:        binary.BigEndian.Uint32(sum[4:8]) % 10001,
		TerrainSeed: binary.BigEndian.Uint32(sum[8:12]),
	}, nil
}
