package takeon

import (
	"math"
	"sync"
)

var blueMasks = map[[2]int64][]float32{}
var blueMu sync.Mutex

func blueNoiseMask(size int, seed int64) []float32 {
	blueMu.Lock()
	defer blueMu.Unlock()
	key := [2]int64{int64(size), seed}
	if v, ok := blueMasks[key]; ok {
		return v
	}
	if size < 1 || size > 128 {
		return nil
	}
	n := size * size
	rng := NewMulberry32(int64(uint32(int32(seed) ^ 0x51f3)))
	binary := make([]uint8, n)
	energy := make([]float32, n)
	type kernelCell struct {
		dx, dy int
		w      float64
	}
	kernel := []kernelCell{}
	reach := size >> 1
	if reach > 4 {
		reach = 4
	}
	for dy := -reach; dy <= reach; dy++ {
		for dx := -reach; dx <= reach; dx++ {
			if dx != 0 || dy != 0 {
				kernel = append(kernel, kernelCell{dx, dy, math.Exp(-float64(dx*dx+dy*dy) / (2 * 1.5 * 1.5))})
			}
		}
	}
	stamp := func(index, sign int) {
		x, y := index%size, index/size
		for _, k := range kernel {
			nx, ny := (x+k.dx+size)%size, (y+k.dy+size)%size
			i := ny*size + nx
			energy[i] = float32(float64(energy[i]) + float64(sign)*k.w)
		}
	}
	tightest := func() int {
		best := -1
		bestE := math.Inf(-1)
		for i := 0; i < n; i++ {
			if binary[i] == 1 && float64(energy[i]) > bestE {
				bestE = float64(energy[i])
				best = i
			}
		}
		return best
	}
	largest := func() int {
		best := -1
		bestE := math.Inf(1)
		for i := 0; i < n; i++ {
			if binary[i] == 0 && float64(energy[i]) < bestE {
				bestE = float64(energy[i])
				best = i
			}
		}
		return best
	}
	initial := int(jsRound(float64(n) * .1))
	if initial < 1 {
		initial = 1
	}
	placed := 0
	for placed < initial {
		i := int(math.Floor(rng.Next() * float64(n)))
		if binary[i] != 0 {
			continue
		}
		binary[i] = 1
		stamp(i, 1)
		placed++
	}
	for guard := 0; guard < n*2; guard++ {
		cluster := tightest()
		if cluster < 0 {
			break
		}
		binary[cluster] = 0
		stamp(cluster, -1)
		void := largest()
		if void < 0 || void == cluster {
			binary[cluster] = 1
			stamp(cluster, 1)
			break
		}
		binary[void] = 1
		stamp(void, 1)
	}
	rank := make([]int, n)
	for i := range rank {
		rank[i] = -1
	}
	proto := append([]uint8(nil), binary...)
	protoEnergy := append([]float32(nil), energy...)
	for r := placed - 1; r >= 0; r-- {
		cluster := tightest()
		if cluster < 0 {
			break
		}
		binary[cluster] = 0
		stamp(cluster, -1)
		rank[cluster] = r
	}
	copy(binary, proto)
	copy(energy, protoEnergy)
	for r := placed; r < n; r++ {
		void := largest()
		if void < 0 {
			break
		}
		binary[void] = 1
		stamp(void, 1)
		rank[void] = r
	}
	mask := make([]float32, n)
	for i, r := range rank {
		if r >= 0 {
			mask[i] = float32(float64(r) / float64(n))
		}
	}
	blueMasks[key] = mask
	return mask
}
func blueNoise2(x, y float64, seed int64) float64 {
	size := 32
	mask := blueNoiseMask(size, seed)
	xi := ((int(math.Floor(x)) % size) + size) % size
	yi := ((int(math.Floor(y)) % size) + size) % size
	return float64(mask[yi*size+xi])
}
