package takeon

import "encoding/json"

// WindowView is a read-only rectangle of the voxel world for renderers:
// per-column top height (-1 = void/out of bounds) and top material id,
// row-major (y outer, x inner). Mined edits are already applied.
type WindowView struct {
	X       int   `json:"x"`
	Y       int   `json:"y"`
	W       int   `json:"w"`
	H       int   `json:"h"`
	Size    int   `json:"size"`
	Heights []int `json:"heights"`
	Mats    []int `json:"mats"`
	// Ore is the depth (1..OreProbeDepth) below the top voxel of the first ore
	// voxel in the column, or 0 when none: an "ore beneath" hint for renderers.
	Ore []int `json:"ore"`
}

// OreProbeDepth is how many voxels below the surface Window looks for ore.
const OreProbeDepth = 3

func isOreMat(m int) bool { return m == IronOre || m == CopperOre || m == TitaniumOre || m == Crystal }

// Window returns the terrain window [x0,x0+w) x [y0,y0+h) as JSON.
func (g *Game) Window(x0, y0, w, h int) (string, error) {
	if w < 0 || h < 0 || w*h > 1<<16 {
		return "", ErrUnsupported
	}
	v := WindowView{X: x0, Y: y0, W: w, H: h, Size: g.world.Size, Heights: make([]int, 0, w*h), Mats: make([]int, 0, w*h), Ore: make([]int, 0, w*h)}
	for y := y0; y < y0+h; y++ {
		for x := x0; x < x0+w; x++ {
			v.Heights = append(v.Heights, g.world.Height(x, y))
			v.Mats = append(v.Mats, g.world.SurfaceMaterial(x, y))
			ore, top := 0, g.world.Height(x, y)
			for d := 1; top >= 0 && d <= OreProbeDepth && top-d >= 0; d++ {
				if isOreMat(g.world.Get(x, y, top-d)) {
					ore = d
					break
				}
			}
			v.Ore = append(v.Ore, ore)
		}
	}
	b, err := json.Marshal(v)
	return string(b), err
}
