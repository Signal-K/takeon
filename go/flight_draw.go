package takeon

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Drawing a flight without a renderer. FlightStage turns a FlightState into a
// flat list of screen-space shapes (FlightDraw) that any 2D canvas can paint:
// the browser's Canvas 2D, SwiftUI Canvas, Android Canvas or Compose. Every
// decision about where things are, how big, how faded and in what order is
// made here, so the web, iOS and Android views of a flight cannot drift apart.
//
// Hosts own only three textures, placed by the list: the starfield ("sky"),
// the destination globe ("globe") and the destination's limb seen from orbit
// ("limb"). Everything else is ellipses, polygons, lines, glows and text.

// FlightCraftSection is one run of the craft's hull, tail first.
type FlightCraftSection struct {
	ID     string  `json:"id"`
	Length float64 `json:"length"`
	R0     float64 `json:"r0"` // radius at the tail end
	R1     float64 `json:"r1"` // radius at the nose end
	Color  string  `json:"color"`
	Band   string  `json:"band,omitempty"` // painted ring around the middle
}

// FlightCraftFins are flat fins around the tail.
type FlightCraftFins struct {
	Count  int     `json:"count"`
	Span   float64 `json:"span"`
	Length float64 `json:"length"`
	Color  string  `json:"color"`
}

// FlightCraftBoosters are strap-on boosters around the tail.
type FlightCraftBoosters struct {
	Count  int     `json:"count"`
	Radius float64 `json:"radius"`
	Length float64 `json:"length"`
	Color  string  `json:"color"`
}

// FlightCraftLook describes a vehicle as a lathe: sections along one axis.
// Nothing here knows what a rocket is; hosts describe their own vehicle.
type FlightCraftLook struct {
	Sections []FlightCraftSection `json:"sections"`
	Fins     *FlightCraftFins     `json:"fins,omitempty"`
	Boosters *FlightCraftBoosters `json:"boosters,omitempty"`
	Plume    string               `json:"plume,omitempty"`
	Scale    float64              `json:"scale,omitempty"`
}

// DefaultFlightCraft is the stock craft used when a host supplies none.
func DefaultFlightCraft() FlightCraftLook {
	return FlightCraftLook{
		Sections: []FlightCraftSection{
			{ID: "engine", Length: 0.28, R0: 0.2, R1: 0.26, Color: "#3c4658"},
			{ID: "tank", Length: 0.9, R0: 0.26, R1: 0.26, Color: "#eef2f6", Band: "#2f6fd0"},
			{ID: "payload", Length: 0.5, R0: 0.26, R1: 0.22, Color: "#dfe6ee"},
			{ID: "nose", Length: 0.45, R0: 0.22, R1: 0.02, Color: "#2f6fd0"},
		},
		Fins:  &FlightCraftFins{Count: 4, Span: 0.24, Length: 0.42, Color: "#2f6fd0"},
		Plume: "#7fd4ff",
		Scale: 1.25,
	}
}

// Validate rejects a look a renderer could not draw sensibly.
func (l FlightCraftLook) Validate() error {
	if len(l.Sections) == 0 || len(l.Sections) > 64 {
		return fmt.Errorf("takeon: a craft needs 1..64 sections")
	}
	for _, s := range l.Sections {
		for _, v := range []float64{s.Length, s.R0, s.R1} {
			if !finite(v) || v < 0 || v > 10 {
				return fmt.Errorf("takeon: craft section %q has an invalid size", s.ID)
			}
		}
	}
	if !finite(l.Scale) || l.Scale < 0 || l.Scale > 10 {
		return fmt.Errorf("takeon: craft scale must be 0..10")
	}
	if l.Fins != nil && (l.Fins.Count < 0 || l.Fins.Count > 12) {
		return fmt.Errorf("takeon: craft fins must number 0..12")
	}
	if l.Boosters != nil && (l.Boosters.Count < 0 || l.Boosters.Count > 12) {
		return fmt.Errorf("takeon: craft boosters must number 0..12")
	}
	return nil
}

// FlightStop is one colour stop of a radial glow.
type FlightStop struct {
	At    float64 `json:"at"`
	Color string  `json:"c"`
	A     float64 `json:"a"`
}

