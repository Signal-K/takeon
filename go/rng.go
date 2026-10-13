package takeon

// Mulberry32 is the engine's seeded RNG. Its entire state is one uint32, which
// is what makes mid-run snapshots exact (the TS engine reseeds weather on
// resume instead).
type Mulberry32 struct{ a uint32 }

func NewMulberry32(seed int64) *Mulberry32 { return &Mulberry32{a: uint32(seed)} }

func (m *Mulberry32) Next() float64 {
	m.a += 0x6d2b79f5
	a := m.a
	t := (a ^ (a >> 15)) * (1 | a)
	t = (t + (t^(t>>7))*(61|t)) ^ t
	return float64((t^(t>>14))&0xffffffff) / 4294967296
}

// hash2 mirrors util/rng.ts hash2. x and y are float64 because JS multiplies
// them as doubles before the int32 truncation inside `^`.
func hash2(x, y float64, seed int64) float64 {
	h := uint32(seed)
	h = (h ^ uint32(toInt32(x*374761393))) * 668265263
	h = (h ^ uint32(toInt32(y*2246822519))) * 3266489917
	h ^= h >> 15
	h *= 2654435761
	h ^= h >> 13
	return float64(h) / 4294967296
}

func hash3(x, y, z float64, seed int64) float64 {
	return hash2(x, float64(y*31)+float64(z*977), int64(uint32(seed)^0x9e3779b9))
}
