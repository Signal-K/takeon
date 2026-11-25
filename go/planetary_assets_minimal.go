//go:build engine_minimal

package takeon

import "fmt"

// The embedded engine uses host-supplied terrain grids. The separately
// loaded solar preview build retains the observed planetary datasets.
type omittedPlanetaryFiles struct{}

func (omittedPlanetaryFiles) ReadFile(name string) ([]byte, error) {
	return nil, fmt.Errorf("takeon: planetary imagery is not included in the minimal engine (%s)", name)
}

var planetaryFiles omittedPlanetaryFiles