// Shape kinds in a FlightDraw.
const (
	ShapeSky      = "sky"      // host starfield texture: X,Y origin, RX,RY size
	ShapeGlobe    = "globe"    // destination disc: X,Y centre, RX radius, Spin rotation
	ShapeLimb     = "limb"     // destination from orbit: X,Y centre of a huge disc, RX radius, Spin rotation
	ShapeEllipse  = "ellipse"  // X,Y centre, RX,RY radii, Rot radians
	ShapePoly     = "poly"     // Pts as x0,y0,x1,y1..., closed unless Open
	ShapeLine     = "line"     // X,Y to X2,Y2
	ShapeGlow     = "glow"     // radial gradient at X,Y out to RX through Stops
	ShapeText     = "text"     // Text centred on X with its baseline at Y
	ShapeVignette = "vignette" // red edge flash over the whole view, Fill at alpha A
)

// FlightShape is one primitive in screen space (the host's points, y down).
// Absent numeric fields are zero. A shape with Fill is filled, with Stroke is
// stroked at width W; both may be set. A is the opacity of the whole shape.
//
// Lit marks a filled ellipse or polygon lit from one side: paint a linear
// gradient from (X+Lit[0], Y+Lit[1]) to (X-Lit[0], Y-Lit[1]) through Fill
// scaled by 1.12 at 0, 0.92 at 0.45 and 0.42 at 1. Add means additive blend.
type FlightShape struct {
	K      string       `json:"k"`
	X      float64      `json:"x,omitempty"`
	Y      float64      `json:"y,omitempty"`
	X2     float64      `json:"x2,omitempty"`
	Y2     float64      `json:"y2,omitempty"`
	RX     float64      `json:"rx,omitempty"`
	RY     float64      `json:"ry,omitempty"`
	Rot    float64      `json:"rot,omitempty"`
	Spin   float64      `json:"spin,omitempty"`
	Pts    []float64    `json:"pts,omitempty"`
	Open   bool         `json:"open,omitempty"`
	Fill   string       `json:"fill,omitempty"`
	Stroke string       `json:"stroke,omitempty"`
	W      float64      `json:"w,omitempty"`
	A      float64      `json:"a,omitempty"`
	Lit    []float64    `json:"lit,omitempty"`
	Stops  []FlightStop `json:"stops,omitempty"`
	Add    bool         `json:"add,omitempty"`
	Text   string       `json:"text,omitempty"`
	Size   float64      `json:"size,omitempty"`
}

// FlightDraw is one frame of a flight, painted in order.
type FlightDraw struct {
	Width    float64       `json:"width"`
	Height   float64       `json:"height"`
	SkySeed  uint32        `json:"skySeed"`  // seed a host uses to paint its starfield once
	OrbitMix float64       `json:"orbitMix"` // 0 corridor view .. 1 orbit view
	Shapes   []FlightShape `json:"shapes"`
}

// The corridor and the camera, in view units.
const (
	FlightCorridorHalfWidth  = 3.1
	FlightCorridorHalfHeight = 1.75
	FlightCraftDepth         = 5.2
)

type flightCam struct{ cx, cy, f float64 }

type vec3 [3]float64

func (c flightCam) project(p vec3) (x, y, s float64) {
	z := math.Max(0.05, p[2])
	s = c.f / z
	return c.cx + p[0]*s, c.cy - p[1]*s, s
}

func norm3(v vec3) vec3 {
	l := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	if l == 0 {
		l = 1
	}
	return vec3{v[0] / l, v[1] / l, v[2] / l}
}

func cross3(a, b vec3) vec3 {
	return vec3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}

func along3(base, d vec3, k float64) vec3 {
	return vec3{base[0] + d[0]*k, base[1] + d[1]*k, base[2] + d[2]*k}
}

// FlightStage is the view side of one flight: easing, the dust field, rock
// shapes and the craft look. It holds no rules; a flight plays the same with
// or without one.
type FlightStage struct {
	craft    FlightCraftLook
	sites    []FlightSite
	seed     uint32
	orbitMix float64
	shake    float64
	flash    float64
	sparkle  float64
	started  bool
	dust     []vec3
	rocks    map[int][]float64
	shapes   []FlightShape
	offX     float64
	offY     float64
	alpha    float64
}

// NewFlightStage prepares a stage. A nil craft uses DefaultFlightCraft.
func NewFlightStage(seed uint32, sites []FlightSite, craft *FlightCraftLook) *FlightStage {
	s := &FlightStage{seed: seed, sites: append([]FlightSite{}, sites...), rocks: map[int][]float64{}}
	if craft != nil {
		s.craft = *craft
	} else {
		s.craft = DefaultFlightCraft()
	}
	r := NewMulberry32(int64(seed ^ 0x51f1))
	for i := 0; i < 70; i++ {
		s.dust = append(s.dust, vec3{r.Next()*2 - 1, r.Next()*2 - 1, r.Next()})
	}
	return s
}

