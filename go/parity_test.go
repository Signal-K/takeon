package takeon

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

// Parity tests: load golden/*.json (dumped from the TS engine by
// packages/engine/scripts/golden.ts) and compare. Every vector set records
// count / exact / max abs error / max ulp error, and TestMain prints the table.

type row struct {
	set    string
	count  int
	exact  int
	maxAbs float64
	maxUlp uint64
	note   string
}

var (
	rowsMu sync.Mutex
	rows   []*row
)

func newRow(set string) *row {
	r := &row{set: set}
	rowsMu.Lock()
	rows = append(rows, r)
	rowsMu.Unlock()
	return r
}

func ulpDiff(a, b float64) uint64 {
	if a == b {
		return 0
	}
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.MaxUint64
	}
	ia, ib := int64(math.Float64bits(a)), int64(math.Float64bits(b))
	if ia < 0 {
		ia = math.MinInt64 - ia
	}
	if ib < 0 {
		ib = math.MinInt64 - ib
	}
	if ia > ib {
		return uint64(ia - ib)
	}
	return uint64(ib - ia)
}

func (r *row) float(got, want float64) bool {
	r.count++
	if got == want {
		r.exact++
		return true
	}
	if d := math.Abs(got - want); d > r.maxAbs {
		r.maxAbs = d
	}
	if u := ulpDiff(got, want); u > r.maxUlp {
		r.maxUlp = u
	}
	return false
}

func (r *row) exactEq(ok bool) bool {
	r.count++
	if ok {
		r.exact++
	}
	return ok
}

