// solar-studio is a local renderer for inspecting Takeon's generated locations.
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"

	takeon "github.com/Signal-K/takeon-go"
)

//go:embed index.html
var page embed.FS
var colours = map[string][3]float32{
	"ocean": {0.13, 0.37, 0.48}, "ice": {0.78, 0.9, 0.88}, "tundra": {0.61, 0.69, 0.59}, "highlands": {0.45, 0.52, 0.38}, "drylands": {0.72, 0.59, 0.40}, "grassland": {0.38, 0.63, 0.43}, "red-desert": {0.67, 0.33, 0.24}, "volcanic-highlands": {0.35, 0.25, 0.23}, "sulfur-plains": {0.77, 0.60, 0.32}, "ice-ridges": {0.58, 0.73, 0.78}, "icefield": {0.78, 0.89, 0.90}, "methane-lakes": {0.24, 0.39, 0.48}, "dunes": {0.65, 0.49, 0.30}, "rubble-highlands": {0.45, 0.40, 0.38}, "dark-regolith": {0.29, 0.29, 0.31}, "metal-ridges": {0.60, 0.65, 0.68}, "metal-regolith": {0.41, 0.46, 0.49}, "crater-highlands": {0.63, 0.60, 0.54}, "regolith": {0.42, 0.41, 0.38}, "cloud-band": {0.83, 0.70, 0.53}, "storm-band": {0.57, 0.39, 0.29},
}

type mesh struct {
	Positions []float32 `json:"positions"`
	Normals   []float32 `json:"normals"`
	Colors    []float32 `json:"colors"`
	Count     int       `json:"count"`
}
type vec struct{ x, y, z float64 }

func sub(a, b vec) vec   { return vec{a.x - b.x, a.y - b.y, a.z - b.z} }
func cross(a, b vec) vec { return vec{a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x} }
func unit(a vec) vec {
	l := math.Sqrt(a.x*a.x + a.y*a.y + a.z*a.z)
	if l < 1e-12 {
		return vec{0, 1, 0}
	}
	return vec{a.x / l, a.y / l, a.z / l}
}
func appendVec(a []float32, v vec) []float32 {
	return append(a, float32(v.x), float32(v.y), float32(v.z))
}
func makeMesh(id string, seed uint32, rows, cols int) (mesh, error) {
	profile, err := takeon.SolarProfileByID(id)
	if err != nil {
		return mesh{}, err
	}
	type point struct {
		p vec
		n vec
		c [3]float32
	}
	grid := make([]point, (rows+1)*(cols+1))
	index := func(y, x int) int { return y*(cols+1) + x }
	for y := 0; y <= rows; y++ {
		lat := -90 + 180*float64(y)/float64(rows)
		phi := lat * math.Pi / 180
		for x := 0; x <= cols; x++ {
			lon := -180 + 360*float64(x)/float64(cols)
			theta := lon * math.Pi / 180
			s, e := takeon.SampleSolarBody(id, seed, lat, lon)
			if e != nil {
				return mesh{}, e
			}
			radius := 1 + s.Elevation*0.55
			if s.Biome == "ocean" {
				radius = 1 + math.Min(s.Elevation*0.55, 0)
			}
			if !profile.Landable {
				radius = 1
			}
			colour := colours[s.Biome]
			if id == "moon" {
				measured, err := takeon.SampleLunarSurface(lat, lon)
				if err != nil {
					return mesh{}, err
				}
				// Exaggerate measured height fourfold so relief reads on a globe.
				radius = 1 + 4*measured.ElevationMeters/1737400
				colour = [3]float32{float32(measured.Red), float32(measured.Green), float32(measured.Blue)}
			}
			grid[index(y, x)] = point{p: vec{radius * math.Cos(phi) * math.Cos(theta), radius * math.Sin(phi), radius * math.Cos(phi) * math.Sin(theta)}, c: colour}
		}
	}
	// Share a smooth normal across adjacent triangles, including the seam.
	for y := 0; y <= rows; y++ {
		for x := 0; x <= cols; x++ {
			i := index(y, x)
			if y == 0 || y == rows {
				grid[i].n = unit(grid[i].p)
				continue
			}
			left, right := (x+cols-1)%cols, (x+1)%cols
			tangent := sub(grid[index(y, right)].p, grid[index(y, left)].p)
			meridian := sub(grid[index(y+1, x)].p, grid[index(y-1, x)].p)
			normal := unit(cross(meridian, tangent))
			if normal.x*grid[i].p.x+normal.y*grid[i].p.y+normal.z*grid[i].p.z < 0 {
				normal = vec{-normal.x, -normal.y, -normal.z}
			}
			grid[i].n = normal
		}
	}
	result := mesh{}
	tri := func(a, b, c point) {
		for _, p := range []point{a, b, c} {
			result.Positions = appendVec(result.Positions, p.p)
			result.Normals = appendVec(result.Normals, p.n)
			result.Colors = append(result.Colors, p.c[:]...)
			result.Count++
		}
	}
	for y := 0; y < rows; y++ {
		for x := 0; x < cols; x++ {
			a, b, c, d := grid[index(y, x)], grid[index(y+1, x)], grid[index(y, x+1)], grid[index(y+1, x+1)]
			tri(a, b, c)
			tri(c, b, d)
		}
	}
	return result, nil
}
func main() {
	addr := flag.String("addr", "127.0.0.1:4343", "listen address")
	flag.Parse()
	http.HandleFunc("/api/profiles", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(takeon.SolarProfiles())
	})
	http.HandleFunc("/api/mesh", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		s, e := strconv.ParseUint(r.URL.Query().Get("seed"), 10, 32)
		if e != nil {
			http.Error(w, "invalid seed", 400)
			return
		}
		m, e := makeMesh(id, uint32(s), 128, 256)
		if e != nil {
			http.Error(w, e.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(m)
	})
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		b, _ := page.ReadFile("index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(b)
	})
	fmt.Printf("Solar studio: http://%s\n", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
