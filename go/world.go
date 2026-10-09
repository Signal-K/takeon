package takeon

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// VoxelWorld mirrors world/world.ts: dense column-major storage plus a sparse
// edit log for persistence.
type VoxelWorld struct {
	Size, MaxHeight int
	voxels          []uint8
	heights         []int8
	Edits           map[string]int
}

func NewVoxelWorld(size, maxHeight int) *VoxelWorld {
	h := make([]int8, size*size)
	for i := range h {
		h[i] = -1
	}
	return &VoxelWorld{Size: size, MaxHeight: maxHeight, voxels: make([]uint8, size*size*maxHeight), heights: h, Edits: map[string]int{}}
}

func (w *VoxelWorld) InBounds(x, y int) bool { return x >= 0 && y >= 0 && x < w.Size && y < w.Size }
func (w *VoxelWorld) idx(x, y, z int) int    { return (y*w.Size+x)*w.MaxHeight + z }

func (w *VoxelWorld) Get(x, y, z int) int {
	if !w.InBounds(x, y) || z < 0 || z >= w.MaxHeight {
		return Air
	}
	return int(w.voxels[w.idx(x, y, z)])
}

func (w *VoxelWorld) setRaw(x, y, z, m int) {
	if !w.InBounds(x, y) || z < 0 || z >= w.MaxHeight {
		return
	}
	w.voxels[w.idx(x, y, z)] = uint8(m)
	hi := y*w.Size + x
	if m != Air && z > int(w.heights[hi]) {
		w.heights[hi] = int8(z)
	}
	if m == Air && int(w.heights[hi]) == z {
		w.recomputeHeight(x, y)
	}
}

func (w *VoxelWorld) Set(x, y, z, m int) {
	w.setRaw(x, y, z, m)
	w.Edits[fmt.Sprintf("%d,%d,%d", x, y, z)] = m
}

func (w *VoxelWorld) recomputeHeight(x, y int) {
	hi := y*w.Size + x
	for z := w.MaxHeight - 1; z >= 0; z-- {
		if w.voxels[w.idx(x, y, z)] != Air {
			w.heights[hi] = int8(z)
			return
		}
	}
	w.heights[hi] = -1
}

func (w *VoxelWorld) Height(x, y int) int {
	if !w.InBounds(x, y) {
		return -1
	}
	return int(w.heights[y*w.Size+x])
}

func (w *VoxelWorld) SurfaceMaterial(x, y int) int {
	h := w.Height(x, y)
	if h < 0 {
		return Air
	}
	return w.Get(x, y, h)
}

func (w *VoxelWorld) IsSolid(x, y int) bool { return w.Height(x, y) >= 0 }

// MineTop removes the top voxel; ok=false when nothing was mined.
func (w *VoxelWorld) MineTop(x, y int) (mat int, ok bool) {
	h := w.Height(x, y)
	if h < 0 || h == 0 {
		return 0, false
	}
	m := w.Get(x, y, h)
	w.Set(x, y, h, Air)
	return m, true
}

// Step is the signed height step; +Inf when the target is void.
func (w *VoxelWorld) Step(x0, y0, x1, y1 int) float64 {
	h0, h1 := w.Height(x0, y0), w.Height(x1, y1)
	if h1 < 0 {
		return math.Inf(1)
	}
	return float64(h1 - h0)
}

func (w *VoxelWorld) applyEdits(edits map[string]int) {
	for k, m := range edits {
		p := strings.Split(k, ",")
		x, _ := strconv.Atoi(p[0])
		y, _ := strconv.Atoi(p[1])
		z, _ := strconv.Atoi(p[2])
		w.setRaw(x, y, z, m)
		w.Edits[k] = m
	}
}