// SetCraft replaces the craft look.
func (s *FlightStage) SetCraft(look FlightCraftLook) { s.craft = look }

// React feeds the events of a step so hits shake and pickups sparkle.
func (s *FlightStage) React(events []FlightEvent) {
	for _, e := range events {
		switch e.Kind {
		case "hit":
			s.shake, s.flash = 0.4, 0.5
		case "pickup", "sample", "site":
			s.sparkle = 0.45
		}
	}
}

// hexRGB parses "#rgb" or "#rrggbb"; anything else is mid grey.
func hexRGB(hex string) (r, g, b float64) {
	h := strings.TrimPrefix(hex, "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	for len(h) < 6 {
		h += "0"
	}
	n, err := strconv.ParseUint(h[:6], 16, 32)
	if err != nil {
		return 128, 128, 128
	}
	return float64(n >> 16 & 255), float64(n >> 8 & 255), float64(n & 255)
}

// scaleHex brightens or darkens a colour, clamped to white.
func scaleHex(hex string, k float64) string {
	r, g, b := hexRGB(hex)
	c := func(v float64) int { return int(math.Round(math.Min(255, math.Max(0, v*k)))) }
	return fmt.Sprintf("#%02x%02x%02x", c(r), c(g), c(b))
}

func (s *FlightStage) add(sh FlightShape) {
	sh.A *= s.alpha
	if sh.A <= 0.002 {
		return
	}
	sh.X += s.offX
	sh.Y += s.offY
	if sh.K == ShapeLine {
		sh.X2 += s.offX
		sh.Y2 += s.offY
	}
	for i := range sh.Pts {
		if i%2 == 0 {
			sh.Pts[i] += s.offX
		} else {
			sh.Pts[i] += s.offY
		}
	}
	s.shapes = append(s.shapes, sh)
}

// Draw advances the view's own easing by dt and lays out one frame at w x h.
func (s *FlightStage) Draw(st FlightState, w, h, dt float64) FlightDraw {
	if !finite(w) || w < 1 {
		w = 1
	}
	if !finite(h) || h < 1 {
		h = 1
	}
	if !finite(dt) || dt < 0 {
		dt = 0
	}
	dt = math.Min(dt, 0.25)
	target := -1.0
	if st.Phase == FlightOrbit {
		target = 1
	}
	if !s.started {
		// A stage mounted straight into orbit starts there rather than fading in.
		s.started = true
		if st.Phase == FlightOrbit {
			s.orbitMix = 1
		}
	}
	s.orbitMix = clampF(s.orbitMix+target*dt/1.1, 0, 1)
	s.shake = math.Max(0, s.shake-dt)
	s.flash = math.Max(0, s.flash-dt)
	s.sparkle = math.Max(0, s.sparkle-dt)

	s.shapes = make([]FlightShape, 0, 256)
	s.offX, s.offY, s.alpha = 0, 0, 1
	const slide = 10.0
	s.add(FlightShape{K: ShapeSky,
		X:  -slide - st.X*slide*(1-s.orbitMix) - math.Mod(s.orbitMix*st.Angle*40, 1),
		Y:  -slide + st.Y*slide*0.6,
		RX: w + slide*2, RY: h + slide*2, A: 1})
	if s.shake > 0 {
		s.offX = math.Sin(st.Time*90) * s.shake * 14
		s.offY = math.Cos(st.Time*77) * s.shake * 10
	}
	if s.orbitMix < 1 {
		s.alpha = 1 - s.orbitMix
		s.drawCorridor(st, w, h)
	}
	if s.orbitMix > 0 {
		s.alpha = s.orbitMix
		s.drawOrbit(st, w, h)
	}
	s.offX, s.offY, s.alpha = 0, 0, 1
	if s.flash > 0 {
		s.add(FlightShape{K: ShapeVignette, Fill: "#ff5a46", A: s.flash * 0.9})
	}
	return FlightDraw{Width: w, Height: h, SkySeed: s.seed, OrbitMix: s.orbitMix, Shapes: s.shapes}
}

