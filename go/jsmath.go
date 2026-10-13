package takeon

import "math"

// This file reproduces the JavaScript numeric semantics the TS engine relies
// on. Go and JS are both IEEE-754 binary64, but they differ in places that
// matter for bit-exact replay:
//
//   - Go on arm64 (and amd64 with GOAMD64=v3) may fuse x*y+z into an FMA,
//     which changes the last bit. Every product that feeds a sum is therefore
//     wrapped in an explicit float64(...) conversion, which the Go spec says
//     forbids fusion.
//   - Math.round, ToInt32/ToUint32, Math.hypot and Math.sin/cos have their own
//     exact definitions (see fdlibm.go for sin/cos).

// toInt32 is ECMAScript ToInt32 on a float64.
func toInt32(v float64) int32 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	if v > -9.2e18 && v < 9.2e18 {
		return int32(uint32(int64(v))) // truncate toward zero, wrap mod 2^32
	}
	m := math.Mod(math.Trunc(v), 4294967296)
	if m < 0 {
		m += 4294967296
	}
	return int32(uint32(m))
}

// jsRound is Math.round: round half toward +Infinity, preserving -0 and
// the 0.49999999999999994 edge case that floor(x+0.5) gets wrong.
func jsRound(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}

// jsHypot mirrors V8's Math.hypot (builtins/math.tq): scale by the max
// magnitude, Kahan-sum the squares, sqrt, rescale. Go's math.Hypot and a naive
// sqrt(x*x+y*y) both round differently.
func jsHypot(a, b float64) float64 {
	if math.IsInf(a, 0) || math.IsInf(b, 0) {
		return math.Inf(1)
	}
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.NaN()
	}
	abs := [2]float64{math.Abs(a), math.Abs(b)}
	max := 0.0
	for _, v := range abs {
		if v > max {
			max = v
		}
	}
	if max == 0 {
		return 0
	}
	sum, comp := 0.0, 0.0
	for _, v := range abs {
		n := v / max
		summand := float64(n*n) - comp
		prelim := sum + summand
		comp = (prelim - sum) - summand
		sum = prelim
	}
	return float64(math.Sqrt(sum) * max)
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func fmax(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func fmin(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
