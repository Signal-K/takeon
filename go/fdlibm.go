package takeon

import "math"

// Port of the fdlibm sin/cos path used by V8's base::ieee754 (and therefore
// by Node's Math.sin/Math.cos). Go's math.Sin/Cos are Cephes-derived and differ
// from V8 in the last ulp for a measurable share of inputs (see
// docs/go-core-spike.md). Covered range: |x| < 2^19*pi/2 via the "medium"
// argument reduction; larger arguments fall back to math.Sin/Cos (the engine
// only ever passes angles in [0, 2*pi]).

func hiWord(x float64) int32 { return int32(math.Float64bits(x) >> 32) }

const (
	pio2_1  = 1.57079632673412561417e+00
	pio2_1t = 6.07710050650619224932e-11
	pio2_2  = 6.07710050630396597660e-11
	pio2_2t = 2.02226624879595063154e-21
	pio2_3  = 2.02226624871116645580e-21
	pio2_3t = 8.47842766036889956997e-32
	invpio2 = 6.36619772367581382433e-01
)

var npio2hw = [32]int32{
	0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
	0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
	0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
	0x403DD85A, 0x403F6A7A, 0x40407E4D, 0x4041475C, 0x4042106C, 0x4042D97C,
	0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
	0x404858EB, 0x404921FB,
}

func kernelSinPlain(x, y float64, iy int) float64 {
	const (
		S1 = -1.66666666666666324348e-01
		S2 = 8.33333333332248946124e-03
		S3 = -1.98412698298579493134e-04
		S4 = 2.75573137070700676789e-06
		S5 = -2.50507602534068634195e-08
		S6 = 1.58969099521155010221e-10
	)
	ix := hiWord(x) & 0x7fffffff
	if ix < 0x3e400000 && int(x) == 0 {
		return x
	}
	z := float64(x * x)
	v := float64(z * x)
	r := S2 + float64(z*(S3+float64(z*(S4+float64(z*(S5+float64(z*S6)))))))
	if iy == 0 {
		return x + float64(v*(S1+float64(z*r)))
	}
	return x - (float64(z*(float64(0.5*y)-float64(v*r))) - y - float64(v*S1))
}

func kernelCosPlain(x, y float64) float64 {
	const (
		C1 = 4.16666666666666019037e-02
		C2 = -1.38888888888741095749e-03
		C3 = 2.48015872894767294178e-05
		C4 = -2.75573143513906633035e-07
		C5 = 2.08757232129817482790e-09
		C6 = -1.13596475577881948265e-11
	)
	ix := hiWord(x) & 0x7fffffff
	if ix < 0x3e400000 && int(x) == 0 {
		return 1
	}
	z := float64(x * x)
	r := float64(z * (C1 + float64(z*(C2+float64(z*(C3+float64(z*(C4+float64(z*(C5+float64(z*C6)))))))))))
	if ix < 0x3FD33333 {
		return 1 - (float64(0.5*z) - (float64(z*r) - float64(x*y)))
	}
	var qx float64
	if ix > 0x3fe90000 {
		qx = 0.28125
	} else {
		qx = math.Float64frombits(uint64(uint32(ix-0x00200000)) << 32)
	}
	hz := float64(0.5*z) - qx
	a := 1 - qx
	return a - (hz - (float64(z*r) - float64(x*y)))
}

// remPio2 returns n and the reduced argument (y0, y1); ok=false when |x| is
// beyond the medium range.
func remPio2(x float64) (n int, y0, y1 float64, ok bool) {
	hx := hiWord(x)
	ix := hx & 0x7fffffff
	if ix <= 0x3fe921fb {
		return 0, x, 0, true
	}
	if ix < 0x4002d97c {
		if hx > 0 {
			z := x - pio2_1
			if ix != 0x3ff921fb {
				y0 = z - pio2_1t
				y1 = (z - y0) - pio2_1t
			} else {
				z -= pio2_2
				y0 = z - pio2_2t
				y1 = (z - y0) - pio2_2t
			}
			return 1, y0, y1, true
		}
		z := x + pio2_1
		if ix != 0x3ff921fb {
			y0 = z + pio2_1t
			y1 = (z - y0) + pio2_1t
		} else {
			z += pio2_2
			y0 = z + pio2_2t
			y1 = (z - y0) + pio2_2t
		}
		return -1, y0, y1, true
	}
	if ix <= 0x413921fb {
		t := math.Abs(x)
		n = int(float64(t*invpio2) + 0.5)
		fn := float64(n)
		r := t - float64(fn*pio2_1)
		w := float64(fn * pio2_1t)
		if n < 32 && ix != npio2hw[n-1] {
			y0 = r - w
		} else {
			j := ix >> 20
			y0 = r - w
			i := j - ((hiWord(y0) >> 20) & 0x7ff)
			if i > 16 {
				t = r
				w = float64(fn * pio2_2)
				r = t - w
				w = float64(fn*pio2_2t) - ((t - r) - w)
				y0 = r - w
				i = j - ((hiWord(y0) >> 20) & 0x7ff)
				if i > 49 {
					t = r
					w = float64(fn * pio2_3)
					r = t - w
					w = float64(fn*pio2_3t) - ((t - r) - w)
					y0 = r - w
				}
			}
		}
		y1 = (r - y0) - w
		if hx < 0 {
			return -n, -y0, -y1, true
		}
		return n, y0, y1, true
	}
	return 0, 0, 0, false
}