func (s *FlightStage) drawCorridor(st FlightState, w, h float64) {
	minWH := math.Min(w, h)
	const follow = 0.45
	cam := flightCam{cx: w / 2, cy: h * 0.3, f: math.Max(w*0.62, math.Min(h*0.95, w*1.1))}
	camX := st.X * FlightCorridorHalfWidth * follow
	cameraHeight := clampF(0.36*h*FlightCraftDepth/cam.f, 1.2, 2.6)
	camY := st.Y*FlightCorridorHalfHeight*follow + cameraHeight
	view := func(x, y, z float64) vec3 { return vec3{x - camX, y - camY, z} }

	// The destination ahead grows with the course and swells on approach.
	p := st.Progress
	grow := math.Pow(p, 2.4)
	r := minWH * (0.035 + 0.5*grow)
	if st.Phase == FlightApproach {
		r += minWH * 0.5 * math.Pow((p-0.86)/0.14, 2)
	}
	s.add(FlightShape{K: ShapeGlobe, X: cam.cx + w*0.1*(1-grow), Y: cam.cy - h*0.04*(1-grow) + r*0.25*grow, RX: r, Spin: st.Time * 0.05, A: 1})

	// Corridor gates: corner brackets every 30 units, fading in and out.
	const gap = 30.0
	offset := gap - math.Mod(st.Scroll, gap)
	for i := 7; i >= 0; i-- {
		z := offset + float64(i)*gap
		ax, ay, _ := cam.project(view(-FlightCorridorHalfWidth*1.08, -FlightCorridorHalfHeight*1.12, z))
		bx, by, _ := cam.project(view(FlightCorridorHalfWidth*1.08, FlightCorridorHalfHeight*1.12, z))
		alpha := math.Min(1, z/10) * math.Max(0, 1-z/(gap*8)) * 0.22
		l := math.Min(bx-ax, ay-by) * 0.16
		for _, c := range [][4]float64{{ax, ay, 1, -1}, {bx, ay, -1, -1}, {ax, by, 1, 1}, {bx, by, -1, 1}} {
			s.add(FlightShape{K: ShapePoly, Open: true, Pts: []float64{c[0] + c[2]*l, c[1], c[0], c[1], c[0], c[1] + c[3]*l}, Stroke: "#78c8ff", W: 1, A: alpha})
		}
	}

	// Dust streaks: the sense of speed.
	const span = 60.0
	streak := math.Min(2.6, st.Speed/12)
	for _, d := range s.dust {
		z := math.Mod(math.Mod(d[2]*span-st.Scroll, span)+span, span) + 0.8
		ax, ay, _ := cam.project(view(d[0]*9, d[1]*6, z))
		bx, by, _ := cam.project(view(d[0]*9, d[1]*6, z+streak))
		s.add(FlightShape{K: ShapeLine, X: ax, Y: ay, X2: bx, Y2: by, Stroke: "#d2e6ff", W: math.Min(1.6, 5/z), A: math.Min(0.5, 2.4/z) * math.Min(1, z/3)})
	}

	objects := append([]FlightObject{}, st.Objects...)
	sort.SliceStable(objects, func(i, j int) bool { return objects[i].Z > objects[j].Z })
	for _, o := range objects {
		if o.Z > 0 {
			s.drawObject(cam, o, st.Time, camX, camY, w, h)
		}
	}
	thrust := 1.0
	switch {
	case st.Phase == FlightApproach:
		thrust = 0.45
	case st.Slowed:
		thrust = 0.3
	case st.Boosting:
		thrust = 2
	}
	tail := view(st.X*FlightCorridorHalfWidth, st.Y*FlightCorridorHalfHeight, FlightCraftDepth)
	s.drawCraft(cam, tail, vec3{st.VX * 0.22, st.VY*0.2 + 0.06, 1}, -st.VX*0.5, thrust, st.Time)
	if s.sparkle > 0 {
		cx, cy, _ := cam.project(tail)
		rr := (1-s.sparkle/0.45)*90 + 10
		s.add(FlightShape{K: ShapeEllipse, X: cx, Y: cy - 20, RX: rr, RY: rr, Stroke: "#a0ebff", W: 3, A: math.Min(1, s.sparkle*1.6)})
	}
	for _, o := range objects {
		if o.Z <= 0 {
			s.drawObject(cam, o, st.Time, camX, camY, w, h)
		}
	}
}