func load(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "golden", name+".json"))
	if err != nil {
		t.Fatalf("golden %s: %v (run packages/engine/scripts/golden.ts)", name, err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestMain(m *testing.M) {
	code := m.Run()
	sort.SliceStable(rows, func(i, j int) bool { return false })
	fmt.Println("\n=== takeon-go parity summary ===")
	fmt.Printf("%-34s %8s %8s %12s %8s  %s\n", "vector set", "count", "exact", "max abs err", "max ulp", "note")
	for _, r := range rows {
		fmt.Printf("%-34s %8d %8d %12.3g %8d  %s\n", r.set, r.count, r.exact, r.maxAbs, r.maxUlp, r.note)
	}
	os.Exit(code)
}

func TestRNG(t *testing.T) {
	var g struct {
		Mulberry32 []struct {
			Seed int64
			Out  []float64
		}
	}
	load(t, "rng", &g)
	r := newRow("mulberry32 (5 seeds x 1000)")
	for _, s := range g.Mulberry32 {
		m := NewMulberry32(s.Seed)
		for i, w := range s.Out {
			if got := m.Next(); !r.float(got, w) {
				t.Errorf("seed %d #%d: got %v want %v", s.Seed, i, got, w)
				break
			}
		}
	}
}

func TestHash(t *testing.T) {
	var g struct{ Hash2, Hash3 [][]float64 }
	load(t, "hash", &g)
	r2, r3 := newRow("hash2"), newRow("hash3")
	for _, v := range g.Hash2 {
		if got := hash2(v[0], v[1], int64(v[2])); !r2.float(got, v[3]) {
			t.Errorf("hash2%v: got %v", v, got)
		}
	}
	for _, v := range g.Hash3 {
		if got := hash3(v[0], v[1], v[2], int64(v[3])); !r3.float(got, v[4]) {
			t.Errorf("hash3%v: got %v", v, got)
		}
	}
}

func TestNoise(t *testing.T) {
	var g struct {
		Noise     map[string][][]float64
		MakeNoise map[string]struct {
			Cfg NoiseConfig
			Pts [][]float64
		}
		Hypot [][]float64
		Trig  [][]float64
	}
	load(t, "noise", &g)
	fns := map[string]func(x, y float64, s int64) float64{
		"value":        valueNoise2,
		"fbm":          func(x, y float64, s int64) float64 { return fbm2(x, y, s, 4) },
		"perlin":       perlin2,
		"simplex":      simplex2,
		"worley_f1":    func(x, y float64, s int64) float64 { return worley2(x, y, s, worleyF1) },
		"worley_f2f1":  func(x, y float64, s int64) float64 { return worley2(x, y, s, worleyF2F1) },
		"worley_cells": func(x, y float64, s int64) float64 { return worley2(x, y, s, worleyCells) },
	}
	names := make([]string, 0)
	for n := range g.Noise {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		r := newRow("noise." + n)
		for _, v := range g.Noise[n] {
			if got := fns[n](v[0], v[1], int64(v[2])); !r.float(got, v[3]) && r.count-r.exact == 1 {
				t.Errorf("noise %s%v: got %v", n, v, got)
			}
		}
	}
	mn := make([]string, 0)
	for n := range g.MakeNoise {
		mn = append(mn, n)
	}
	sort.Strings(mn)
	for _, n := range mn {
		c := g.MakeNoise[n]
		r := newRow("makeNoise." + n)
		cfg := c.Cfg
		fs := map[int64]func(x, y float64) float64{}
		for _, v := range c.Pts {
			s := int64(v[2])
			if fs[s] == nil {
				f, err := MakeNoise(&cfg, s)
				if err != nil {
					t.Fatal(err)
				}
				fs[s] = f
			}
			if got := fs[s](v[0], v[1]); !r.float(got, v[3]) && r.count-r.exact == 1 {
				t.Errorf("makeNoise %s%v: got %v", n, v, got)
			}
		}
	}
	rh := newRow("Math.hypot (V8 algorithm)")
	rh2 := newRow("Math.hypot vs go math.Hypot")
	rh3 := newRow("Math.hypot vs sqrt(x*x+y*y)")
	for _, v := range g.Hypot {
		if got := jsHypot(v[0], v[1]); !rh.float(got, v[2]) {
			t.Errorf("hypot%v: got %v", v, got)
		}
		rh2.float(math.Hypot(v[0], v[1]), v[2])
		rh3.float(math.Sqrt(float64(v[0]*v[0])+float64(v[1]*v[1])), v[2])
	}
	rh2.note, rh3.note = "(informational: not used)", "(informational: not used)"
	rs, rc := newRow("Math.sin (ported fdlibm)"), newRow("Math.cos (ported fdlibm)")
	rs2, rc2 := newRow("Math.sin vs go math.Sin"), newRow("Math.cos vs go math.Cos")
	for _, v := range g.Trig {
		if got := fsin(v[0]); !rs.float(got, v[1]) {
			t.Errorf("sin(%v): got %v want %v", v[0], got, v[1])
		}
		if got := fcos(v[0]); !rc.float(got, v[2]) {
			t.Errorf("cos(%v): got %v want %v", v[0], got, v[2])
		}
		rs2.float(math.Sin(v[0]), v[1])
		rc2.float(math.Cos(v[0]), v[2])
	}
	for _, r := range []*row{rs2, rc2} {
		r.note = "(informational: shows the mismatch the port fixes)"
	}
}

type goldTerrain struct {
	Body      string
	Seed      int64
	Size      int
	MaxHeight int
	Chunks    []uint32
	Heights   []int
	Surface   []int
	Landing   Vec2
	Anomalies []Anomaly
}

func TestTerrain(t *testing.T) {
	var all []goldTerrain
	load(t, "terrain", &all)
	rc := newRow("terrain chunk hashes")
	rh := newRow("terrain column heights")
	rs := newRow("terrain surface materials")
	rl := newRow("landing site")
	ra := newRow("anomaly lists")
	for _, gt := range all {
		body, err := GetBody(gt.Body)
		if err != nil {
			t.Fatal(err)
		}
		w, err := GenerateTerrain(body, gt.Seed)
		if err != nil {
			t.Fatal(err)
		}
		n := (body.Size + chunkSize - 1) / chunkSize
		bad := 0
		for cy := 0; cy < n; cy++ {
			for cx := 0; cx < n; cx++ {
				h := uint32(2166136261)
				for y := cy * chunkSize; y < min(body.Size, (cy+1)*chunkSize); y++ {
					for x := cx * chunkSize; x < min(body.Size, (cx+1)*chunkSize); x++ {
						for z := 0; z < body.MaxHeight; z++ {
							h = (h ^ uint32(w.Get(x, y, z))) * 16777619
						}
					}
				}
				if !rc.exactEq(h == gt.Chunks[cy*n+cx]) {
					bad++
				}
			}
		}
		hb, sb := 0, 0
		for y := 0; y < body.Size; y++ {
			for x := 0; x < body.Size; x++ {
				if !rh.exactEq(w.Height(x, y) == gt.Heights[y*body.Size+x]) {
					hb++
				}
				if !rs.exactEq(w.SurfaceMaterial(x, y) == gt.Surface[y*body.Size+x]) {
					sb++
				}
			}
		}
		if bad+hb+sb > 0 {
			t.Errorf("%s seed %d: %d chunk / %d height / %d surface mismatches", gt.Body, gt.Seed, bad, hb, sb)
		}
		if !rl.exactEq(FindLandingSite(w) == gt.Landing) {
			t.Errorf("%s seed %d: landing %v want %v", gt.Body, gt.Seed, FindLandingSite(w), gt.Landing)
		}
		ga, _ := json.Marshal(GenerateAnomalies(body, w, gt.Seed))
		wa, _ := json.Marshal(gt.Anomalies)
		if !ra.exactEq(string(ga) == string(wa)) {
			t.Errorf("%s seed %d: anomalies\n got %s\nwant %s", gt.Body, gt.Seed, ga, wa)
		}
	}
	ra.note = "(per body x seed)"
	rl.note = "(per body x seed)"
}

type goldOrder struct {
	Tick int
	Op   string
	Dir  int
}

type goldSnap struct {
	Tick       int
	Time       float64
	Pos        Vec2
	Facing     int
	Battery    float64
	Durability float64
	Fuel       float64
	Cargo      map[string]float64
	CargoUsed  float64
	MoveT      float64
	Moving     bool
	Mining     *struct {
		Pos       Vec2
		Remaining float64
	}
	Edits  map[string]int
	Status string
}

func TestScriptedRun(t *testing.T) {
	var runs []struct {
		Body      string
		Seed      int64
		Stats     RoverStats
		Landing   Vec2
		Script    []goldOrder
		Results   [][2]any
		Snapshots []goldSnap
	}
	load(t, "run", &runs)
	rf := newRow("run: float fields (battery,...)")
	rx := newRow("run: exact fields (pos,cargo,edits)")
	rst := newRow("run: derived rover stats")
	for _, run := range runs {
		g, err := NewGame(run.Seed, run.Body)
		if err != nil {
			t.Fatal(err)
		}
		st := g.State().Stats
		sj, _ := json.Marshal(st)
		wj, _ := json.Marshal(run.Stats)
		if !rst.exactEq(string(sj) == string(wj)) {
			t.Errorf("%s stats\n got %s\nwant %s", run.Body, sj, wj)
		}
		check := func(tick int, want goldSnap) {
			s := g.State()
			ok := true
			cmp := func(name string, got, w float64) {
				if !rf.float(got, w) {
					ok = false
					t.Errorf("%s tick %d %s: got %v want %v", run.Body, tick, name, got, w)
				}
			}
			cmp("time", s.Time, want.Time)
			cmp("battery", s.Rover.Battery, want.Battery)
			cmp("durability", s.Rover.Durability, want.Durability)
			cmp("fuel", s.Rover.Fuel, want.Fuel)
			cmp("moveT", s.Rover.MoveT, want.MoveT)
			cmp("cargoUsed", s.Rover.CargoUsed, want.CargoUsed)
			eq := func(name string, a, b any) {
				ja, _ := json.Marshal(a)
				jb, _ := json.Marshal(b)
				if !rx.exactEq(string(ja) == string(jb)) {
					ok = false
					t.Errorf("%s tick %d %s: got %s want %s", run.Body, tick, name, ja, jb)
				}
			}
			eq("pos", s.Rover.Pos, want.Pos)
			eq("facing", s.Rover.Facing, want.Facing)
			eq("cargo", s.Rover.Cargo, want.Cargo)
			eq("edits", s.Edits, want.Edits)
			eq("status", s.Status, want.Status)
			eq("moving", s.Rover.MoveFrom != nil, want.Moving)
			var gm, wm any
			if s.Rover.Mining != nil {
				gm = [3]float64{float64(s.Rover.Mining.Pos.X), float64(s.Rover.Mining.Pos.Y), s.Rover.Mining.Remaining}
			}
			if want.Mining != nil {
				wm = [3]float64{float64(want.Mining.Pos.X), float64(want.Mining.Pos.Y), want.Mining.Remaining}
			}
			eq("mining", gm, wm)
			_ = ok
		}
		check(0, run.Snapshots[0])
		si := 1
		for tk := 0; tk < 100; tk++ {
			for _, o := range run.Script {
				if o.Tick == tk {
					if o.Op == "move" {
						g.Move(o.Dir)
					} else {
						g.Drill()
					}
				}
			}
			g.Tick()
			if (tk+1)%10 == 0 {
				check(tk+1, run.Snapshots[si])
				si++
			}
		}
	}
}

func TestLongRunWithWeather(t *testing.T) {
	var runs []struct {
		Body      string
		Snapshots []struct {
			Tick       int
			Time       float64
			Pos        Vec2
			Battery    float64
			Durability float64
			Cargo      map[string]float64
			CargoUsed  float64
			Edits      int
			Weather    *Weather
			Status     string
		}
	}
	load(t, "run_long", &runs)
	rf := newRow("long run (2400t, weather): floats")
	rx := newRow("long run (2400t, weather): exact")
	for _, run := range runs {
		body, _ := GetBody(run.Body)
		g, _ := NewGame(body.Seed, run.Body)
		si := 0
		for tk := 0; tk < 2400; tk++ {
			if tk == 300 && run.Body == "mars" {
				g.StartWeather("dust-devil", -1, -1)
			}
			if tk == 300 && run.Body == "moon" {
				g.StartWeather("meteor-shower", -1, -1)
			}
			if tk%40 == 0 {
				g.Move((tk / 40) % 4)
			}
			if tk%40 == 20 {
				g.Drill()
			}
			g.Tick()
			if (tk+1)%100 == 0 {
				w := run.Snapshots[si]
				si++
				s := g.State()
				a := rf.float(s.Time, w.Time)
				b := rf.float(s.Rover.Battery, w.Battery)
				c := rf.float(s.Rover.Durability, w.Durability)
				gj, _ := json.Marshal([]any{s.Rover.Pos, s.Rover.Cargo, s.Rover.CargoUsed, len(s.Edits), s.Weather, s.Status})
				wj, _ := json.Marshal([]any{w.Pos, w.Cargo, w.CargoUsed, w.Edits, w.Weather, w.Status})
				d := rx.exactEq(string(gj) == string(wj))
				if !(a && b && c && d) {
					t.Errorf("%s tick %d diverged\n got %s b=%v d=%v\nwant %s b=%v d=%v", run.Body, w.Tick, gj, s.Rover.Battery, s.Rover.Durability, wj, w.Battery, w.Durability)
					break
				}
			}
		}
	}
}

// Snapshot/Restore: a restored game continues bit-identically to an
// uninterrupted one (including mid-weather, which the TS resume path cannot do).
func TestSnapshotRestoreRoundTrip(t *testing.T) {
	r := newRow("snapshot/restore continuation")
	for _, id := range []string{"mars", "moon", "ironrock"} {
		body, _ := GetBody(id)
		run := func(g *Game, from, to int) {
			for tk := from; tk < to; tk++ {
				if tk%40 == 0 {
					g.Move((tk / 40) % 4)
				}
				if tk%40 == 20 {
					g.Drill()
				}
				g.Tick()
			}
		}
		a, _ := NewGame(body.Seed, id)
		a.StartWeather("meteor-shower", -1, -1)
		run(a, 0, 700)
		snap, err := a.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		run(a, 700, 1500)
		b, _ := NewGame(1, "moon") // deliberately different, Restore must overwrite
		if err := b.Restore(snap); err != nil {
			t.Fatal(err)
		}
		run(b, 700, 1500)
		sa, _ := json.Marshal(a.State())
		sb, _ := json.Marshal(b.State())
		if !r.exactEq(strings.EqualFold(string(sa), string(sb))) {
			t.Errorf("%s: restored run diverged\n a=%s\n b=%s", id, sa, sb)
		}
	}
}

func TestOrderStubs(t *testing.T) {
	g, _ := NewGame(4212, "mars")
	for _, k := range []string{"build", "scan", "photo", "craft"} {
		if _, err := g.Order(k, 0); err == nil {
			t.Errorf("order %q should be reported unsupported", k)
		}
	}
	if _, err := MakeNoise(&NoiseConfig{Type: "blue"}, 1); err == nil {
		t.Error("blue noise should be reported unsupported")
	}
}
