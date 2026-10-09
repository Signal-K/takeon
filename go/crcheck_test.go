package takeon

import (
	"math"
	"math/big"
	"testing"
)

// crSin returns the correctly rounded sin(x) (and cos) using 200-bit Taylor series.
func crTrig(x float64) (float64, float64) {
	prec := uint(300)
	bx := new(big.Float).SetPrec(prec).SetFloat64(x)
	x2 := new(big.Float).SetPrec(prec).Mul(bx, bx)
	sin := new(big.Float).SetPrec(prec).Set(bx)
	cos := new(big.Float).SetPrec(prec).SetInt64(1)
	ts := new(big.Float).SetPrec(prec).Set(bx)
	tc := new(big.Float).SetPrec(prec).SetInt64(1)
	for n := 1; n < 60; n++ {
		tc.Mul(tc, x2)
		tc.Quo(tc, new(big.Float).SetPrec(prec).SetInt64(int64((2*n-1)*(2*n))))
		tc.Neg(tc)
		cos.Add(cos, tc)
		ts.Mul(ts, x2)
		ts.Quo(ts, new(big.Float).SetPrec(prec).SetInt64(int64((2*n)*(2*n+1))))
		ts.Neg(ts)
		sin.Add(sin, ts)
	}
	s, _ := sin.Float64()
	c, _ := cos.Float64()
	return s, c
}

func TestCorrectlyRounded(t *testing.T) {
	var g struct{ Trig [][]float64 }
	load(t, "noise", &g)
	var vS, vC, fS, fC, gS, gC, n int
	for _, v := range g.Trig {
		s, c := crTrig(v[0])
		n++
		if v[1] == s {
			vS++
		}
		if v[2] == c {
			vC++
		}
		if fsin(v[0]) == s {
			fS++
		}
		if fcos(v[0]) == c {
			fC++
		}
		if math.Sin(v[0]) == s {
			gS++
		}
		if math.Cos(v[0]) == c {
			gC++
		}
	}
	for _, e := range []struct {
		name string
		hit  int
	}{{"sin: V8 vs correctly-rounded", vS}, {"cos: V8 vs correctly-rounded", vC}, {"sin: fdlibm port vs correctly-rounded", fS}, {"cos: fdlibm port vs correctly-rounded", fC}, {"sin: go math vs correctly-rounded", gS}, {"cos: go math vs correctly-rounded", gC}} {
		r := newRow("trig " + e.name)
		r.count, r.exact = n, e.hit
		r.note = "(informational: 300-bit Taylor reference)"
	}
}