func (s *FlightStage) rock(id int) []float64 {
	if shape, ok := s.rocks[id]; ok {
		return shape
	}
	r := NewMulberry32(int64(uint32(id) * 2654435761))
	n := 7 + int(r.Next()*4)
	shape := make([]float64, 0, n*2)
	for i := 0; i < n; i++ {
		a := float64(i) / float64(n) * math.Pi * 2
		k := 0.7 + r.Next()*0.45
		shape = append(shape, math.Cos(a)*k, math.Sin(a)*k)
	}
	if len(s.rocks) > 400 {
		s.rocks = map[int][]float64{}
	}
	s.rocks[id] = shape
	return shape
}

func (s *FlightStage) drawObject(cam flightCam, o FlightObject, t, camX, camY, w, h float64) {
	depth := FlightCraftDepth + o.Z
	if depth < 0.6 {
		return
	}
	px, py, ps := cam.project(vec3{o.X*FlightCorridorHalfWidth - camX, o.Y*FlightCorridorHalfHeight - camY, depth})
	r := math.Max(1, o.R*FlightCorridorHalfHeight*ps)
	fade := clampF((245-depth)/60, 0, 1) * math.Min(1, (depth-0.6)/1.5)
	if o.Done {
		fade *= 0.25
	}
	if fade <= 0 || px < -r || px > w+r || py < -r || py > h+r {
		return
	}
	rotated := func(pts []float64, angle, k float64) []float64 {
		c, sn := math.Cos(angle), math.Sin(angle)
		out := make([]float64, len(pts))
		for i := 0; i+1 < len(pts); i += 2 {
			x, y := pts[i]*k, pts[i+1]*k
			out[i], out[i+1] = px+x*c-y*sn, py+x*sn+y*c
		}
		return out
	}
	if o.Kind == "debris" {
		angle := o.Spin + t*(0.4+float64(o.ID%5)*0.15)
		shape := s.rock(o.ID)
		s.add(FlightShape{K: ShapePoly, X: px, Y: py, Pts: rotated(shape, angle, r), Fill: "#a39a8d", Lit: []float64{-r * 0.7, -r * 0.7}, A: fade})
		if r > 6 {
			for i := 0; i < 3; i++ {
				j := (i * 3) % (len(shape) / 2)
				c := rotated([]float64{shape[j*2] * 0.4, shape[j*2+1] * 0.4}, angle, r)
				s.add(FlightShape{K: ShapeEllipse, X: c[0], Y: c[1], RX: r * 0.16, RY: r * 0.11, Rot: float64(i) + angle, Fill: "#141210", A: fade * 0.45})
			}
		}
		return
	}
	if o.Done {
		return
	}
	colour := "#ffd060"
	if o.Kind == "boost" {
		colour = "#6edcff"
	}
	pulse := 1 + 0.08*math.Sin(t*5+float64(o.ID))
	s.add(FlightShape{K: ShapeGlow, X: px, Y: py, RX: r * 2.2, Stops: []FlightStop{{0, colour, 0.35}, {1, colour, 0}}, A: fade})
	width := math.Max(1.5, r*0.22)
	if o.Kind == "boost" {
		s.add(FlightShape{K: ShapeEllipse, X: px, Y: py, RX: r * pulse, RY: r * pulse * 0.92, Stroke: colour, W: width, A: fade})
		bolt := []float64{0.12, -0.5, -0.3, 0.08, 0, 0.08, -0.12, 0.5, 0.3, -0.08, 0, -0.08}
		s.add(FlightShape{K: ShapePoly, X: px, Y: py, Pts: rotated(bolt, 0, r), Fill: "#ffffff", A: fade})
		return
	}
	diamond := []float64{0, -pulse, 0.62, 0, 0, pulse, -0.62, 0}
	s.add(FlightShape{K: ShapePoly, X: px, Y: py, Pts: rotated(diamond, t*1.4+o.Spin, r), Fill: "#ffe096", Stroke: colour, W: width, A: fade})
}

type flightRing struct {
	p     vec3
	r     float64
	color string
}

func flightLathe(sections []FlightCraftSection, origin, axis vec3, scale, step float64) []flightRing {
	var rings []flightRing
	t := 0.0
	for _, sec := range sections {
		n := int(math.Max(2, math.Ceil(sec.Length*scale/step)))
		for i := 0; i < n; i++ {
			u := float64(i) / float64(n-1)
			color := sec.Color
			if sec.Band != "" && u > 0.42 && u < 0.58 {
				color = sec.Band
			}
			rings = append(rings, flightRing{p: along3(origin, axis, (t+sec.Length*u)*scale), r: (sec.R0 + (sec.R1-sec.R0)*u) * scale, color: color})
		}
		t += sec.Length
	}
	return rings
}