// TrigFMA selects which V8 build's Math.sin/Math.cos to reproduce.
//
// V8's ieee754.cc is plain fdlibm, but when the C++ compiler contracts
// a*b+c into fused multiply-adds (clang's default on arm64, which is what the
// Node binary on Apple Silicon uses) the results differ from a non-fused build
// in the last bit for ~0.6% of arguments. true = reproduce the arm64/FMA
// build (matches the golden vectors dumped on this machine 5000/5000);
// false = the plain, non-fused fdlibm (x86-64 builds).
var TrigFMA = true

func kSin(x, y float64, iy int, variant int) float64 {
	if TrigFMA {
		return kernelSinFMA(x, y, iy, variant)
	}
	return kernelSinPlain(x, y, iy)
}

func kCos(x, y float64, variant int) float64 {
	if TrigFMA {
		return kernelCosFMA(x, y, variant)
	}
	return kernelCosPlain(x, y)
}

// fsin is V8's Math.sin.
func fsin(x float64) float64 {
	ix := hiWord(x) & 0x7fffffff
	if ix <= 0x3fe921fb {
		return kSin(x, 0, 0, 0)
	}
	if ix >= 0x7ff00000 {
		return math.NaN()
	}
	n, y0, y1, ok := remPio2(x)
	if !ok {
		return math.Sin(x)
	}
	switch n & 3 {
	case 0:
		return kSin(y0, y1, 1, 0)
	case 1:
		return kCos(y0, y1, 0)
	case 2:
		return -kSin(y0, y1, 1, 0)
	default:
		return -kCos(y0, y1, 0)
	}
}

// fcos is V8's Math.cos.
func fcos(x float64) float64 {
	ix := hiWord(x) & 0x7fffffff
	if ix <= 0x3fe921fb {
		return kCos(x, 0, 0)
	}
	if ix >= 0x7ff00000 {
		return math.NaN()
	}
	n, y0, y1, ok := remPio2(x)
	if !ok {
		return math.Cos(x)
	}
	switch n & 3 {
	case 0:
		return kCos(y0, y1, 0)
	case 1:
		return -kSin(y0, y1, 1, 1)
	case 2:
		return -kCos(y0, y1, 0)
	default:
		return kSin(y0, y1, 1, 1)
	}
}

// FMA-contracted kernels. `variant` picks between the two ways clang
// contracts a*b-c*d; V8 inlines the kernels separately into sin and cos and
// the two sites differ (sin: 0, cos's sin-kernel call: 1), found empirically.
func kernelSinFMA(x, y float64, iy int, variant int) float64 {
	const (
		S1 = -1.66666666666666324348e-01
		S2 = 8.33333333332248946124e-03
		S3 = -1.98412698298579493134e-04
		S4 = 2.75573137070700676789e-06
		S5 = -2.50507602534068634195e-08
		S6 = 1.58969099521155010221e-10
	)
	ix := hiWord(x) & 0x7fffffff
	if ix < 0x3e400000 && int(x) == 0 {
		return x
	}
	z := float64(x * x)
	v := float64(z * x)
	r := math.FMA(z, math.FMA(z, math.FMA(z, math.FMA(z, S6, S5), S4), S3), S2)
	if iy == 0 {
		return math.FMA(v, math.FMA(z, r, S1), x)
	}
	var inner float64
	if variant == 0 {
		inner = math.FMA(-v, r, 0.5*y)
	} else {
		inner = math.FMA(0.5, y, -float64(v*r))
	}
	t := math.FMA(z, inner, -y)
	return x - math.FMA(-v, S1, t)
}

func kernelCosFMA(x, y float64, variant int) float64 {
	const (
		C1 = 4.16666666666666019037e-02
		C2 = -1.38888888888741095749e-03
		C3 = 2.48015872894767294178e-05
		C4 = -2.75573143513906633035e-07
		C5 = 2.08757232129817482790e-09
		C6 = -1.13596475577881948265e-11
	)
	ix := hiWord(x) & 0x7fffffff
	if ix < 0x3e400000 && int(x) == 0 {
		return 1
	}
	z := float64(x * x)
	r := float64(z * math.FMA(z, math.FMA(z, math.FMA(z, math.FMA(z, math.FMA(z, C6, C5), C4), C3), C2), C1))
	var zr float64
	if variant == 0 {
		zr = math.FMA(z, r, -float64(x*y))
	} else {
		zr = math.FMA(-x, y, float64(z*r))
	}
	if ix < 0x3FD33333 {
		return 1 - math.FMA(0.5, z, -zr)
	}
	var qx float64
	if ix > 0x3fe90000 {
		qx = 0.28125
	} else {
		qx = math.Float64frombits(uint64(uint32(ix-0x00200000)) << 32)
	}
	hz := math.FMA(0.5, z, -qx)
	return (1 - qx) - (hz - zr)
}