func (s *FlightStage) drawRings(cam flightCam, rings []flightRing, axis vec3) {
	order := make([]int, len(rings))
	for i := range order {
		order[i] = i
	}
	// Far rings first, so nearer ones cover them.
	sort.SliceStable(order, func(a, b int) bool { return rings[order[a]].p[2] > rings[order[b]].p[2] })
	for _, i := range order {
		ring := rings[i]
		cx, cy, cs := cam.project(ring.p)
		ax, ay, _ := cam.project(along3(ring.p, axis, 0.05))
		v := norm3(ring.p)
		facing := math.Abs(axis[0]*v[0] + axis[1]*v[1] + axis[2]*v[2])
		major := math.Max(0.5, ring.r*cs)
		minor := math.Max(0.5, major*facing)
		dx, dy := ax-cx, ay-cy
		rot := 0.0
		if math.Hypot(dx, dy) >= 1e-4 {
			rot = math.Atan2(dy, dx) + math.Pi/2
		}
		// Light from the upper left, whichever way the ring lies.
		gx, gy := math.Cos(rot)*major, math.Sin(rot)*major
		flip := -1.0
		if gx*-0.7+gy*-0.7 > 0 {
			flip = 1
		}
		s.add(FlightShape{K: ShapeEllipse, X: cx, Y: cy, RX: major, RY: minor, Rot: rot, Fill: ring.color, Lit: []float64{gx * flip, gy * flip}, A: 1})
	}
}

// drawCraft lays out the craft as lit rings, fins, boosters and plume.
func (s *FlightStage) drawCraft(cam flightCam, position, axisIn vec3, roll, thrust, t float64) {
	look := s.craft
	if len(look.Sections) == 0 {
		look = DefaultFlightCraft()
	}
	axis := norm3(axisIn)
	scale := look.Scale
	if scale == 0 {
		scale = 1
	}
	length := 0.0
	for _, sec := range look.Sections {
		length += sec.Length
	}
	length *= scale
	tx, ty, ts := cam.project(position)
	nx, ny, ns := cam.project(along3(position, axis, length))
	screenLength := math.Hypot(nx-tx, ny-ty) + math.Abs(ns-ts)*0.3
	step := math.Max(length/180, length/math.Max(28, screenLength/1.2))

	up := vec3{0, 1, 0}
	if math.Abs(axis[1]) > 0.9 {
		up = vec3{1, 0, 0}
	}
	side := norm3(cross3(up, axis))
	top := cross3(axis, side)
	radial := func(angle float64) vec3 {
		c, sn := math.Cos(angle+roll), math.Sin(angle+roll)
		return vec3{side[0]*c + top[0]*sn, side[1]*c + top[1]*sn, side[2]*c + top[2]*sn}
	}
	tailR := 0.2 * scale
	if len(look.Sections) > 0 {
		tailR = look.Sections[0].R1 * scale
	}
	type part struct {
		dir  vec3
		draw func()
	}
	var around []part
	if f := look.Fins; f != nil {
		for i := 0; i < f.Count; i++ {
			dir := radial(float64(i)/float64(f.Count)*math.Pi*2 + math.Pi/float64(f.Count))
			fin := *f
			around = append(around, part{dir, func() {
				root := along3(position, dir, tailR*0.9)
				pts := []vec3{root, along3(root, dir, fin.Span*scale), along3(along3(root, dir, fin.Span*scale*0.55), axis, fin.Length*scale*0.5), along3(root, axis, fin.Length*scale)}
				flat := make([]float64, 0, 8)
				for _, p := range pts {
					x, y, _ := cam.project(p)
					flat = append(flat, x, y)
				}
				k := 0.55 + 0.5*math.Max(0, -dir[0]*0.6+dir[1]*0.6+0.3)
				s.add(FlightShape{K: ShapePoly, Pts: flat, Fill: scaleHex(fin.Color, k), A: 1})
			}})
		}
	}
	if b := look.Boosters; b != nil {
		for i := 0; i < b.Count; i++ {
			dir := radial(float64(i) / float64(b.Count) * math.Pi * 2)
			bo := *b
			around = append(around, part{dir, func() {
				base := along3(position, dir, tailR+bo.Radius*scale*0.9)
				secs := []FlightCraftSection{
					{ID: "b-engine", Length: bo.Length * 0.12, R0: bo.Radius * 0.7, R1: bo.Radius, Color: "#3c4658"},
					{ID: "b-body", Length: bo.Length * 0.66, R0: bo.Radius, R1: bo.Radius, Color: bo.Color},
					{ID: "b-nose", Length: bo.Length * 0.22, R0: bo.Radius, R1: 0.01, Color: bo.Color},
				}
				s.drawRings(cam, flightLathe(secs, base, axis, scale, step), axis)
			}})
		}
	}
	plume := func() {
		if thrust <= 0 {
			return
		}
		colour := look.Plume
		if colour == "" {
			colour = "#7fd4ff"
		}
		reach := (0.5 + 0.55*thrust) * scale
		for i := 0; i < 14; i++ {
			u := float64(i) / 13
			flicker := 0.85 + 0.15*math.Sin(t*31+float64(i)*1.7)
			px, py, ps := cam.project(along3(position, axis, -u*reach))
			r := math.Max(0.5, tailR*(0.8-0.62*u)*flicker*ps)
			s.add(FlightShape{K: ShapeGlow, X: px, Y: py, RX: r, Add: true, Stops: []FlightStop{{0, "#ffffff", 0.5 * (1 - u)}, {0.5, colour, 0.38 * (1 - u)}, {1, colour, 0}}, A: 1})
		}
	}
	// Seen from behind, the exhaust sits between the camera and the tail.
	fromBehind := axis[2] > 0
	if !fromBehind {
		plume()
	}
	for _, a := range around {
		if a.dir[2] > 0 {
			a.draw()
		}
	}
	s.drawRings(cam, flightLathe(look.Sections, position, axis, scale, step), axis)
	for _, a := range around {
		if a.dir[2] <= 0 {
			a.draw()
		}
	}
	if fromBehind {
		plume()
	}
}

func (s *FlightStage) drawOrbit(st FlightState, w, h float64) {
	horizonY := h * 0.6
	R := math.Max(w, h) * 0.95
	cx, cy := w/2, horizonY+R
	s.add(FlightShape{K: ShapeLimb, X: cx, Y: cy, RX: R, Spin: st.Angle, A: 1})
	craftY := horizonY - h*(0.2+(st.Altitude-1)*0.28)
	cam := flightCam{cx: w / 2, cy: craftY, f: math.Min(w, h) * 0.5}
	marked := map[string]bool{}
	for _, id := range st.Marked {
		marked[id] = true
	}
	for _, site := range s.sites {
		d := math.Mod(math.Mod(site.Angle-st.Angle+math.Pi, math.Pi*2)+math.Pi*2, math.Pi*2) - math.Pi
		if math.Abs(d) > 0.55 {
			continue
		}
		gx, gy := cx+math.Sin(d)*R, cy-math.Cos(d)*R
		over := st.Overhead == site.ID
		done := marked[site.ID]
		colour := "#78d2ff"
		switch {
		case done:
			colour = "#a0ebb4"
		case over:
			colour = "#ffecaa"
		}
		if over && !done {
			s.add(FlightShape{K: ShapePoly, Pts: []float64{w/2 - 3, craftY + 8, w/2 + 3, craftY + 8, w/2 + 44, horizonY + 6, w/2 - 44, horizonY + 6}, Fill: "#ffecaa", A: 0.22})
		}
		s.add(FlightShape{K: ShapeLine, X: gx, Y: gy, X2: gx, Y2: gy - 26, Stroke: colour, W: 2, A: 0.9})
		diamond := FlightShape{K: ShapePoly, Pts: []float64{gx, gy - 40, gx + 8, gy - 32, gx, gy - 24, gx - 8, gy - 32}, A: 0.9}
		if done {
			diamond.Fill = colour
		} else {
			diamond.Stroke, diamond.W = colour, 2
		}
		s.add(diamond)
		if site.Label != "" {
			s.add(FlightShape{K: ShapeText, X: gx, Y: gy - 48, Text: site.Label, Size: 14, Fill: colour, A: 0.9})
		}
	}
	s.drawCraft(cam, vec3{-1.05, 0, 6.5}, vec3{1, 0.04 + st.VY*0.1, 0.16}, 0, 0.25, st.Time)
	if s.sparkle > 0 {
		r := (1-s.sparkle/0.45)*70 + 16
		s.add(FlightShape{K: ShapeEllipse, X: w / 2, Y: craftY, RX: r, RY: r, Stroke: "#ffecaa", W: 3, A: math.Min(1, s.sparkle*1.6)})
	}
}

// FlightHUD is what a host's HUD shows about a flight: counts, meters and one
// line of instruction. Every host reads the same words.
type FlightHUD struct {
	Phase       string  `json:"phase"`
	Percent     int     `json:"percent"`     // 0..100
	Boosts      int     `json:"boosts"`      // whole charges ready
	BoostCharge float64 `json:"boostCharge"` // 0..1 toward the next charge
	Boosting    bool    `json:"boosting"`
	Hull        float64 `json:"hull"`
	Hits        int     `json:"hits"`
	Pickups     int     `json:"pickups"`
	Samples     int     `json:"samples"`
	Laps        int     `json:"laps"`
	CanMark     bool    `json:"canMark"` // an unmarked site is under the craft
	Overhead    *string `json:"overhead"`
	Marked      int     `json:"marked"`
	Sites       int     `json:"sites"`
	Prompt      string  `json:"prompt"`
}

// FlightHUDOf reads a state. sites is how many orbit sites the flight has.
func FlightHUDOf(st FlightState, sites int) FlightHUD {
	canMark := st.Phase == FlightOrbit && st.Overhead != ""
	for _, id := range st.Marked {
		if id == st.Overhead {
			canMark = false
		}
	}
	prompt := "In orbit."
	switch {
	case st.Phase == FlightDeparture:
		prompt = "Leaving orbit. Hold your course."
	case st.Phase == FlightCruise && st.Slowed:
		prompt = "Hit. Steer clear of debris."
	case st.Phase == FlightCruise:
		prompt = "Steer through the rings. Avoid debris."
	case st.Phase == FlightApproach:
		prompt = "On approach. Slowing for orbit."
	case canMark:
		prompt = "Over a site. Mark it."
	case sites > len(st.Marked):
		prompt = "In orbit. Wait for the next site."
	}
	boosts := math.Floor(st.Boost + 1e-9)
	hud := FlightHUD{Phase: st.Phase, Percent: int(math.Round(st.Progress * 100)), Boosts: int(boosts), BoostCharge: st.Boost - boosts,
		Boosting: st.Boosting, Hull: st.Hull, Hits: st.Hits, Pickups: st.Pickups, Samples: st.Samples, Laps: st.Laps,
		CanMark: canMark, Marked: len(st.Marked), Sites: sites, Prompt: prompt}
	if st.Overhead != "" {
		o := st.Overhead
		hud.Overhead = &o
	}
	return hud
}

// FlightTouchSteer is the nudge for a finger held at (tx, ty), each -1..1
// from the middle of the view (x right, y up). In the corridor the craft is
// pulled toward the finger; in orbit the finger is the nudge itself.
func FlightTouchSteer(st FlightState, tx, ty float64) (float64, float64) {
	if !finite(tx) || !finite(ty) {
		return 0, 0
	}
	if st.Phase == FlightOrbit {
		return clampF(tx, -1, 1), clampF(ty, -1, 1)
	}
	return clampF((tx*1.15-st.X)*3, -1, 1), clampF((ty*1.15-st.Y)*3, -1, 1)
}

// Stage returns the flight's view stage, creating it on first use.
func (f *Flight) Stage() *FlightStage {
	if f.stage == nil {
		f.stage = NewFlightStage(f.c.Config.Seed, f.c.Config.Sites, nil)
	}
	return f.stage
}

// SetCraft sets how the craft looks in Draw.
func (f *Flight) SetCraft(look FlightCraftLook) error {
	if err := look.Validate(); err != nil {
		return err
	}
	f.Stage().SetCraft(look)
	return nil
}

// Draw lays out the current moment at w x h host points; dt drives easing.
func (f *Flight) Draw(w, h, dt float64) FlightDraw { return f.Stage().Draw(f.State(), w, h, dt) }

// HUD is the HUD reading of the current moment.
func (f *Flight) HUD() FlightHUD { return FlightHUDOf(f.State(), len(f.c.Config.Sites)) }

// SteerToward holds the nudge for a finger at (tx, ty); see FlightTouchSteer.
func (f *Flight) SteerToward(tx, ty float64) {
	f.Steer(FlightTouchSteer(FlightState{Phase: f.c.Phase, X: f.c.X, Y: f.c.Y}, tx, ty))
}
